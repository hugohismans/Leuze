/**
 * Les petites règles du français que l'interface doit respecter.
 *
 * Elles n'ont l'air de rien, et c'est justement pourquoi elles se répandent : « Ce que
 * Aline peut faire », « La semaine de Émile », « 1 / 8 inscrits (1 restantes) », « Tous
 * les lundi », « Mardi 1 septembre ». Écrites une fois ici, elles cessent d'être
 * réinventées — à moitié — dans chaque écran.
 *
 * L'application s'adresse à des personnes pour qui lire est déjà un effort. Une phrase
 * fautive coûte une relecture ; dix phrases fautives font douter du reste.
 */

/** Les lettres devant lesquelles « de » et « que » s'élident sans discussion. */
const VOYELLES = 'aàâäeéèêëiîïoôöuùûü'

/**
 * Vrai quand un mot commence par une voyelle — ou par un « h » muet, ce qu'on suppose.
 *
 * Le « y » demande un détour. Il note tantôt une voyelle — « Yves », « Yvette »,
 * « Yvon » — et l'on écrit alors « d'Yves » ; tantôt une semi-consonne — « Yannick »,
 * « Yolande », « Youssef », comme « le yaourt » — et l'on écrit « de Yannick ».
 * Ce qui les sépare s'entend : le « y » consonne est suivi d'une voyelle, le « y »
 * voyelle est suivi d'une consonne. La règle est celle-là, et elle range correctement
 * tous les prénoms que l'on rencontre.
 */
export function commenceParVoyelle(mot: string): boolean {
  const propre = mot.trim().toLocaleLowerCase('fr')
  const premiere = propre.charAt(0)
  if (premiere === '') return false
  if (premiere === 'y') {
    const suivante = propre.charAt(1)
    return suivante !== '' && !VOYELLES.includes(suivante)
  }
  return premiere === 'h' || VOYELLES.includes(premiere)
}

/** « de Marc », « d'Aline ». */
export function de(nom: string): string {
  const propre = nom.trim()
  if (propre === '') return 'de'
  return commenceParVoyelle(propre) ? `d’${propre}` : `de ${propre}`
}

/** « Ce que Marc », « Ce qu'Aline ». Le « Ce » reste à la charge de l'appelant. */
export function que(nom: string): string {
  const propre = nom.trim()
  if (propre === '') return 'que'
  return commenceParVoyelle(propre) ? `qu’${propre}` : `que ${propre}`
}

/**
 * Le pluriel, accordé sur un nombre. Zéro prend le singulier en français : « 0 place
 * restante », et non « 0 places restantes ».
 */
export function accorde(nombre: number, singulier: string, pluriel: string): string {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`
}

/** Le pluriel seul, sans le nombre. */
export function motAccorde(nombre: number, singulier: string, pluriel: string): string {
  return nombre > 1 ? pluriel : singulier
}

/** « le lundi et le jeudi » : une énumération qui se lit à voix haute. */
export function enumeration(elements: string[]): string {
  if (elements.length === 0) return ''
  if (elements.length === 1) return elements[0]!
  return `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
}

/**
 * Une phrase qui commence par une majuscule.
 *
 * « Le congé est enregistré. un rendez-vous est remis dans la file » : les morceaux
 * assemblés gardaient la minuscule de leur fabrication.
 */
export function phrase(texte: string): string {
  const propre = texte.trim()
  return propre === '' ? '' : propre.charAt(0).toLocaleUpperCase('fr') + propre.slice(1)
}
