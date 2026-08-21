# CLAUDE.md — Conventions du projet

App web « Activités » — Hôpital psychiatrique Saint-Jean-de-Dieu, Leuze-en-Hainaut.
Lire `PLAN.md` avant toute modification d'architecture.

---

## Règles absolues

1. **Aucune donnée médicale.** Pas de diagnostic, pas de note clinique, pas de dossier, pas de nom
   de famille, pas de date de naissance, pas de numéro de patient. Si une fonctionnalité demandée
   en implique une, s'arrêter et poser la question.
2. **Aucune écriture client sur `registrations` ni `patients`.** Tout passe par une Cloud Function
   callable. Les règles Firestore refusent le reste.
3. **Le filtrage par service n'est jamais fait dans l'interface.** Une activité réservée à un
   autre service ne doit pas atteindre le navigateur du patient : le filtre vit dans la couche
   de données (`listBetween`, `get`) et sera doublé par les règles Firestore. Un filtre de rendu
   laisserait fuiter les titres.
4. **`src/lib/domain/**` n'importe jamais Firebase**, ni `window`, ni Svelte. Fonctions pures,
   testées. C'est la seule partie du code où un bug est cher.
5. **On s'inscrit à une séance, jamais à une série.** La récurrence sert uniquement à
   *créer* des séances côté soignant. Aucune inscription ne raisonne en `seriesId` :
   ni bouton « toutes les séances », ni report automatique d'une semaine sur l'autre.
   Une personne qui ne vient plus doit simplement cesser de s'inscrire, sans avoir à
   défaire quoi que ce soit.
6. **Ne jamais supprimer physiquement** une activité ou une occurrence portant des inscriptions.
   `isActive: false` / `status: 'cancelled'` avec motif.
7. **Le rôle qui fait autorité est le « custom claim »**, pas le document `staff/`.
   Un document Firestore ne décide jamais d'un droit : les règles lisent le jeton.
8. **Pas de librairie de calendrier générique** (FullCalendar & co). Vues construites à la main
   avec `date-fns` (locale `fr`, `weekStartsOn: 1`, fuseau `Europe/Brussels`).

---

## Stack

- Vite + TypeScript **strict** + **Svelte 5 runes** (`$state`, `$derived`, `$effect`).
  Pas de store legacy (`writable`/`readable`), pas de `export let` — `$props()`.
- Tailwind CSS + tokens maison (`src/lib/ui/tokens.css`). Pas de CSS ad hoc dans les composants
  sauf cas justifié.
- Firebase : Firestore, Auth, Functions (`europe-west1`), Hosting.
- Tests : Vitest (domaine, composants), `@firebase/rules-unit-testing` (règles) sur émulateurs.

---

## Accessibilité — critères de refus en revue

Une PR est refusée si l'un de ces points est violé :

- Taille de police de base **< 18 px**, ou cible tactile **< 56 px** de hauteur.
- Contraste sous WCAG **AA** (viser AAA sur le texte principal).
- Information portée **par la couleur seule** — toujours doubler d'un texte ou d'une icône.
- `div` cliquable au lieu d'un `<button>` / `<a>`. HTML sémantique obligatoire.
- Focus clavier invisible, ou piège au clavier.
- Animation non désactivée sous `prefers-reduced-motion`.
- Plus de **2 niveaux de profondeur** côté patient (calendrier → fiche activité).
- Absence du bouton « Retour », ou bouton « Retour » qui change de place.

### Langue de l'interface

Français simple, **vouvoiement**, phrases courtes, **aucune abréviation**, aucun jargon
(ni informatique, ni soignant). Écrire « Vous êtes inscrit », pas « Inscription confirmée ».
Écrire « Mardi 14h00 → 15h30 », pas « 14:00-15:30 ». Les messages d'erreur disent quoi faire :
« Ce code n'est pas reconnu. Demandez un nouveau code à un soignant. »

---

## Structure

```
src/lib/domain/    logique pure (récurrence, capacité, liste d'attente, audience, temps) — 100 % testée
src/lib/data/      ports.ts (interfaces) + firestore/ + mock/ + seed/
src/lib/ui/        design system
src/routes/        écrans : patient/, staff/, admin/, demo/
functions/         Cloud Functions (le domaine y est recopié, voir plus bas)
tests/rules/       tests des règles Firestore
tests/backend/     transactions et génération d'occurrences, sur émulateur
```

`functions/src/domain/` et `functions/src/config.ts` sont des **copies générées** de
`src/lib/domain/` et `src/lib/config.ts` — Firebase ne téléverse que le dossier `functions/`.
Ne jamais les modifier directement : corriger la source, puis
`npm --prefix functions run sync:domain`. `npm run check:functions` échoue si la copie a divergé.

L'UI n'importe **jamais** `firebase/*` directement : elle consomme les interfaces de
`src/lib/data/ports.ts`. L'écran `/demo` est la même app branchée sur l'adapter mock.

---

## Commandes

*(à jour à mesure des lots — L0 les met en place)*

| Commande | Effet |
|---|---|
| `npm run dev` | app en dev (adapter mock par défaut si les émulateurs sont éteints) |
| `npm run emulators` | Firestore + Auth + Functions en local |
| `npm run seed` | injecte services, lieux, catégories, activités, comptes et code patient |
| `npm test` | Vitest (domaine + composants) — sans émulateur |
| `npm run test:rules` | règles Firestore, sur émulateur (démarré automatiquement) |
| `npm run test:backend` | transactions d'inscription et génération d'occurrences, sur émulateur |
| `npm run check` | `svelte-check` + `tsc --noEmit` |
| `npm run check:functions` | typage des Cloud Functions |
| `npm run promote:admin` | donne le rôle administrateur à un compte existant |
| `npm run journal` | dernières lignes du journal des Cloud Functions en ligne |
| `npm run ouvrir:fonctions` | redonne aux fonctions appelables le droit d'être appelées (fait automatiquement à chaque publication ; à la main en dépannage) |
| `npm run autoriser:jetons` | autorise les fonctions à ouvrir une session pour un patient |
| `npm run connexion` | reconnecte le CLI Firebase sans rien coller dans le terminal |
| `npm run connecter:github` | autorise GitHub à publier — une seule fois, sans clé |
| `npm run build` | build de production |

---

## Git

- Branche de travail : `claude/firebase-admin-login-project-diqd22`.
- **Messages de commit en français**, à l'impératif, préfixe de portée :
  `domaine: gère le passage à l'heure d'hiver dans la récurrence`
  `patient: ajoute la vue jour`
  `regles: interdit la lecture des inscriptions d'autrui`
- Commits **atomiques** : un commit = un changement cohérent qui laisse `npm test` vert.
- Pas de secret, pas de clé de service, pas de `.env` dans le dépôt.

---

## Conventions de code

- Nommage du code et des types en **anglais** (`Occurrence`, `waitlistPosition`) ; textes
  d'interface, commentaires métier et commits en **français**.
- Dates : `Timestamp` Firestore pour l'ordre, `localDate: 'yyyy-MM-dd'` (heure locale Bruxelles)
  pour le regroupement par jour. Ne jamais dériver un jour d'un `Timestamp` UTC côté UI.
- Toute logique testable est extraite dans `domain/` avant d'être branchée à un composant.
- Pas de `any`. Pas de `!` non-null sans commentaire justifiant.
- Les identifiants d'occurrence sont **déterministes** : `{activityId}_{yyyyMMddTHHmm}`.

---

## Rappel de périmètre — hors sujet, à refuser

Messagerie patient ↔ soignant · dossier patient · données de santé · notation ou évaluation des
patients · statistiques nominatives de participation · géolocalisation · analytics tiers.
