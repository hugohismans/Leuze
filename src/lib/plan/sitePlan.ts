/**
 * Source du plan du site.
 *
 * Le plan n'est pas encore fourni : `svg` vaut `null` et le composant `<SitePlan>`
 * ne rend rien du tout. La fiche activité reste complète grâce au nom du lieu et
 * aux indications textuelles — aucun espace vide, aucun message d'attente.
 *
 * Format attendu quand le plan sera disponible (voir aussi README.md) :
 *  - un fichier SVG unique, avec un `viewBox` (pas de largeur/hauteur figées) ;
 *  - une zone cliquable par lieu : un `<path>` ou un `<g>` portant un `id` stable
 *    en minuscules sans accent, par exemple `id="salle-polyvalente"` ;
 *  - aucun texte identifiant l'établissement dans le SVG ;
 *  - les `id` sont ensuite associés aux lieux depuis l'écran d'administration
 *    « Lieux → zone du plan » (champ `Location.planZoneId`), sans toucher au code.
 */
export type SitePlanSource = {
  /** Contenu SVG en ligne, ou `null` tant que le plan n'existe pas. */
  svg: string | null
  /** Description lue par les lecteurs d'écran. */
  description: string
}

export const sitePlan: SitePlanSource = {
  svg: null,
  description: "Plan du site de l'hôpital",
}
