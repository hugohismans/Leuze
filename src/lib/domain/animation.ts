/**
 * Qui anime une activité — et il peut y en avoir plusieurs.
 *
 * L'application n'en connaissait qu'un. Retour du terrain : un atelier cuisine se tient à
 * deux, une sortie en ville aussi, et la personne qui n'était pas nommée ne pouvait ni
 * faire l'appel, ni voir la séance dans son planning. Elle n'existait pas pour
 * l'application, alors qu'elle était dans la salle.
 *
 * Un seul endroit sait lire ce champ, et c'est celui-ci. Deux formes coexistent :
 *
 * — `facilitatorIds`, la liste, écrite depuis que plusieurs sont possibles ;
 * — `facilitatorId`, l'unique d'avant, encore porté par toutes les activités déjà
 *   enregistrées — et toujours écrit, à côté de la liste, pour que rien de ce qui
 *   l'interroge ne se mette à répondre faux.
 *
 * Rien ici ne lit ni n'accorde : ce sont des identifiants et des noms.
 */
import { enumeration } from './francais'

/** Ce dont on a besoin pour répondre : l'une ou l'autre forme, ou aucune. */
export type Anime = {
  facilitatorId?: string
  facilitatorIds?: string[]
}

/**
 * Ceux qui animent, dans l'ordre où on les a nommés.
 *
 * La liste fait foi dès qu'elle existe — y compris vide, ce qui veut dire « personne ».
 * Sinon on retombe sur l'unique d'avant. Les doublons sont écartés : deux fois la même
 * personne dans une liste, cela arrive en cliquant vite, et cela ferait compter deux
 * animateurs là où il n'y en a qu'un.
 */
export function facilitatorIdsOf(sujet: Anime): string[] {
  if (sujet.facilitatorIds !== undefined) {
    return [...new Set(sujet.facilitatorIds.filter((id) => id !== ''))]
  }
  const seul = sujet.facilitatorId ?? ''
  return seul === '' ? [] : [seul]
}

/**
 * Cette personne anime-t-elle ?
 *
 * C'est la question qui ouvre l'appel, le planning et le droit de modifier. Elle se
 * posait partout sous la forme d'une égalité — `facilitatorId === moi` — qui devenait
 * fausse dès qu'ils étaient deux : le second se voyait refuser sa propre séance.
 */
export function animePar(sujet: Anime, practitionerId: string | null | undefined): boolean {
  if (practitionerId === null || practitionerId === undefined || practitionerId === '') return false
  return facilitatorIdsOf(sujet).includes(practitionerId)
}

/**
 * Ce que le patient lit : « Claire », « Claire et Marc », « Claire, Marc et Sophie ».
 *
 * Recopié sur l'activité et sur chaque séance — c'est cette phrase-là qui s'affiche, pas
 * une liste d'identifiants. Le calendrier la lit sans rien avoir à joindre.
 */
export function facilitatorLabel(noms: string[]): string {
  return enumeration(noms.map((n) => n.trim()).filter((n) => n !== ''))
}

/**
 * Ce qu'on écrit sur l'activité.
 *
 * `facilitatorId` reste renseigné avec le premier de la liste, et ce n'est pas de la
 * politesse envers l'ancien format : les règles de sécurité, les anciennes séances et
 * tout ce qui n'a pas encore été relu s'appuient dessus. Le jour où plus rien ne le lit,
 * il s'enlèvera d'une ligne.
 */
export function facilitatorFields(ids: string[]): {
  facilitatorIds: string[]
  facilitatorId?: string
} {
  const propres = [...new Set(ids.filter((id) => id !== ''))]
  const premier = propres[0]
  return {
    facilitatorIds: propres,
    ...(premier === undefined ? {} : { facilitatorId: premier }),
  }
}
