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
  /**
   * Ce qui a été trouvé, pour qu'un écran puisse proposer d'aller plus loin en sachant ce
   * qu'il propose. Les inscriptions ne sont pas lisibles côté client : sans ce compte,
   * l'écran ne pourrait pas nommer ce qu'il s'apprête à effacer.
   */
  usage?: DeletionUsage
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
/** Ce que porte une activité au moment où l'on envisage de l'effacer. */
export type DeletionUsage = {
  registrations: number
  sessions: number
  /** Séances déjà passées : ce sont elles qui portent une histoire. */
  pastSessions: number
  /** Présences notées lors de l'appel. C'est ce qui répond à « qui est venu ? ». */
  attendances: number
}

/**
 * Les conséquences d'une suppression définitive, une par ligne.
 *
 * Rendues séparément et non en un paragraphe : chacune se lit d'un coup d'œil, et l'on
 * voit du même regard combien il y en a. Une phrase de dix lignes se survole ; une liste
 * de trois points s'arrête.
 *
 * Ce n'est pas un refus déguisé. On efface parfois pour de bonnes raisons — une activité
 * créée par erreur n'a rien à faire dans le calendrier de quelqu'un. Mais on ne le fait
 * pas sans savoir : la réponse à « qui est venu ? » part avec l'activité, et rien ne la
 * ramènera.
 *
 * Liste vide quand il n'y a rien à perdre : ni inscription, ni présence, ni passé.
 */
export function deletionConsequences(usage: DeletionUsage): string[] {
  const lignes: string[] = []

  if (usage.sessions > 0) {
    const passees =
      usage.pastSessions > 0 ? `, dont ${compte(usage.pastSessions, 'déjà passée', 'déjà passées')}` : ''
    lignes.push(`${compte(usage.sessions, 'séance', 'séances')}${passees}.`)
  }

  if (usage.registrations > 0) {
    lignes.push(
      `${compte(usage.registrations, 'inscription', 'inscriptions')}. ` +
        'Les personnes concernées ne verront plus rien dans leur calendrier, et sans motif.',
    )
  }

  if (usage.attendances > 0) {
    lignes.push(
      `${compte(usage.attendances, 'présence notée', 'présences notées')}. ` +
        'Vous ne pourrez plus dire qui est venu à cette activité : cet historique disparaît avec elle.',
    )
  }

  return lignes
}

/** Vrai quand la suppression coûte quelque chose, et mérite donc d'être expliquée. */
export function deletionCosts(usage: DeletionUsage): boolean {
  return deletionConsequences(usage).length > 0
}

/** Les comptes manquants valent zéro : un appelant ancien ne doit pas faire échouer le calcul. */
function complet(usage: { registrations: number; sessions: number } & Partial<DeletionUsage>): DeletionUsage {
  return {
    registrations: usage.registrations,
    sessions: usage.sessions,
    pastSessions: usage.pastSessions ?? 0,
    attendances: usage.attendances ?? 0,
  }
}

export function planActivityRemoval(
  title: string,
  usage: { registrations: number; sessions: number } & Partial<DeletionUsage>,
): CatalogRemoval {
  if (usage.registrations === 0) {
    const seances = usage.sessions > 0 ? `, avec ${compte(usage.sessions, 'séance', 'séances')}` : ''
    return {
      action: 'deleted',
      usage: complet(usage),
      message: `L'activité « ${title} » est supprimée${seances}. Personne n'y était inscrit.`,
    }
  }
  return {
    action: 'deactivated',
    usage: complet(usage),
    message:
      `L'activité « ${title} » est retirée du programme. ` +
      /*
        « inscriptions » et non « personnes ».

        Une inscription vaut pour une séance : quatorze patients qui viennent toutes les
        semaines en comptent quarante en un mois. Le message annonçait « 40 personnes s'y
        sont inscrites » dans un hôpital qui en compte quatorze — un chiffre impossible,
        qui faisait croire à un service entier concerné. Le message de la suppression
        forcée, lui, disait déjà « inscriptions ».
      */
      `${compte(usage.registrations, 'inscription la concerne', 'inscriptions la concernent')} : ` +
      "rien n'a été effacé.",
  }
}

/**
 * Le compte rendu d'une suppression assumée. Elle est demandée en connaissance de cause :
 * ce message dit ce qui vient de disparaître, pas ce qui a été épargné.
 */
export function planForcedRemoval(
  title: string,
  usage: { registrations: number; sessions: number } & Partial<DeletionUsage>,
): CatalogRemoval {
  const seances = usage.sessions > 0 ? `, avec ${compte(usage.sessions, 'séance', 'séances')}` : ''
  const inscriptions =
    usage.registrations > 0
      ? ` ${compte(usage.registrations, 'inscription a été effacée', 'inscriptions ont été effacées')}.`
      : ' Personne n’y était inscrit.'
  return {
    action: 'deleted',
    usage: complet(usage),
    message: `L'activité « ${title} » est supprimée${seances}.${inscriptions}`,
  }
}
