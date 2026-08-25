/**
 * Les chevauchements d'horaire.
 *
 * Une inscription se prenait sans regarder le reste de la journée : on pouvait s'inscrire
 * à l'atelier cuisine de 10 heures alors qu'on avait rendez-vous avec le psychiatre à
 * 10h15. Personne ne s'en apercevait avant le jour même — et c'est le rendez-vous qui
 * sautait, parce que l'activité, elle, se voyait sur la feuille.
 *
 * Deux poids, délibérément.
 *
 * **Un rendez-vous ne se rate pas.** Il a été fixé avec quelqu'un qui a bloqué du temps
 * pour cette personne-là. Une activité qui tombe dessus est refusée au patient qui
 * s'inscrit seul, et signalée au soignant qui inscrit à sa place — lui peut savoir que le
 * rendez-vous va être déplacé, l'application ne le sait pas.
 *
 * **Deux activités qui se chevauchent, c'est souvent sans importance.** On arrive en
 * retard au jeu de société parce que la marche a duré, et personne n'en fait un drame.
 * On le dit, on ne l'interdit pas.
 *
 * Ce module ne connaît que des intervalles et des libellés. Il ne lit rien, il ne décide
 * d'aucun droit, et il ignore tout de la raison d'un rendez-vous.
 */
import { formatTime } from './time'
import type { LocalDate } from './types'

/** Ce qui occupe déjà quelqu'un : une séance à laquelle il est inscrit, ou un rendez-vous. */
export type BusyEntry = {
  start: Date
  end: Date
  /** Ce qu'on affiche : « Atelier cuisine », « Rendez-vous avec le psychiatre ». */
  label: string
  kind: 'activity' | 'appointment'
  /**
   * La séance, quand c'en est une.
   *
   * Elle sert à proposer d'en sortir : « Me désinscrire de « Jeu de société » pour
   * m'inscrire ici ». Un rendez-vous n'en porte pas, et c'est voulu — il ne s'échange
   * contre rien.
   */
  occurrenceId?: string
}

export type TimeSpan = { start: Date; end: Date }

/**
 * Deux intervalles se chevauchent-ils ? Le contact bord à bord n'en est pas un : une
 * activité qui finit à 10h00 et un rendez-vous qui commence à 10h00 s'enchaînent.
 */
export function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
}

/** Tout ce qui tombe en même temps que le créneau visé, dans l'ordre du temps. */
export function conflictsWith(candidate: TimeSpan, busy: BusyEntry[]): BusyEntry[] {
  return busy
    .filter((entry) => overlaps(candidate, entry))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** Le premier rendez-vous heurté, s'il y en a un. C'est lui qui bloque. */
export function blockingConflict(conflicts: BusyEntry[]): BusyEntry | null {
  return conflicts.find((entry) => entry.kind === 'appointment') ?? null
}

/**
 * Tous les rendez-vous heurtés — c'est-à-dire tout ce qui justifie de s'arrêter et de
 * demander. Les activités qui tombent en même temps n'y figurent pas : elles se disent,
 * elles n'arrêtent rien. Une liste vide veut donc dire « on peut inscrire ».
 */
export function blockingConflicts(conflicts: BusyEntry[]): BusyEntry[] {
  return conflicts.filter((entry) => entry.kind === 'appointment')
}

/** « Rendez-vous avec le psychiatre, de 10h00 à 10h30 ». */
export function describeConflict(entry: BusyEntry): string {
  return `${entry.label}, de ${formatTime(entry.start)} à ${formatTime(entry.end)}`
}

/**
 * Ce qu'il advient d'une inscription prise par le patient lui-même.
 *
 * **On ne peut pas être à deux endroits à la fois.** C'est la décision de l'hôpital, prise
 * après un essai en service : quelqu'un s'était inscrit à deux activités de quatorze
 * heures. Un simple avertissement ne suffit pas — il se lit, ou ne se lit pas.
 *
 * Deux refus, et ils n'ont pas la même issue.
 *
 * **Un rendez-vous ferme la porte.** Un patient n'annule pas un rendez-vous tout seul :
 * quelqu'un a bloqué du temps pour lui, et le décommander se parle. Il n'y a donc rien à
 * proposer, sinon d'en parler à un soignant.
 *
 * **Une activité s'échange.** On propose de quitter celle où l'on est pour prendre
 * celle-ci — un seul geste, et la personne sait exactement ce qu'elle perd. C'est le
 * contraire de « débrouillez-vous » : l'application fait le remplacement pour elle.
 */
export type RegistrationDecision =
  | { kind: 'libre' }
  | { kind: 'rendez-vous'; message: string }
  | {
      kind: 'activites'
      /** Les séances à quitter pour prendre celle-ci. Jamais vide. */
      aQuitter: BusyEntry[]
      message: string
      /** Le libellé du bouton qui fait l'échange. */
      actionLabel: string
    }

export function patientRegistrationDecision(conflicts: BusyEntry[]): RegistrationDecision {
  if (conflicts.length === 0) return { kind: 'libre' }

  const rendezVous = blockingConflict(conflicts)
  if (rendezVous !== null) {
    return {
      kind: 'rendez-vous',
      // Surtout pas de minuscule forcée : le libellé porte un nom propre, et
      // « rendez-vous avec docteur lemaire » se lit comme une faute.
      message: `Vous avez un rendez-vous à ce moment-là : ${describeConflict(rendezVous)}. Un rendez-vous ne s’annule pas tout seul. Parlez-en à un soignant si vous préférez venir à cette activité.`,
    }
  }

  /*
    Seules les séances portant un identifiant peuvent être quittées.

    Il n'en manque jamais en pratique — c'est le serveur et l'écran qui remplissent cette
    liste. Mais sans identifiant on ne saurait pas de quoi désinscrire quelqu'un, et
    proposer un échange qu'on ne peut pas faire serait pire que de refuser.
  */
  const quittables = conflicts.filter((entry) => (entry.occurrenceId ?? '') !== '')
  if (quittables.length === 0) {
    return {
      kind: 'rendez-vous',
      message: `Vous avez déjà quelque chose à ce moment-là : ${describeConflict(conflicts[0]!)}. Parlez-en à un soignant.`,
    }
  }

  const premier = quittables[0]!
  const message =
    quittables.length === 1
      ? `Vous êtes déjà inscrit à « ${premier.label} », de ${formatTime(premier.start)} à ${formatTime(premier.end)}. Vous ne pouvez pas être aux deux.`
      : `Vous êtes déjà inscrit à ${quittables.length} activités à ce moment-là. Vous ne pouvez pas être partout.`
  const actionLabel =
    quittables.length === 1
      ? `Me désinscrire de « ${premier.label} » pour m’inscrire ici`
      : `Me désinscrire des ${quittables.length} autres pour m’inscrire ici`

  return { kind: 'activites', aQuitter: quittables, message, actionLabel }
}

/**
 * Ce qu'on dit au soignant qui inscrit quelqu'un. Rien ne l'empêche : il connaît la
 * situation, il peut déplacer le rendez-vous. Mais il doit le savoir avant, pas après.
 */
export function staffConflictWarning(firstName: string, conflicts: BusyEntry[]): string | null {
  if (conflicts.length === 0) return null
  const liste = conflicts.map((entry) => `• ${describeConflict(entry)}`).join('\n')
  const rendezVous = blockingConflict(conflicts)
  const tete =
    rendezVous === null
      ? `${firstName} est déjà pris à ce moment-là :`
      : `${firstName} a un rendez-vous à ce moment-là :`
  return `${tete}\n${liste}\n\nVoulez-vous l’inscrire quand même ?`
}

/**
 * Ce que la personne a déjà, au moment d'une séance qu'elle regarde.
 *
 * Le serveur fait ce calcul au moment de l'inscription, et renvoie l'avertissement avec
 * la réponse. C'était trop tard : on l'apprenait une fois inscrit. L'écran refait donc le
 * même calcul avant, à partir de ce qu'il a déjà sous la main — ses propres inscriptions
 * et ses propres rendez-vous. Aucune lecture de plus, et rien qui touche à quelqu'un
 * d'autre.
 *
 * Ce n'est pas un garde-fou : le serveur reste seul juge de ce qui est refusé. C'est un
 * avertissement, et un avertissement se donne avant le geste.
 *
 * La séance regardée est écartée : on ne se chevauche pas soi-même.
 */
export function myBusyAt(
  candidate: TimeSpan & { id: string },
  registrations: {
    occurrence: { id: string; start: Date; end: Date; title: string; status: string }
  }[],
  appointments: {
    start?: Date
    end?: Date
    status: string
    withWhom?: string
    kindLabel?: string
  }[],
): BusyEntry[] {
  const occupe: BusyEntry[] = []

  for (const { occurrence } of registrations) {
    if (occurrence.id === candidate.id) continue
    // Une séance annulée n'occupe plus personne.
    if (occurrence.status === 'cancelled') continue
    occupe.push({
      start: occurrence.start,
      end: occurrence.end,
      label: occurrence.title,
      kind: 'activity',
      // C'est par lui qu'on proposera d'en sortir.
      occurrenceId: occurrence.id,
    })
  }

  for (const rendezVous of appointments) {
    if (rendezVous.status !== 'scheduled') continue
    if (rendezVous.start === undefined || rendezVous.end === undefined) continue
    const qui = rendezVous.withWhom ?? rendezVous.kindLabel
    occupe.push({
      start: rendezVous.start,
      end: rendezVous.end,
      label: qui === undefined || qui === '' ? 'Rendez-vous' : `Rendez-vous avec ${qui}`,
      kind: 'appointment',
    })
  }

  return conflictsWith(candidate, occupe)
}

/**
 * Le jour d'une occurrence, lu dans son identifiant.
 *
 * Les identifiants sont déterministes — `{activityId}_{yyyyMMdd}T{HHmm}` — et cette
 * régularité évite une lecture : pour savoir si deux inscriptions tombent le même jour,
 * il suffit de comparer leurs identifiants. `null` si la forme n'est pas celle-là, ce
 * qui doit rester impossible.
 */
export function localDateOfOccurrenceId(id: string): LocalDate | null {
  const trouve = /_(\d{4})(\d{2})(\d{2})T\d{4}$/.exec(id)
  if (trouve === null) return null
  return `${trouve[1]}-${trouve[2]}-${trouve[3]}`
}
