# Les activités — Hôpital psychiatrique Saint-Jean-de-Dieu, Leuze-en-Hainaut

Application web du programme des activités thérapeutiques : le patient consulte le calendrier,
voit **où** chaque activité a lieu et s'inscrit quand les places sont limitées. Le personnel
soignant crée et annule les activités, et voit les inscrits.

- **`PLAN.md`** — architecture, décisions tranchées, découpage en lots, points de désaccord assumés.
- **`CLAUDE.md`** — conventions du projet (accessibilité, code, git).

> **Aucune donnée médicale.** Pas de diagnostic, pas de note clinique, pas de dossier patient,
> pas de nom de famille. Voir `PLAN.md` §1.

---

## Où en est le projet

| Lot | Contenu | État |
|---|---|---|
| **L0** | Socle, logique métier testée, écran de démonstration sur données fictives | **fait** |
| L1 | Backend Firebase : règles, Cloud Functions, seed vers l'émulateur | à venir |
| L2 | Application patient réelle, code d'accès, mode borne, PWA hors ligne | à venir |
| L3 | Espace soignant et administration | à venir |
| L4 | Audit d'accessibilité, déploiement, sauvegardes | à venir |
| L5 | Plan interactif du site, export PDF du programme, rappels | à venir |

À ce stade, l'application tourne **entièrement sans backend** : elle est branchée sur un adapter
en mémoire (`src/lib/data/mock/`). C'est la version montrable à la direction.

---

## Installation

```bash
npm install
npm run dev      # http://localhost:5173
```

Aucune clé, aucun compte, aucune configuration : la démonstration ne dépend d'aucun service.

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` | build de production dans `dist/` |
| `npm run preview` | sert le build de production |
| `npm test` | tests unitaires du domaine (Vitest) |
| `npm run check` | vérification TypeScript et Svelte |

À partir du lot L1 s'ajouteront `npm run emulators`, `npm run seed` et `npm run test:rules`.

---

## Structure

```
src/lib/domain/    logique métier pure — aucune dépendance Firebase, entièrement testée
  time.ts            fuseau Europe/Brussels, semaine au lundi, formats en français
  recurrence.ts      dépliage des séries, exceptions, scission « et les suivantes »
  capacity.ts        état des places et messages destinés au patient
  waitlist.ts        inscription, liste d'attente, promotion
  audience.ts        quelles activités sont ouvertes à quels services
src/lib/data/
  ports.ts           interfaces consommées par l'interface (jamais Firebase directement)
  mock/              adapter en mémoire — démonstration et tests
  seed/              lieux, catégories et activités d'exemple
src/lib/ui/        design system et composants
src/lib/calendar/  vues jour, semaine, mois
src/routes/        écrans
src/lib/plan/      source du plan du site (voir plus bas)
src/lib/brand/     logo ACIS
```

Le découplage par interfaces (`ports.ts`) fait que brancher Firestore au lot L1 ne touchera
aucun composant : seule une implémentation s'ajoute à côté de `mock/`.

---

## Données de démonstration

Les lieux, les unités de soins et les activités sont **inventés** et marqués `// TODO` dans :

- `src/lib/data/seed/locations.seed.ts` — 10 lieux inventés
- `src/lib/data/seed/services.seed.ts` — les services de l'hôpital
- `src/lib/data/seed/categories.seed.ts` — 8 catégories d'activité
- `src/lib/data/seed/activities.seed.ts` — 14 activités réparties sur une semaine type

Les six unités de soins (La Couturelle, La Joncquerelle, Le Mazurel, L'Ancrive, Le Mesnil,
L'Escalette) proviennent du site de l'établissement et restent à vérifier sur place ; L'Écheveau,
le service culturel et Jean Crelle ont été cités oralement et sont marqués `TODO`.

Remplacer ces fichiers suffit à changer toute la démonstration. En production, ces données seront
administrées depuis l'espace soignant, sans modification de code.

Les taux de remplissage affichés sont calculés à partir d'un hachage stable de l'identifiant
d'occurrence : la démonstration montre toujours les mêmes cas (places libres, dernières places,
complet avec liste d'attente).

---

## La réunion de début de semaine

Le lundi, l'équipe annonce les activités et note sur une feuille qui veut participer.
L'écran « Réunion du lundi » (`#/soignant/reunion`) remplace cette feuille : les activités
à venir défilent une par une, les prénoms des patients concernés s'affichent, un appui
inscrit, un second retire.

Un patient n'a donc **jamais besoin de l'application** pour être inscrit. S'il l'ouvre, il
y retrouve ses inscriptions déjà faites et peut en ajouter d'autres.

## Les patients et leurs codes

Un soignant crée une personne avec **un prénom et un service** — rien d'autre, et l'écran
ne propose aucun champ pour saisir autre chose. L'application délivre alors un code à six
caractères, affiché **une seule fois** : la base n'en garde que l'empreinte scrypt. Perdu,
il ne se retrouve pas ; on en délivre un nouveau, ce qui invalide l'ancien.

« Fin de séjour » retire la personne des listes et rend son code inutilisable. Ses
inscriptions passées restent jusqu'à la purge automatique.

Cet écran demande les Cloud Functions, donc le plan Blaze : le code est dérivé côté
serveur avec un poivre secret, ce qu'un navigateur ne peut pas faire.

## « Ma semaine », côté patient

Depuis « Mes inscriptions », le patient ouvre sa propre semaine : ses activités et ses
rendez-vous mêlés, dans l'ordre de chaque journée. La page sert à trois usages avec la
même mise en page — la consulter, en faire une **capture d'écran** à garder dans son
téléphone, ou l'**imprimer** (A4 portrait, une page).

Elle indique toujours que les horaires peuvent changer : une feuille imprimée devient
fausse dès qu'une activité est annulée, et l'écrire est la seule façon honnête de le dire.

## Rendez-vous individuels

Un patient demande à voir le psychiatre, le psychologue, le kinésithérapeute… depuis
« Mes inscriptions ». Un soignant consulte l'agenda et fixe la date depuis l'onglet
« Rendez-vous » ; le rendez-vous apparaît alors dans le calendrier du patient.

**Aucun champ libre**, ni côté patient ni côté soignant : le patient dit qui il veut voir,
jamais pourquoi. Les règles Firestore rejettent une demande qui contiendrait autre chose.
L'écran indique aussi, avant tout le reste, que ce n'est pas un moyen d'alerter en urgence.

## Services et visibilité des activités

Une activité est **ouverte à tous les services** ou **réservée à un, deux, trois d'entre eux** :
le ping-pong du mardi n'est proposé qu'à La Joncquerelle. Le patient ne reçoit que ce qui le
concerne — le filtrage est fait dans la couche de données, pas à l'affichage, et sera doublé par
les règles Firestore au lot L1 (voir `PLAN.md` §4.8). Un accès direct à l'adresse d'une activité
d'un autre service ne renvoie rien.

Dans la démonstration, un panneau en bas de page permet de changer le service du patient fictif
pour observer l'effet immédiatement. Ce panneau n'existera pas dans l'application livrée.

Une activité réservée à **aucun** service n'est visible par personne : elle est signalée comme
telle au soignant plutôt que de disparaître en silence.

## Le plan du site

Le plan n'est pas encore fourni. Le composant `<SitePlan>` existe déjà, isolé, et **ne rend rien**
tant que `src/lib/plan/sitePlan.ts` expose `svg: null` : la fiche activité reste complète grâce au
nom du lieu et aux indications pour s'y rendre, sans espace vide ni message d'attente.

### Format SVG attendu

- Un **fichier SVG unique**, avec un attribut `viewBox` et **sans** `width`/`height` figés
  (par exemple `viewBox="0 0 1200 800"`), pour qu'il s'adapte à la largeur de l'écran.
- **Une zone cliquable par lieu** : un `<path>` ou un `<g>` portant un `id` stable, en minuscules,
  sans accent ni espace — par exemple `id="salle-polyvalente"`.
- Les zones doivent avoir une surface pleine (`fill`), même transparente, sinon elles ne sont pas
  cliquables au centre.
- **Aucun texte identifiant l'établissement** dans le fichier : ni nom, ni logo, ni adresse.
- Les traits fins d'un plan d'évacuation scanné sont à vectoriser ; une image bitmap intégrée dans
  un SVG ne permet pas de mettre une zone en évidence.

Une fois le fichier fourni : le déposer dans `src/lib/plan/`, l'importer dans `sitePlan.ts`, puis
associer chaque `id` de zone à un lieu depuis l'écran d'administration « Lieux → zone du plan »
(champ `Location.planZoneId`). **Aucune modification de code n'est nécessaire pour cette
association.**

---

## Accessibilité

Les règles appliquées et opposables en revue sont dans `CLAUDE.md`. En résumé : police de base
18 px, cibles tactiles de 56 px minimum, contrastes WCAG AA au minimum, information jamais portée
par la couleur seule, navigation clavier complète, bouton « Retour » toujours au même endroit,
deux niveaux de profondeur maximum côté patient, et respect de `prefers-reduced-motion`.

Un constat de mesure à connaître : la vue semaine n'affiche 7 colonnes qu'à partir de 1536 px de
large. En dessous, une colonne ne peut plus afficher un titre sans couper un mot en deux ; elle
dégrade donc en liste groupée par jour. Voir `PLAN.md` §6.8.

---

## Identité visuelle

Le logo est celui du groupe ACIS, récupéré sur le site public de l'association
(`acis_logo_blanc.svg`) et placé dans `src/lib/brand/`. Il reste la propriété d'ACIS : son usage
doit être validé par le service communication avant la mise en service. La palette de
l'application (marine `#1a1a38`, bleu `#236bc3`, vert `#299b5c`) est reprise de ce logo.

## Le backend Firebase

### Démarrer en local

```bash
npm run emulators          # Firestore, Auth et Functions, sur les ports de firebase.json
npm run seed               # dans un autre terminal
npm run dev:firestore      # l'application, branchée sur les émulateurs
```

`npm run dev` lance l'application sur les données fictives (écran de démonstration) ;
`npm run dev:firestore` la branche sur les émulateurs, avec les vraies règles, les vraies
transactions et la connexion par code.

Le seed crée deux comptes du personnel (`admin@exemple.test` et `soignant@exemple.test`,
mot de passe `demonstration`) et un code patient fixe : **4KT9RM** (Camille, Le Mazurel).
Il est idempotent — les identifiants d'occurrence sont déterministes.

### Tests

| Commande | Ce qui est vérifié |
|---|---|
| `npm test` | le domaine, sans émulateur |
| `npm run test:rules` | les règles Firestore : isolement des services, des inscriptions, des identités |
| `npm run test:backend` | les transactions d'inscription et la génération d'occurrences |

Les deux dernières démarrent l'émulateur autour de la suite. Java est nécessaire.

Le déclencheur Firestore `onActivityWritten` passe par Eventarc. Sur une machine où
l'émulateur n'arrive pas à l'enregistrer (il refuse alors de démarrer), créer un fichier
`functions/.env.local` contenant `LEUZE_NO_FIRESTORE_TRIGGER=1` : les émulateurs démarrent
sans lui, et la régénération reste disponible par l'appel `regenerateSeries`. Ce fichier
n'est jamais déployé.

### Ce que les règles garantissent

1. Une activité réservée à un autre service **n'atteint pas** le navigateur du patient,
   ni par une requête, ni par une adresse devinée. Le calendrier est servi par une seule
   requête `array-contains-any ['all', service]`, et les règles vérifient la même condition.
2. Un patient ne lit **que** sa propre inscription ; la liste des inscrits n'est jamais
   servie à un client patient.
3. **Aucune** écriture client sur `registrations` ni `patients` : la capacité et la liste
   d'attente ne changent que dans une transaction de Cloud Function.
4. `patients` et `patientCodes` ne sont lisibles par personne — pas même par le personnel.
   Les prénoms des listes d'inscrits passent par la fonction `staffRoster`.

### Les Cloud Functions

| Fonction | Rôle |
|---|---|
| `onActivityWritten` | régénère les occurrences d'une série dès qu'elle change |
| `extendOccurrenceWindow` | chaque nuit à 3 h, repousse la fenêtre de 12 semaines |
| `register` / `unregister` | inscription et désinscription du patient, en transaction |
| `staffRegister` / `staffUnregister` / `staffPromote` | les mêmes gestes, faits par un soignant |
| `staffRoster` | liste des inscrits avec les prénoms |
| `createPatientCode` / `revokePatientCode` | délivrance et révocation d'un code |
| `exchangeCode` | échange d'un code contre une session Firebase |
| `setStaffRole` | attribution des rôles |
| `purgeExpiredData` | chaque nuit à 3 h 30, efface ce qui a dépassé la durée de conservation |

Le code du domaine (récurrence, capacité, liste d'attente, audience) est **recopié** dans
`functions/src/domain/` au moment du build : Firebase ne téléverse que le dossier `functions/`.
La source reste `src/lib/domain/`. `npm run check:functions` échoue si la copie a divergé.

### Codes patients

Un code fait six caractères d'un alphabet sans ambiguïté (ni I, ni L, ni O, ni U). Il n'est
**jamais stocké en clair** : l'identifiant du document `patientCodes` est son empreinte,
dérivée par scrypt avec un poivre secret. Une fuite de la base ne donne donc aucun code
utilisable, et un code de six caractères ne se devine pas à l'échelle par force brute.

En production, le poivre est obligatoire :

```bash
firebase functions:secrets:set CODE_PEPPER
```

Sans lui, les fonctions refusent de démarrer — sauf sur l'émulateur, qui utilise une valeur
de développement.

### Brancher l'application sur un vrai projet

```bash
cp .env.example .env       # y coller la configuration Web du projet
```

Ces valeurs (`apiKey`, `projectId`…) **ne sont pas des secrets** : elles partent dans le
navigateur de chaque visiteur, c'est le fonctionnement normal de Firebase. Ce qui protège
les données, ce sont les règles de sécurité, pas la confidentialité de ces clés. En
revanche, une **clé de compte de service** (fichier JSON contenant `private_key`) ne doit
jamais entrer dans le dépôt : elle contourne toutes les règles.

### Deux constructions, deux paquets

| Commande | Source de données | Poids |
|---|---|---|
| `npm run build:demo` | données fictives | 129 Ko |
| `VITE_DATA_SOURCE=firestore npm run build` | le vrai projet | 905 Ko |

La construction de démonstration ne contient **pas une ligne du SDK Firebase** : l'adapter
est remplacé à la compilation par un module vide (alias `$adapter`). Elle se charge vite et
n'a aucun moyen de contacter un serveur — c'est celle qu'on met en ligne pour montrer
l'application, et elle fonctionne sur le plan gratuit de Firebase Hosting.

```bash
npm run deploy:demo      # met la démonstration en ligne (plan Spark, gratuit)
npm run deploy:regles    # déploie les règles et les index (plan Spark, gratuit)
```

### Ce qui exige le plan Blaze

Les **Cloud Functions** ne sont pas disponibles sur le plan gratuit Spark. Sans elles :
inscription atomique, codes patients, génération d'occurrences et purge automatique ne
peuvent pas être déployés. Tout cela fonctionne en revanche sur les émulateurs, sans
compte de facturation.

Firestore, l'authentification, les règles, les index et l'hébergement fonctionnent sur
Spark. On peut donc mettre la démonstration en ligne et travailler entièrement en local
en attendant.

### Mise en service d'un projet Firebase

```bash
cp .firebaserc.example .firebaserc     # y mettre l'identifiant du projet
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
npm run promote:admin -- prenom.nom@acis-asbl.be
```

Le premier administrateur doit être promu par script : un rôle est un « custom claim » du
jeton, il ne se pose pas depuis la console. Ensuite, tout se fait dans l'application.

## Deux adresses, deux usages

| Adresse | Contenu | Pour qui |
|---|---|---|
| `hugohismans.github.io/Leuze/` | démonstration, données fictives | montrer le projet, partager un lien |
| `leuze-d23b5.web.app` | application réelle, Firestore | l'hôpital, une fois le projet en service |

### GitHub Pages — la démonstration

Publiée par `.github/workflows/pages.yml` à chaque envoi. Réglage à faire une fois :
**Settings > Pages > Source : GitHub Actions**. Le workflow refuse de publier si les tests
ou la vérification des types échouent.

La version publiée est construite avec `VITE_DATA_SOURCE=mock` : l'adapter Firestore est
remplacé par un module vide, et **le SDK Firebase disparaît entièrement du paquet**
(129 Ko au lieu de 884 Ko). Cette adresse publique ne peut donc pas atteindre la base,
même en cas de manipulation de l'URL.

GitHub Pages ne permet pas de définir d'en-têtes HTTP : le `noindex` repose sur la balise
`<meta name="robots">` de `index.html`.

### Firebase Hosting — l'application réelle

`npm run deploy:demo` publie la même démonstration sur Firebase Hosting, avec les en-têtes
de sécurité configurés dans `firebase.json`. C'est cette adresse qui servira l'application
réelle : même origine que les Cloud Functions, donc aucune configuration CORS.

## Déploiement

Cible retenue : **Firebase Hosting** (justification dans `PLAN.md` §4.7). La configuration arrive
au lot L4. Le build est un site statique (`npm run build` → `dist/`) et peut être servi par
n'importe quel hébergeur statique en attendant.
