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
src/lib/data/
  ports.ts           interfaces consommées par l'interface (jamais Firebase directement)
  mock/              adapter en mémoire — démonstration et tests
  seed/              lieux, catégories et activités d'exemple
src/lib/ui/        design system et composants
src/lib/calendar/  vues jour, semaine, mois
src/routes/        écrans
src/lib/plan/      source du plan du site (voir plus bas)
```

Le découplage par interfaces (`ports.ts`) fait que brancher Firestore au lot L1 ne touchera
aucun composant : seule une implémentation s'ajoute à côté de `mock/`.

---

## Données de démonstration

Les lieux, les unités de soins et les activités sont **inventés** et marqués `// TODO` dans :

- `src/lib/data/seed/locations.seed.ts` — 10 lieux et les 5 unités de soins (à confirmer sur place)
- `src/lib/data/seed/categories.seed.ts` — 8 catégories d'activité
- `src/lib/data/seed/activities.seed.ts` — 13 activités réparties sur une semaine type

Remplacer ces fichiers suffit à changer toute la démonstration. En production, ces données seront
administrées depuis l'espace soignant, sans modification de code.

Les taux de remplissage affichés sont calculés à partir d'un hachage stable de l'identifiant
d'occurrence : la démonstration montre toujours les mêmes cas (places libres, dernières places,
complet avec liste d'attente).

---

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

## Déploiement

Cible retenue : **Firebase Hosting** (justification dans `PLAN.md` §4.7). La configuration arrive
au lot L4. Le build est un site statique (`npm run build` → `dist/`) et peut être servi par
n'importe quel hébergeur statique en attendant.
