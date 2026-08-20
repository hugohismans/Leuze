# Firestore quand on vient de Realtime Database

Guide de mise en service du projet Firebase, écrit pour quelqu'un qui connaît déjà
Realtime Database. Les deux produits partagent le nom « Firebase » et presque rien d'autre.

---

## 1. Le vocabulaire

| Realtime Database | Firestore | Remarque |
|---|---|---|
| Un seul arbre JSON | Des **collections** de **documents** | Il n'y a pas de racine unique qu'on lit d'un coup |
| Un nœud (`/activites/abc`) | Un **document** (`activities/abc`) | Un document est une table de champs typés |
| Un nœud parent | Une **collection** (`activities`) | Une collection ne contient que des documents |
| Nœud imbriqué | **Sous-collection** | `activities/abc/notes/xyz` |
| `push()` | `collection.add()` ou `doc()` sans identifiant | |
| Tout est chaîne, nombre, booléen ou objet | Types réels : `Timestamp`, `GeoPoint`, tableau, référence | Une date est un vrai `Timestamp`, pas un nombre |
| Facturé au **volume transféré** | Facturé au **document lu, écrit, supprimé** | Une requête qui renvoie 30 documents coûte 30 lectures |
| `.indexOn` | Index composites déclarés dans `firestore.indexes.json` | Les index à un seul champ sont automatiques |

Dans ce projet :

```
services/{id}         Le Mazurel, La Joncquerelle…            (paramétrable par l'admin)
locations/{id}        La salle polyvalente, le jardin…        (paramétrable par l'admin)
categories/{id}       Sport, créatif, relaxation…             (paramétrable par l'admin)
activities/{id}       la série : « Yoga, tous les mardis 14h »
occurrences/{id}      une date précise : « Yoga, mardi 2 septembre 14h »
registrations/{id}    une inscription : occurrence + patient + statut
patients/{uid}        prénom + service. Rien d'autre.
patientCodes/{hash}   l'empreinte d'un code d'accès -> l'identifiant du patient
staff/{uid}           l'affichage des comptes soignants
config/app            les réglages (durée de conservation, validité des codes…)
```

Remarque : `occurrences` est une collection **à plat**, pas une sous-collection de
`activities`. En Realtime Database, on aurait imbriqué. Ici, la mettre à plat permet la
requête qui fait tout le calendrier : « toutes les occurrences entre deux dates, visibles
par mon service », en une fois, sans parcourir les activités.

---

## 2. Les cinq pièges quand on vient de Realtime Database

### 2.1 Les règles ne cascadent pas

En Realtime Database, autoriser `/activites` autorise tout ce qui est en dessous. **En
Firestore, non.** Chaque bloc `match` est indépendant : une règle sur `activities/{id}`
ne dit rien de `activities/{id}/notes/{n}`. Pour couvrir une arborescence, il faut
l'écrire explicitement (`match /{document=**}`).

C'est plus verbeux, mais c'est ce qui permet d'avoir, comme ici, des règles très
différentes d'une collection à l'autre.

### 2.2 « Les règles ne sont pas des filtres »

C'est **le** piège. En Realtime Database, on lit ce à quoi on a droit. En Firestore, une
requête est évaluée document par document, et **si un seul document de la réponse viole
la règle, toute la requête est refusée** — elle ne renvoie pas un sous-ensemble.

Conséquence directe pour nous, et c'est voulu : le patient doit demander

```js
where('audienceKeys', 'array-contains-any', ['all', sonService])
```

S'il demande le calendrier sans ce filtre, Firestore refuse **tout**. Une activité
réservée à un autre service n'arrive donc jamais dans son navigateur — pas même son titre.
C'est exactement ce que vérifient les tests de `tests/rules/occurrences.test.ts`.

### 2.3 Les règles ne s'appliquent PAS partout

Les règles protègent les clients : navigateur, application mobile. Elles sont **ignorées** par :

- la **console Firebase** (tu vois tout, tu peux tout modifier — c'est normal) ;
- le **SDK d'administration** (`firebase-admin`), donc nos **Cloud Functions** ;
- les scripts qui utilisent une clé de compte de service.

C'est pour ça que les fonctions peuvent lire `patients` alors que les règles l'interdisent
à tout le monde. Et c'est aussi pour ça qu'une clé de compte de service ne doit jamais
sortir de ta machine : elle contourne l'intégralité de ce qui précède.

### 2.4 Il n'y a pas de jointure

Aucune. On ne « suit » pas une référence côté serveur. Deux réponses possibles : faire une
seconde lecture, ou **dénormaliser**. Ici, chaque occurrence porte déjà le titre, le lieu,
la catégorie et l'audience de son activité, ce qui évite au calendrier de lire quoi que ce
soit d'autre. La contrepartie — resynchroniser quand la série change — est prise en charge
par la fonction `onActivityWritten`.

### 2.5 Les transactions sont bien plus utiles

En Realtime Database, `transaction()` porte sur un nœud. En Firestore, une transaction lit
plusieurs documents, décide, puis écrit — et Firestore la rejoue automatiquement si un
autre client a touché l'un des documents lus entre-temps.

C'est ce qui garantit qu'une place unique ne peut pas être attribuée deux fois. Le test
`tests/backend/inscriptions.test.ts` lance cinq inscriptions simultanées sur une place :
il en sort un confirmé et quatre positions d'attente distinctes.

Deux contraintes à connaître : **toutes les lectures avant toutes les écritures**, et
500 écritures maximum par transaction.

---

## 3. La console, écran par écran

### Build > Firestore Database

- **Données** : l'explorateur. Tu y verras les collections listées plus haut après le seed.
  Rappel : ici, tu es propriétaire, les règles ne s'appliquent pas à toi.
- **Règles** : le contenu de `firestore.rules`. Ne pas l'éditer ici — le fichier du dépôt
  fait autorité, et l'édition en ligne serait écrasée au prochain déploiement.
- **Index** : les index composites. Ils apparaîtront après `firebase deploy`.
  Un index se construit en quelques minutes ; tant qu'il n'est pas « Activé », la requête
  correspondante échoue avec un message contenant un lien direct pour le créer.
- **Utilisation** : le nombre de lectures et d'écritures. Utile pour vérifier qu'on reste
  dans le quota gratuit.

### Le « mode test »

Le mode test écrit ceci :

```
allow read, write: if request.time < timestamp.date(2026, 9, 20);
```

C'est-à-dire : **n'importe qui**, avec la configuration Web (qui est publique par nature),
peut lire et écrire l'intégralité de la base jusqu'à cette date. Tant que la base est vide,
ce n'est pas grave. Il ne faut simplement rien y mettre de réel avant d'avoir déployé nos
règles.

### Build > Authentication

Onglet **Sign-in method** : activer **Adresse e-mail/Mot de passe**, et rien d'autre.
Les patients ne passent pas par là : ils reçoivent un jeton personnalisé en échange de leur
code court, fabriqué par la fonction `exchangeCode`.

Le **rôle** d'un compte (soignant, administrateur) n'est pas un champ de base de données :
c'est un « custom claim » posé dans le jeton d'authentification. Il ne se règle pas depuis
la console — d'où le script `npm run promote:admin`.

### Paramètres du projet > Général > Vos applications

C'est là qu'on récupère la configuration Web (`apiKey`, `projectId`…), à coller dans `.env`.
Ces valeurs ne sont pas des secrets : elles partent dans le navigateur de chaque visiteur.

### Paramètres du projet > Comptes de service

À ne pas toucher. Le fichier JSON qu'on y télécharge contient une `private_key` qui
contourne toutes les règles. Il ne va ni dans le dépôt, ni dans une conversation.

---

## 4. L'emplacement, à vérifier tout de suite

L'emplacement d'une base Firestore est **définitif**. Il ne peut jamais être modifié.

Il doit être **`eur3`** (Europe multirégional) ou **`europe-west1`** (Belgique). Pour des
données concernant des patients d'un hôpital belge, un hébergement américain est un
problème juridique, pas un détail technique.

Si l'emplacement est mauvais : tant que la base est vide, le plus simple et le plus sûr est
de **créer un nouveau projet Firebase** en choisissant le bon emplacement, et d'abandonner
le premier. Cela ne coûte rien.

---

## 5. Mise en service, dans l'ordre

1. Vérifier l'emplacement de Firestore (§4).
2. **Authentication** → activer Adresse e-mail/Mot de passe.
3. Créer une **application Web** dans les paramètres, copier la configuration dans `.env`.
4. Passer le projet en **plan Blaze** — obligatoire pour les Cloud Functions, sans
   lesquelles il n'y a ni inscription atomique ni codes patients. L'usage réel reste dans
   le quota gratuit ; mettre malgré tout une **alerte de budget à 5 €**.
5. Déployer les règles et les index — cela remplace immédiatement le mode test :

   ```bash
   firebase login
   cp .firebaserc.example .firebaserc     # y mettre l'identifiant du projet
   firebase deploy --only firestore:rules,firestore:indexes
   ```

6. Définir le poivre des codes patients :

   ```bash
   firebase functions:secrets:set CODE_PEPPER
   ```

7. Déployer les fonctions, puis créer le premier administrateur :

   ```bash
   firebase deploy --only functions
   npm run promote:admin -- prenom.nom@acis-asbl.be
   ```

Tant que ces étapes ne sont pas faites, tout se teste en local avec `npm run emulators`,
qui reproduit Firestore, Auth et les fonctions sans toucher au projet réel.
