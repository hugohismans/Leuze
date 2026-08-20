# Idées à instruire

Ce fichier n'est pas un plan. Il garde les idées formulées en cours de route, avec ce
qu'elles impliqueraient, pour qu'on décide plus tard en connaissance de cause. Rien de ce
qui suit n'est développé, ni planifié.

---

## 1. Les patients proposent une activité

**L'idée.** Un patient propose une activité — une soirée jeux de société, un atelier tricot
qu'il animerait lui-même. La proposition n'arrive pas dans le calendrier : elle part dans
une file d'attente, et un soignant la valide, l'ajuste et la programme.

C'est une bonne idée, et pas seulement fonctionnellement : dans un projet thérapeutique,
proposer quelque chose et le voir advenir n'a pas le même effet que consommer un programme
fait par d'autres. Cela mérite d'être bien fait plutôt que vite fait.

### Ce que ça suppose, en gros

Une collection `activityProposals`, séparée de `activities` :

```
activityProposals/{id}
  proposerUid      l'UID patient — jamais un nom de famille
  title            « Atelier tricot »
  description      texte libre écrit par le patient
  wishedMoment     « plutôt en fin d'après-midi » — une envie, pas un créneau
  animatedByPatient  vrai si le patient veut l'animer lui-même
  status           'proposee' | 'en-discussion' | 'programmee'
  activityId       renseigné une fois programmée
  createdAt
```

Règles de sécurité :
- le patient **crée** sa proposition et **relit la sienne** ; jamais celles des autres ;
- le personnel lit tout, mais **n'écrit jamais** dans `activities` depuis la proposition
  automatiquement : la programmation reste un geste explicite ;
- aucune suppression : une proposition non retenue reste, avec sa trace.

Écrans : un bouton « Proposer une activité » côté patient (troisième niveau de profondeur —
voir le point de vigilance plus bas), un écran « Propositions » côté soignant, et la
reprise d'une proposition dans le formulaire de création existant, pré-rempli.

### Les points à trancher avant d'écrire quoi que ce soit

1. **Le texte libre est le point sensible.** C'est exactement l'endroit où une donnée de
   santé finit par arriver : « je voudrais faire du tricot parce que mon traitement me
   fatigue les mains ». La règle du projet est « aucune donnée médicale », et un champ
   libre ouvert à des patients la met en tension.
   Piste : champ court, avertissement explicite au-dessus (« n'écrivez pas ce qui concerne
   votre santé »), et surtout **le texte du patient n'est jamais publié tel quel** — le
   soignant réécrit la description au moment de programmer. La proposition d'origine
   n'est lisible que par le personnel.

2. **Ne jamais afficher un refus.** Pour ce public, « Proposition refusée » est une phrase
   qui peut faire mal, et un statut binaire ne rend pas compte de ce qui se passe vraiment
   (« pas maintenant », « pas cette salle », « on en reparle »). Piste : aucun statut
   « refusée » côté patient. La seule chose qu'il voit, c'est « Un soignant va en parler
   avec vous », puis, le cas échéant, l'activité dans le calendrier. La conversation est le
   canal, l'application ne fait que la déclencher.

3. **Comment le patient est-il prévenu ?** Même problème que la liste d'attente : il n'y a
   ni courriel ni SMS. La réponse est probablement la même — le soignant le lui dit de
   vive voix, et l'application affiche l'état sans rien promettre.

4. **Faut-il nommer le patient qui anime ?** « Animé par Camille » dans le calendrier, cela
   valorise — et cela révèle à tous les lecteurs du calendrier que Camille est hospitalisée.
   Le calendrier n'étant lisible que par des personnes de l'établissement, le risque est
   contenu, mais ce doit rester **un choix du patient**, demandé explicitement, prénom
   seulement, révocable.

5. **Deux niveaux de profondeur, pas plus.** La règle d'accessibilité du projet limite
   l'écran patient à « calendrier → fiche activité ». Un formulaire de proposition en
   ajoute un. Piste : y accéder depuis « Mes inscriptions » plutôt que depuis le
   calendrier, pour ne pas alourdir l'écran d'accueil.

6. **Qu'un patient anime un atelier est une décision de soin**, pas une décision de produit.
   L'application ne doit ni l'encourager ni l'empêcher : elle offre le geste, l'équipe
   décide. Cela plaide pour que le formulaire reste sobre, sans rien qui ressemble à une
   candidature ou à une évaluation.

### Ce que ça demanderait

Techniquement, c'est petit : une collection, quelques règles, deux écrans, et la reprise du
formulaire existant. L'essentiel du travail est dans les formulations et dans le parcours
en cas de « non ». À faire après le lot L3, et pas avant que les inscriptions fonctionnent.

---

## 2. Facturation et propriété du projet Firebase

**Décidé.** La démonstration tourne sur le compte personnel, avec une carte personnelle,
le temps de convaincre. Avant toute mise en service avec de vrais patients, le projet
bascule sur un compte de l'hôpital, avec la facturation d'ACIS.

Ce n'est pas qu'une question d'argent : au sens du RGPD, le responsable du traitement doit
être l'établissement. Le jour du basculement, il faudra recréer le projet côté ACIS
(l'emplacement d'une base Firestore n'étant pas modifiable, ce sera de toute façon une
création) et rejouer le seed. Rien à changer dans le code, sauf la configuration Web.
