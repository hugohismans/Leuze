# PLAN — Web app « Activités » — CH psychiatrique Saint-Jean-de-Dieu, Leuze-en-Hainaut

> Statut : **en attente de validation**. Aucune ligne de code applicatif n'est écrite avant accord
> sur ce document et réponses aux questions ouvertes (§8).

---

## 1. Principes directeurs

Trois règles qui arbitrent tous les arbitrages qui suivent :

1. **Un patient désorienté doit comprendre l'écran en 3 secondes.** Toute fonctionnalité qui ajoute
   un choix à l'écran patient doit être justifiée ; en cas de doute, elle va dans l'espace soignant.
2. **Une fuite de la base ne doit rien révéler de plus que « cette personne a fait du yoga ».**
   Pas de nom de famille, pas de date de naissance, pas de diagnostic, pas de numéro de dossier.
   Le nom de l'hôpital n'apparaît nulle part dans les données, seulement dans l'interface.
3. **Le réseau lâche.** Le programme de la semaine doit s'afficher hors ligne. L'inscription, non
   (voir §4.6) — une inscription « en attente de synchro » est un mensonge dangereux quand il y a
   une capacité à respecter.

---

## 2. Architecture générale

```
src/
  lib/
    domain/        ← logique métier PURE, zéro import Firebase, 100 % testée en Vitest
      recurrence.ts      génération d'occurrences, exceptions, split de série
      capacity.ts        état d'une occurrence (libre / complet / annulée)
      waitlist.ts        ordre, promotion, position
      time.ts            fuseau Europe/Brussels, semaine ISO, formats FR
    data/          ← interfaces de dépôt (ports) + implémentations (adapters)
      ports.ts           ActivityRepository, OccurrenceRepository, RegistrationService…
      firestore/         adapter Firestore + callables
      mock/              adapter en mémoire (écran de démo + tests de composants)
      seed/              locations.seed.ts, activities.seed.ts, script de seed
    ui/            ← design system (Button, Card, Badge, Sheet, BigTime…)
  routes/          ← écrans patient / soignant / admin / démo
functions/         ← Cloud Functions (TypeScript, region europe-west1)
firestore.rules
firestore.indexes.json
tests/rules/       ← @firebase/rules-unit-testing sur émulateur
```

**Décision structurante : pattern ports/adapters.** L'UI ne connaît jamais Firestore, seulement des
interfaces. Conséquences directes : l'écran de démo sans backend (§11.7 du brief) n'est pas une
maquette jetable mais **la vraie app branchée sur l'adapter mock** ; les tests de composants sont
triviaux ; un changement de backend reste possible.

---

## 3. Modèle de données Firestore

### Collections

| Collection | Doc ID | Lecture | Écriture |
|---|---|---|---|
| `locations/{id}` | slug | tout le monde (auth) | admin |
| `categories/{id}` | slug | tout le monde (auth) | admin |
| `services/{id}` | slug | tout le monde (auth) | admin |
| `activities/{id}` | auto | tout le monde (auth) | soignant |
| `occurrences/{id}` | **déterministe** | **son service uniquement** | Functions + soignant |
| `registrations/{id}` | auto | **la sienne uniquement** / soignant | **Functions uniquement** |
| `patients/{id}` | **hash du code** | personne (client) | Functions uniquement |
| `staff/{uid}` | uid Auth | soi-même / admin | admin |
| `config/app` | fixe | tout le monde (auth) | admin |

### Écarts assumés par rapport à l'ossature du brief

- **`Occurrence` est dénormalisée** : elle porte `title`, `categoryId`, `locationId`, `capacity`,
  `facilitator`, `status`. Raison : le calendrier fait **une seule requête** (`occurrences` où
  `localDate` ∈ [début, fin]) au lieu de N jointures. C'est ce qui rend la vue semaine instantanée
  et le cache hors ligne trivial. Le coût est la resynchronisation lors d'une modification de série
  — prise en charge par la Cloud Function de régénération.
- **`localDate: 'yyyy-MM-dd'`** en plus de `start: Timestamp`. Une requête « le mardi 12 » sur une
  chaîne locale est exacte et insensible aux pièges de fuseau ; un `Timestamp` UTC ne l'est pas
  autour du changement d'heure. Les deux champs sont écrits ensemble, `localDate` fait autorité pour
  le regroupement par jour, `start` pour l'ordre et l'affichage de l'heure.
- **`confirmedCount` + `waitlistCount`** au lieu du seul `registeredCount`. L'affichage « il reste 4
  places » et « vous êtes 2e sur la liste d'attente » sont deux informations différentes.
- **`seriesId`** sur `activities` : une série modifiée « à partir de telle date » produit un second
  document `activities` partageant le même `seriesId` (voir §4.2).
- **`audience` + `serviceIds` sur l'activité, `audienceKeys` sur l'occurrence** (voir §4.8).
- **`patientRef` devient `patientUid`** : l'UID Firebase Auth du patient (§4.5). C'est ce qui permet
  aux règles de sécurité d'isoler les inscriptions sans Cloud Function de lecture.

### ID d'occurrence déterministe

`{activityId}_{yyyyMMddTHHmm}` (heure locale Bruxelles). Conséquence : la régénération est
**idempotente**. Régénérer 12 semaines deux fois ne crée pas de doublons, et une occurrence
individuellement modifiée est identifiable sans registre d'exceptions séparé.

---

## 4. Décisions techniques tranchées

### 4.0 Correction de cadrage : le programme est refait chaque semaine

Le brief laissait entendre que « la plupart des activités sont hebdomadaires et fixes ».
La réalité du service est l'inverse : **le programme est refait chaque semaine**, selon les
disponibilités des soignants et des patients, et il est aujourd'hui écrit à la main sur un
tableau papier le lundi. Les activités ponctuelles sont donc le cas courant, la récurrence
l'exception.

Conséquences, appliquées :
- le formulaire propose **« une seule fois, à une date précise » par défaut** ;
- l'écran principal du personnel est **la semaine**, avec un bouton « Ajouter » sous chaque
  jour : on pose les activités là où on les veut, une par une ;
- la fenêtre de génération commence au **lundi de la semaine en cours**, pour qu'une
  activité posée un lundi alors qu'on est jeudi ne disparaisse pas ;
- une **feuille imprimable par service** remplace le tableau papier.

La récurrence reste entièrement supportée : elle n'est plus le chemin par défaut.

### 4.0 bis La réunion de début de semaine

Le processus existant, à ne pas changer : le lundi, l'équipe annonce les activités de la
semaine, demande qui veut participer, et note les prénoms sur une feuille. Le produit ne
remplace pas ce rituel — il remplace **la feuille**.

L'écran « Réunion du lundi » déroule les activités à venir de la semaine, une par une.
Pour chacune, les prénoms des patients concernés s'affichent ; un appui inscrit, un
second retire. Conséquences voulues :

- **un patient n'a jamais besoin de l'application** pour être inscrit. Ceux qui n'ont pas
  de téléphone, ou que la technique met en difficulté, vivent exactement la même réunion
  qu'avant ;
- s'il ouvre l'application, il retrouve ses inscriptions déjà faites, et peut en ajouter
  d'autres ensuite. L'application devient un complément, jamais un péage.

Trois choix de conception en découlent :

- **la réunion se tient dans une unité**, et l'écran le reflète : un sélecteur de service
  restreint à la fois les activités passées en revue et les prénoms proposés. Une activité
  réservée à un autre service ne peut accueillir personne d'ici ; faire défiler les
  patients des autres unités ne ferait que rallonger la réunion. Le choix est mémorisé sur
  l'appareil, pour que la tablette d'une unité rouvre toujours sur la sienne ;
- la liste des prénoms est en outre **restreinte à l'audience de l'activité** ;
- l'écran ne propose que les activités **encore à venir** — prendre une inscription pour
  une séance commencée n'a pas de sens et allongerait la revue.

⚠️ Cet écran écrit des inscriptions : il exige donc les Cloud Functions, donc le plan
Blaze. Il est entièrement utilisable dans la démonstration en attendant.

### 4.0 ter Rendez-vous individuels

Aujourd'hui, obtenir un rendez-vous avec le psychiatre, le psychologue ou le
kinésithérapeute suppose de demander à un soignant, qui y pense — ou pas. L'application
ouvre une file : le patient demande **qui** il veut voir, un soignant consulte l'agenda et
fixe la date, le rendez-vous apparaît dans le calendrier du patient.

Trois décisions de conception, prises avant d'écrire la moindre ligne :

1. **Aucun champ libre, nulle part.** Un texte à côté de « rendez-vous avec le psychiatre »
   deviendrait immanquablement le réceptacle de contenu clinique — « je vais mal », « j'ai
   des idées noires ». Le patient dit qui il veut voir et, s'il le souhaite, matin ou
   après-midi. Jamais pourquoi. Les règles Firestore refusent d'ailleurs toute demande
   contenant autre chose.
2. **Ce n'est pas un canal d'urgence, et l'écran le dit en premier.** Une demande passe
   par une file relevée par l'équipe ; elle ne réveille personne. Le message renvoie vers
   la seule réponse valable dans l'immédiat : s'adresser à un soignant, dans le service.
3. **L'attente doit se voir.** Faute de notification, la seule protection contre l'oubli
   est que la file affiche l'ancienneté de chaque demande, les plus anciennes en tête.

Les rendez-vous n'ont pas de capacité : aucune transaction n'est nécessaire, et les règles
suffisent. **Cette fonctionnalité marche donc sur le plan gratuit**, contrairement aux
inscriptions. Un rendez-vous n'apparaît que dans « Mes inscriptions » du patient concerné,
jamais dans le calendrier commun ni sur la feuille imprimée.

### 4.0 quater « Ma semaine » : la feuille que le patient garde

Le patient s'inscrit le lundi, puis oublie. Il lui faut donc un endroit unique qui réunit
ce que le calendrier commun sépare : ses activités **et** ses rendez-vous, jour par jour.

Une seule mise en page sert trois usages — consulter, capturer d'écran, imprimer. C'est
délibéré : une page conçue pour la capture d'écran est une page sobre, verticale et
compacte, ce qui est exactement ce qu'il faut pour l'imprimer et pour la lire sur un
téléphone. Aucune image n'est générée : tous les téléphones savent faire une capture, et
un fichier à télécharger puis à retrouver dans une galerie serait un obstacle de plus.

**Deux présentations des mêmes données.** À l'écran, une liste verticale : c'est ce qui se
lit sur un téléphone et se capture d'un coup. Sur le papier, une **grille horaire** — les
heures à gauche, les sept jours en colonnes, les activités posées à leur place réelle.

Les trous de cette grille ne sont pas un défaut de remplissage, ils en sont l'objet : la
personne y écrit à la main ce qu'elle ajoute. D'où les lignes de demi-heure, assez claires
pour ne pas gêner la lecture et assez visibles pour guider l'écriture, et des cases assez
hautes pour qu'on puisse y inscrire un mot. C'est aussi pourquoi la plage horaire ne se
resserre jamais autour des seules activités inscrites : elle part de 9 h – 18 h et ne fait
que s'élargir.

Un détail qui compte plus qu'il n'en a l'air : **les activités annulées restent, barrées**
avec leur motif. Les faire disparaître d'un programme peut-être déjà imprimé serait pire
que de les montrer barrées.

La feuille ne porte **aucune mise en garde sur les horaires** : le programme est arrêté en
début de semaine et ne bouge pas. Avertir d'un changement qui n'arrive pas installerait un
doute inutile chez quelqu'un qui a déjà du mal à se repérer.

### 4.1 Récurrence — « série + occurrences matérialisées + exceptions portées par l'occurrence »

C'est bien le modèle demandé, avec une simplification : **pas de collection d'exceptions**.
L'exception *est* le document d'occurrence, marqué `overridden: true`.

- `activities.recurrence` : `{ freq: 'weekly', byWeekday: [2], startTime: '14:00', durationMin: 90,
  from: 'yyyy-MM-dd', until: 'yyyy-MM-dd' | null, skipDates: string[] }`
- Génération sur **fenêtre glissante de 12 semaines**, déclenchée : (a) à l'écriture d'une activité
  (trigger Firestore `onWrite`), (b) chaque nuit par une fonction planifiée qui repousse la fenêtre.
- La génération **n'écrase jamais** une occurrence `overridden: true` ni une occurrence portant des
  inscriptions, sauf demande explicite « toutes les suivantes ».
- Le calcul de récurrence lui-même vit dans `domain/recurrence.ts`, fonction pure
  `expand(activity, from, to): OccurrenceDraft[]`, testée en Vitest **avant** d'être branchée.
- Changement d'heure d'été : la récurrence raisonne en **heure murale locale**. « Mardi 14h » reste
  14h le mardi qui suit le passage à l'heure d'hiver. C'est un des cas de test obligatoires.

### 4.1 bis La récurrence ne concerne que la création

La récurrence sert à **poser des séances**, jamais à s'y inscrire d'avance. Une inscription
porte toujours sur une occurrence précise, et une seule.

C'est un choix de fond, pas une limite technique. Dans une unité de soins, la
participation se décide semaine par semaine, selon l'état du jour ; une inscription
reconduite d'office produirait des places réservées pour des personnes qui ne viendront
pas, et obligerait à se **désinscrire** — un geste que personne ne fera. La fiche le dit
au patient en toutes lettres : « Vous vous inscrivez pour cette séance seulement. »

Un test du domaine garde cette propriété : inscrire quelqu'un sur une occurrence ne
touche aucune des autres occurrences de la même série.

### 4.2 Modifier une activité récurrente

Trois choix proposés systématiquement, comme un calendrier classique :

| Choix | Effet |
|---|---|
| **Cette occurrence** | écrit sur le doc d'occurrence, `overridden: true`. La série n'est pas touchée. |
| **Cette occurrence et les suivantes** | `recurrence.until` = veille sur l'activité courante ; création d'une nouvelle `activity` (même `seriesId`) valable à partir de la date ; régénération. Les occurrences passées sont préservées telles quelles. |
| **Toute la série** | édition de l'activité, régénération des occurrences **futures** uniquement. |

Une annulation en série (congé de l'animateur du 12 au 26) est une opération dédiée
« annuler du … au … avec motif » qui passe les occurrences concernées en `cancelled` — pas une
suppression, pas une modification de la règle.

### 4.2 bis « Sans inscription » ne veut pas dire « inscription interdite »

Une activité ouverte à tous accepte les inscriptions comme les autres. Le drapeau
`registrationRequired` ne dit qu'une chose : **venir sans s'être inscrit reste possible**.
Il ne ferme aucune porte.

Deux raisons, et la seconde est la plus importante :

1. Un patient qui note qu'il vient retrouve l'activité dans « Ma semaine » et sur sa
   feuille imprimée. Sans cela, la moitié du programme n'y figurait jamais.
2. La réunion du lundi passe en revue **toutes** les activités. La question qu'on y pose
   est « qui veut faire du ping-pong ? », pas « qui doit s'inscrire au ping-pong ? ».
   Exclure les activités libres de la revue revenait à les rendre invisibles au seul
   moment où l'équipe en parle.

Conséquences : `registrationBlock` ne refuse plus que les cas réels — séance annulée,
déjà commencée, complète sans liste d'attente. Une capacité fixée compte, que l'inscription
soit obligatoire ou non. Et le vocabulaire change côté patient : « Je note que je viens »
plutôt que « Je m'inscris », parce que le mot « inscription » laisserait croire qu'on ne
peut pas venir sans.

### 4.3 Capacité et liste d'attente — **serveur uniquement**

Toutes les écritures sur `registrations` passent par des **Cloud Functions callables**
(`register`, `unregister`, `staffRegister`, `staffUnregister`). Les règles Firestore interdisent
toute écriture client sur `registrations`. Raisons, dans l'ordre :

1. **Atomicité réelle.** Transaction Firestore côté serveur : relire `confirmedCount`, décider
   `confirmed` vs `waitlist`, écrire l'inscription et le compteur dans la même transaction. Deux
   patients sur la dernière place : l'un est confirmé, l'autre est 1er sur liste d'attente, jamais
   deux confirmés.
2. **Confidentialité.** Calculer une position de liste d'attente côté client obligerait à lire les
   inscriptions des autres. Impossible par construction ici.
3. **Promotion fiable.** À la désinscription d'un confirmé, la même transaction promeut le premier
   de la liste d'attente. Cela ne dépend pas du fait que le navigateur du patient reste ouvert.

> ⚠️ Cette décision **impose le plan Firebase Blaze** (Cloud Functions). Voir question 1.

### 4.4 Authentification du personnel

Firebase Auth email/mot de passe. Le rôle vit dans un **custom claim** (`role: 'staff' | 'admin'`)
posé par une Function, doublé d'un doc `staff/{uid}` pour l'affichage. Les règles lisent le claim
(pas de lecture supplémentaire). Comptes créés **uniquement par un admin** — pas d'inscription
libre. Désactivation d'un compte = révocation du claim + `disabled` dans Auth.

### 4.5 Identification patient — **option B, avec trois précisions** (mon avis argumenté)

Je confirme ton intuition : **B**. A rend « mes inscriptions » impossible et produit des doublons
(« Marie » de trois unités différentes) que le soignant devra démêler à la main tous les jours.
C est disproportionné : demander un email et un mot de passe à quelqu'un en décompensation, c'est
créer une barrière à l'accès aux soins.

Mais un code court est un secret faible. Trois garde-fous, non négociables à mes yeux :

1. **Le code n'est jamais une requête Firestore côté client.** Il est envoyé à une callable
   `exchangeCode`, qui le vérifie et renvoie un **custom token** Firebase. Le patient obtient un
   vrai UID ; les règles isolent ses inscriptions avec `resource.data.patientUid == request.auth.uid`.
2. **Le code est stocké haché** (SHA-256, l'ID du doc `patients` *est* le hash). Une fuite de la
   base ne donne aucun code utilisable. Le code en clair n'existe que sur le papier remis au patient.
3. **Anti-énumération** : 6 caractères d'un alphabet sans ambiguïté (Crockford base32, sans I/L/O/U)
   ≈ 1 milliard de combinaisons, + App Check + limitation de débit par IP sur `exchangeCode` +
   blocage temporaire après N échecs. Un code est lié à un séjour et expire (voir question 2).

Données stockées pour un patient : `firstName`, `unitId`, `createdAt`, `expiresAt`. Rien d'autre.

### 4.6 Hors ligne

- `persistentLocalCache` Firestore + `vite-plugin-pwa` (Workbox) pour la coque applicative.
- Hors ligne : **lecture seule**, bandeau explicite « Pas de connexion — le programme affiché date
  de <heure>. L'inscription n'est pas possible pour l'instant, adressez-vous à un soignant. »
- Aucune écriture mise en file d'attente. Une inscription qui « part » hors ligne et se transforme
  en liste d'attente trois heures plus tard est pire que pas d'inscription du tout.

### 4.7 Hébergement — **Firebase Hosting** (justification)

Cloudflare Pages est excellent, mais ici il ajoute un second fournisseur, un second pipeline et une
configuration CORS/proxy pour atteindre les callables. Firebase Hosting apporte, gratuitement et
sans colle : rewrites natifs vers les Functions (même origine, pas de CORS, cookies simples),
canaux de prévisualisation par branche, intégration App Check, et surtout **le même émulateur en
local que Firestore/Auth/Functions** — ce qui compte quand la logique critique est côté serveur.
Le trafic attendu (133 lits) rend la question du CDN sans objet.

### 4.8 Audience : quelles activités pour quels services

Toutes les activités ne sont pas ouvertes à tout l'hôpital. Une activité est soit ouverte à
**tous les services**, soit réservée à **un, deux, trois** services — le ping-pong du mardi n'est
proposé qu'à une seule unité.

- Sur l'activité : `audience: 'all' | 'services'` et `serviceIds: string[]`.
- Sur l'occurrence, dénormalisé : `audienceKeys: string[]`, qui vaut `['all']` ou la liste triée
  des services autorisés.

**Pourquoi cette forme.** Elle permet de construire le calendrier d'un patient avec la requête
qu'il a le droit de faire, et une seule :

```
occurrences
  .where('audienceKeys', 'array-contains-any', ['all', serviceDuPatient])
  .where('localDate', '>=', debut).where('localDate', '<=', fin)
```

Les règles Firestore vérifient exactement la même condition, si bien qu'une activité d'un autre
service **n'atteint jamais le navigateur du patient** — ce n'est pas un filtre d'affichage, qui
laisserait fuiter les titres. Cela demande un index composite (`audienceKeys` tableau + `localDate`),
déclaré dans `firestore.indexes.json` au lot L1.

Le filtrage est fait dans la **couche de données**, pas dans l'interface : l'adapter de
démonstration applique déjà la même règle, y compris sur l'accès direct à une adresse devinée.

**Cas particulier : « aucun service ».** Une activité `'services'` avec une liste vide n'est
visible par personne. Ce n'est presque jamais voulu : `isPublished()` la détecte et l'écran
soignant l'affiche comme « Aucun service — cette activité n'est visible par personne », plutôt
que de la laisser disparaître silencieusement.

**Ce que le patient voit.** Un badge « Réservée à votre service », jamais la liste des autres
services : elle ne lui apprend rien et révèle l'organisation interne. Le soignant, lui, voit la
liste exacte.

### 4.7 bis Publication automatique depuis GitHub

Le déploiement se faisait à la main depuis Cloud Shell, sur un téléphone. Trois écueils
s'y sont succédé : la session du CLI qui expire au bout de quelques heures, le code
d'autorisation impossible à coller dans une console mobile, et les droits d'appel des
fonctions à reposer après chaque échec partiel. Chacun a coûté une soirée.

Désormais, toute modification poussée sur `main` est publiée par GitHub, **si et
seulement si** les tests passent — la vérification précède la mise en ligne, elle ne la
commente pas après coup.

L'authentification ne repose sur **aucune clé**. GitHub signe un jeton attestant du dépôt
d'origine, et Google n'accepte que les jetons portant `hugohismans/Leuze`. Il n'y a donc
rien à voler dans le dépôt, rien qui expire, rien à renouveler. C'est le seul point où je
me suis écarté du « tout doit être faisable depuis un téléphone » : l'installation demande
une commande dans Cloud Shell, une fois — `npm run connecter:github` — précisément pour
qu'il n'y en ait plus jamais ensuite.

Le compte de déploiement ne reçoit que ce qu'il faut pour publier. Il ne peut ni lire les
données des patients, ni créer d'autres comptes de service.

### 4.8 bis Retirer une entrée du catalogue

Le catalogue est vivant : une salle ferme, un service change de nom, une catégorie créée
un jour ne sert jamais. Il faut donc pouvoir retirer, sans casser ce qui existe.

Supprimer purement et simplement est dangereux : une séance déjà programmée pointerait
vers un lieu disparu, une personne serait rattachée à un service qui n'existe plus. Un
soignant qui clique « Retirer » ne veut pas dire cela — il veut *ne plus le voir proposé*.

Deux comportements, décidés par ce qui existe réellement, jamais par l'interface :

| Ce qui pointe encore vers l'entrée | Ce qui se passe |
|---|---|
| rien | l'entrée est supprimée |
| une activité, une séance, une personne | `isActive: false` — rien n'est effacé |

Le comptage se fait dans la fonction `removeCatalogEntry`, jamais dans le navigateur : les
personnes ne sont pas lisibles côté client, et une décision prise sur une vue partielle
supprimerait ce qu'elle croit inutilisé. La phrase renvoyée par le serveur est affichée
telle quelle : « Il est encore utilisé par 3 activités et 12 séances : rien n'a été effacé. »

Conséquence sur les listes : une entrée retirée reste **lisible partout** — sinon une
séance perdrait le nom de son lieu — mais n'est plus **proposée** au moment de créer
(`proposed()` dans `domain/catalog.ts`). Un administrateur peut la remettre.

### 4.8 ter Supprimer une activité

Même raisonnement que pour le catalogue, avec un critère différent. Ce n'est pas
l'existence de séances qui protège une activité — une activité récurrente en crée des
dizaines sans que personne ne s'y intéresse — mais l'existence d'une **inscription**.

| Ce qui existe | Ce qui se passe |
|---|---|
| aucune inscription, jamais | l'activité et ses séances sont supprimées |
| au moins une inscription, même annulée | `isActive: false` — rien n'est effacé |

Une inscription annulée compte : sa trace sert à répondre à « qui est venu ? », et
l'effacer laisserait une inscription orpheline. Le décompte se fait sur les documents
d'inscription, pas sur les compteurs dénormalisés des séances — ceux-ci retombent à zéro
après une annulation et laisseraient croire que l'activité n'a jamais servi.

### 4.8 quater La pile de plannings, à la fin de la réunion

Le geste qui clôt la réunion du lundi : on vient de noter qui fait quoi, on imprime, et
chacun repart avec sa semaine sur papier. Une feuille par personne du service, la même
grille horaire que « Ma semaine ».

Trois décisions :

1. **Tout le monde reçoit une feuille**, y compris qui n'est inscrit à rien. Une grille
   vide se remplit à la main, et c'est le but de la feuille.
2. **Les rendez-vous individuels n'y figurent pas.** Une pile imprimée d'un coup passe de
   main en main pendant la distribution : y écrire « rendez-vous avec le psychiatre »
   reviendrait à le dire à qui trie la pile. Chacun retrouve les siens sur son écran.
3. **Le rassemblement se fait côté serveur** (`staffWeekPlannings`) : les inscriptions ne
   sont lisibles par aucun client, et il faut croiser les séances de la semaine, les
   inscriptions et les prénoms — trois collections dont deux sont fermées au navigateur.

### 4.9 Le plan du site (lot 5, préparé dès maintenant)

Composant `<SitePlan zoneId?>` isolé, alimenté par `config/app.planZones` (mapping
`planZoneId → locationId`, éditable dans l'admin). Tant que le SVG n'existe pas, le composant rend
`null` et la fiche activité affiche nom du lieu + `accessNotes` — **aucun trou dans l'UI, aucun
espace réservé vide**. Format SVG attendu documenté dans le README.

---

## 5. Découpage en lots

La numérotation du brief (« lot 1 » = MVP) est conservée comme **jalon** ; je la découpe en lots
livrables plus courts, chacun commitable et démontrable.

### L0 — Socle + écran de démo *(livrable visible immédiatement)*
Vite + Svelte 5 (runes) + TS + Tailwind, design system (tokens, échelle typo 18px base, boutons
56px), routing, `domain/*` complet avec **tests Vitest** (récurrence, capacité, liste d'attente),
adapter mock, seed `locations.seed.ts` + activités d'exemple, écran `/demo` = app patient complète
sur données mockées.
**Critère d'acceptation** : `npm run dev` → calendrier jour/semaine/mois navigable, fiche activité,
inscription simulée. Montrable à la direction sans backend. `npm test` vert.

### L1 — Backend Firebase ✅ *livré*
Schéma, `firestore.rules` + **tests de règles** sur émulateur, Functions (génération d'occurrences,
inscription, désinscription, échange de code, purge planifiée), index, script de seed vers émulateur.
**Critères d'acceptation, tenus** : 40 tests de règles verts (dont « un patient ne peut pas lire les
inscriptions d'un autre » et « une activité d'un autre service n'est pas servie ») ; 16 tests sur
émulateur, dont la concurrence sur la dernière place — cinq inscriptions simultanées donnent un seul
confirmé et quatre positions d'attente distinctes.

### L2 — App patient réelle
Branchement de l'adapter Firestore, écran de saisie de code, « Mes inscriptions », inscription /
désinscription / liste d'attente, mode borne, PWA + hors ligne.

### L3 — Espace soignant / admin *(en cours)*
Auth, création rapide d'activité (< 30 s), duplication, annulation en 2 clics avec motif, dialogue
« cette occurrence / les suivantes / toute la série », vue « Aujourd'hui » + listes d'inscrits,
CRUD lieux / catégories / comptes / codes patients, écran de mapping des zones du plan.

### L4 — Finitions MVP
Audit accessibilité (contrastes AA/AAA, clavier, lecteur d'écran), `README.md` complet, déploiement,
sauvegardes Firestore.

### L5 — *(= lot 2 du brief)*
`<SitePlan>` avec le vrai SVG, export PDF du programme hebdomadaire, rappels.

---

## 6. Ce qui, dans le brief, me paraît discutable

*(§12 demande un avis, pas une exécution aveugle.)*

1. **La vue mois pour les patients.** Une grille de 30 cases avec des pastilles est exactement le
   genre d'écran qu'un patient désorienté ne décode pas, et elle contredit « comprendre en 3
   secondes ». Proposition : vue mois **réservée à l'espace soignant**, patients en jour/semaine.
2. **La liste d'attente n'a pas de canal d'information.** Sans email ni SMS, comment le patient
   promu apprend-il qu'il a une place ? Il ne l'apprend pas, ou trop tard, et il se présente à une
   activité complète — ou pire, il ne se présente pas à une place qui lui était réservée.
   Proposition : la liste d'attente existe **pour le soignant** (qui prévient de vive voix) ; côté
   patient, un statut clair « Vous êtes en attente — un soignant vous préviendra » et pas de
   promesse implicite. La rendre **activable par activité**, pas systématique.
3. **Session sur borne partagée vs « pas de timeout brutal » (§8).** Les deux ne peuvent pas être
   vrais en même temps sur une tablette de salle commune : si la session persiste, le patient
   suivant voit — et peut annuler — les inscriptions du précédent. Proposition : comportement
   différencié par appareil (mode borne appairé par un soignant) → bouton « J'ai terminé » très
   visible + retour automatique au calendrier public après 90 s d'inactivité, avec un message doux
   et aucune perte de saisie. Sur téléphone personnel, session persistante comme demandé.
4. **Les listes d'inscrits imprimables.** Une feuille avec des prénoms et des unités, oubliée sur
   une table, est une divulgation. Proposition : impression depuis l'espace soignant uniquement,
   en-tête sans mention de l'établissement ni du service, et **le programme hebdomadaire affiché
   dans les unités (L5) ne contient jamais de noms**.
5. **`unitId` est quasi-identifiant.** Prénom + unité, dans un hôpital de 133 lits, identifie
   souvent une personne. Proposition : l'unité est utile au soignant, pas au patient — elle n'est
   **jamais affichée sur les écrans patient**, et devient optionnelle si tu n'en as pas l'usage.
6. **« Grande image » sur la fiche activité (§5).** Des photos réelles des locaux peuvent
   identifier l'établissement si une capture circule. Proposition : icônes de catégorie et
   illustrations neutres, pas de photos des lieux — sauf demande contraire.
7. **Le compteur « il reste 4 places »** peut créer une course et de l'anxiété. Proposition :
   afficher « Il reste des places » / « Dernières places » / « Complet » côté patient, et le chiffre
   exact côté soignant. À trancher : c'est un vrai désaccord possible, le chiffre rassure aussi.
8. **La grille 7 colonnes n'existe pas en dessous de 1536 px** — constat de mesure, pas
   d'opinion. Avec une police de base à 18 px, une colonne de semaine à 1024 px fait 126 px de
   contenu utile ; un titre comme « Gymnastique douce » n'y tient qu'en coupant un mot en deux
   (« Gymnasti-que »), ce qui est précisément illisible pour un lecteur en difficulté. La vue
   semaine affiche donc 7 colonnes à partir de 1536 px (postes du personnel) et dégrade en liste
   groupée par jour en dessous — y compris sur tablette. Sur borne, la vue par défaut reste
   « jour », qui est de toute façon la bonne.
9. **Suppression d'activité.** Jamais de suppression physique d'une occurrence portant des
   inscriptions : `isActive: false` et `status: 'cancelled'`, toujours.

---

## 6 bis. Un piège de déploiement, pour mémoire

Une fonction « callable » de Firebase est publiquement invocable : c'est la fonction
elle-même qui vérifie le jeton (`requireStaff`, `requirePatient`). Firebase pose ce droit
à la création. **Quand une fonction échoue à se créer puis est reprise à un déploiement
suivant, le droit n'est pas reposé.**

Le symptôme n'aide pas : Google refuse la requête *avant* la fonction, renvoie une page
HTML sans en-tête CORS, et le navigateur ne voit donc aucun code d'erreur — seulement
« internal [0] ». Rien dans le journal des fonctions, puisqu'aucune fonction ne tourne.

Pour distinguer les deux cas depuis n'importe où :

```
curl -s -D - -o /dev/null -X POST \
  https://europe-west1-leuze-d23b5.cloudfunctions.net/staffRegister \
  -H 'Content-Type: application/json' -H 'Origin: https://leuze-d23b5.web.app' \
  -d '{"data":{}}'
```

Un `403` avec `access-control-allow-origin` : la fonction a répondu, tout va bien.
Un `403` en `text/html` sans cet en-tête : elle n'est pas joignable.

Un second droit, du même genre, manque aussi par défaut : les fonctions n'ont pas de clé
privée et demandent à Google de signer les jetons de session des patients. Il faut activer
l'API « IAM Service Account Credentials » et donner au compte de service le droit de signer
pour lui-même — `npm run autoriser:jetons`. Sans cela, l'échange d'un code échoue sur un
« INTERNAL », et **seulement pour un code valable** : un code inconnu est refusé avant la
signature, ce qui donne l'illusion que la fonction marche.

`npm run ouvrir:fonctions` repose le droit sur toutes les fonctions appelables, et le
déploiement le fait désormais tout seul. Le déclencheur Firestore et les tâches planifiées
en sont exclus : Google les invoque avec un compte de service, les ouvrir serait une faute.

## 7. Risques

| Risque | Parade |
|---|---|
| Dérive des occurrences après édition d'une série | ID déterministe + régénération idempotente + tests |
| Surbooking | Transaction serveur + test de concurrence automatisé |
| Code patient deviné | Hash + App Check + limitation de débit + expiration |
| Wifi hospitalier défaillant | PWA lecture seule + bandeau honnête |
| Plan du site jamais fourni | `<SitePlan>` isolé, fallback textuel dès L0 |
| Validation RGPD interne ACIS tardive | Registre de traitement + minimisation documentés dès L1 |
| Projet Firebase sur un compte personnel | Démonstration seulement ; bascule sur un compte ACIS avant toute mise en service (voir `IDEES.md` §2) |

---

## 7 bis. Idées mises de côté

Les idées formulées en cours de route et non planifiées sont consignées dans `IDEES.md` —
aujourd'hui, les activités proposées par les patients et la question du compte de
facturation. Elles n'entrent dans un lot que sur décision explicite.

## 8. Questions ouvertes bloquantes

Voir le message d'accompagnement (10 questions groupées). Aucune implémentation ne démarre avant
réponse aux questions 1, 2, 3 et 9 ; les autres peuvent être tranchées pendant L0.
