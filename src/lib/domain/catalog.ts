/**
 * Retirer une entrée du catalogue — un lieu, un service, une catégorie, un motif.
 *
 * Supprimer pour de bon ce qui est encore utilisé casserait l'histoire : une séance
 * passée pointerait vers un lieu qui n'existe plus, une personne serait rattachée à un
 * service disparu. Deux comportements, donc, choisis par ce qui existe réellement :
 *
 *   — rien ne l'utilise  → l'entrée est supprimée ;
 *   — quelque chose l'utilise → elle cesse d'être proposée, sans rien effacer.
 *
 * Le second cas n'est pas un demi-échec : c'est le but recherché, « ne plus le voir dans
 * les listes ». On le dit clairement plutôt que de le faire en silence.
 */

export type CatalogKind = 'location' | 'service' | 'category' | 'practitioner' | 'appointmentKind'

/** Ce qui pointe encore vers l'entrée. `patients` ne concerne que les services. */
export type CatalogUsage = {
  activities: number
  occurrences: number
  patients: number
  /** Un rendez-vous fixé avec cet intervenant, ou demandé pour ce motif. */
  appointments: number
}

export type CatalogRemoval = {
  action: 'deleted' | 'deactivated'
  message: string
  /** Les activités qui l'utilisent encore, par leur titre. Vide après une suppression. */
  activityTitles?: string[]
}

const NOMS: Record<CatalogKind, { article: string; singulier: string }> = {
  location: { article: 'Le', singulier: 'lieu' },
  service: { article: 'Le', singulier: 'service' },
  category: { article: 'La', singulier: 'catégorie' },
  practitioner: { article: "L'", singulier: 'intervenant' },
  appointmentKind: { article: 'Le', singulier: 'motif de rendez-vous' },
}

export function totalUsage(usage: CatalogUsage): number {
  return usage.activities + usage.occurrences + usage.patients + usage.appointments
}

/** « 1 activité », « 3 activités » — jamais d'abréviation, jamais de « (s) ». */
function compte(nombre: number, singulier: string, pluriel: string): string {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`
}

function enumere(morceaux: string[]): string {
  if (morceaux.length === 1) return morceaux[0] as string
  const debut = morceaux.slice(0, -1).join(', ')
  return `${debut} et ${morceaux[morceaux.length - 1] as string}`
}

export function planRemoval(kind: CatalogKind, name: string, usage: CatalogUsage): CatalogRemoval {
  const { article, singulier } = NOMS[kind]
  // « L'intervenant » se colle, « Le lieu » non.
  const sujet = `${article}${article.endsWith("'") ? '' : ' '}${singulier} « ${name} »`

  if (totalUsage(usage) === 0) {
    return { action: 'deleted', message: `${sujet} est supprimé. Rien ne l'utilisait.` }
  }

  const morceaux: string[] = []
  if (usage.activities > 0) morceaux.push(compte(usage.activities, 'activité', 'activités'))
  if (usage.occurrences > 0) morceaux.push(compte(usage.occurrences, 'séance', 'séances'))
  if (usage.patients > 0) morceaux.push(compte(usage.patients, 'personne', 'personnes'))
  if (usage.appointments > 0) morceaux.push(compte(usage.appointments, 'rendez-vous', 'rendez-vous'))

  return {
    action: 'deactivated',
    message:
      `${sujet} ne sera plus proposé dans les listes. ` +
      `Il est encore utilisé par ${enumere(morceaux)} : rien n'a été effacé.`,
  }
}

/**
 * Ce que l'on propose au moment de créer quelque chose. Les entrées retirées restent
 * lisibles partout ailleurs — sans quoi une séance déjà programmée perdrait le nom de
 * son lieu.
 */
export function proposed<T extends { isActive?: boolean }>(entries: T[]): T[] {
  return entries.filter((entry) => entry.isActive !== false)
}

/**
 * Supprimer une activité suit la même règle que le catalogue, avec un critère plus
 * strict : ce n'est pas l'existence de séances qui protège, mais celle d'inscriptions.
 * Une activité qui n'a jamais réuni personne ne laisse rien derrière elle ; une activité
 * à laquelle quelqu'un s'est inscrit, même une seule fois, ne peut plus disparaître —
 * sa trace sert à répondre à « qui est venu ? ».
 */
export function planActivityRemoval(
  title: string,
  usage: { registrations: number; sessions: number },
): CatalogRemoval {
  if (usage.registrations === 0) {
    const seances = usage.sessions > 0 ? `, avec ${compte(usage.sessions, 'séance', 'séances')}` : ''
    return {
      action: 'deleted',
      message: `L'activité « ${title} » est supprimée${seances}. Personne n'y était inscrit.`,
    }
  }
  return {
    action: 'deactivated',
    message:
      `L'activité « ${title} » est retirée du programme. ` +
      `${compte(usage.registrations, 'personne s’y est inscrite', 'personnes s’y sont inscrites')} : ` +
      "rien n'a été effacé.",
  }
}
