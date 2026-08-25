/**
 * Les congés d'une personne du personnel.
 *
 * Une plage de disponibilité dit « je reçois le mardi de 9 h à 12 h » — en semaine type,
 * indéfiniment. Elle ne sait pas dire « sauf la semaine du 15 ». Résultat : l'application
 * proposait des rendez-vous en plein congé, et c'est le patient qui l'apprenait devant
 * une porte fermée.
 *
 * Un congé est donc une **exception datée**, posée par-dessus les plages : pendant ces
 * jours-là, la personne ne reçoit pas, quelles que soient ses plages.
 *
 * Ce module ne lit rien, n'écrit rien et n'accorde aucun droit : ce sont des intervalles
 * de jours, comparés à d'autres. Le motif n'y figure pas et n'y figurera pas — la raison
 * d'une absence ne regarde pas une application de programme d'activités.
 */
import { addLocalDays } from './time'
import type { LocalDate } from './types'

/** Du premier au dernier jour, bornes comprises. Un congé d'un seul jour a `from === to`. */
export type Leave = { from: LocalDate; to: LocalDate }

/**
 * Le plus long congé qu'on accepte d'enregistrer : un an et un jour.
 *
 * Ce n'est pas une règle de gestion, c'est un garde-fou de saisie. « 2206 » au lieu de
 * « 2026 » bloquerait l'agenda de quelqu'un pour deux siècles, et personne ne verrait
 * pourquoi les rendez-vous ont cessé d'être proposés.
 */
export const MAX_LEAVE_DAYS = 366

/** Vrai quand les deux bornes sont lisibles et dans le bon ordre. */
export function isValidLeave(leave: Leave): boolean {
  const forme = /^\d{4}-\d{2}-\d{2}$/
  if (!forme.test(leave.from) || !forme.test(leave.to)) return false
  return leave.from <= leave.to
}

/**
 * Ce qui cloche, en français simple. `null` quand le congé est enregistrable.
 *
 * `today` est facultatif pour ne rien casser là où il n'a pas de sens (un test qui ne
 * parle que de forme). Quand il est donné, un congé entièrement passé est refusé : il
 * n'empêcherait plus rien, et il proposerait d'annuler des séances qui ont eu lieu.
 * Un congé qui a commencé hier et court encore reste accepté — on tombe malade sans
 * prévenir, et c'est le lendemain qu'on le déclare.
 */
export function leaveRefusal(leave: Leave, today?: LocalDate): string | null {
  const forme = /^\d{4}-\d{2}-\d{2}$/
  if (!forme.test(leave.from) || !forme.test(leave.to)) {
    return 'Indiquez un premier et un dernier jour.'
  }
  if (leave.from > leave.to) {
    return 'Le dernier jour est avant le premier. Vérifiez les deux dates.'
  }
  if (daysCovered(leave) > MAX_LEAVE_DAYS) {
    return "Ce congé dure plus d'un an. Vérifiez l'année du dernier jour."
  }
  if (today !== undefined && leave.to < today) {
    return "Ce congé est entièrement passé. Un congé sert à libérer les jours qui viennent ; il ne réécrit pas ceux qui ont eu lieu."
  }
  return null
}

/** Le nombre de jours couverts, bornes comprises. */
export function daysCovered(leave: Leave): number {
  let jours = 1
  let curseur = leave.from
  // Compter jour par jour plutôt qu'en millisecondes : le passage à l'heure d'hiver
  // fait mentir une soustraction de dates, et une journée s'y perd une fois par an.
  while (curseur < leave.to && jours <= MAX_LEAVE_DAYS + 1) {
    curseur = addLocalDays(curseur, 1)
    jours += 1
  }
  return jours
}

/**
 * Les congés remis en ordre : les invalides retirés, les autres triés et fondus.
 *
 * Deux congés qui se touchent ou se chevauchent n'en font qu'un — « du 1er au 5 » et
 * « du 4 au 8 » décrivent une seule absence, du 1er au 8. Les garder séparés ne
 * changerait rien au calcul mais rendrait la liste illisible sur la fiche, et l'on
 * finirait par en retirer un en croyant tout retirer.
 */
export function normalizeLeaves(leaves: Leave[]): Leave[] {
  const valides = leaves.filter(isValidLeave).sort((a, b) => a.from.localeCompare(b.from))
  const fondus: Leave[] = []
  for (const conge of valides) {
    const dernier = fondus.at(-1)
    // « <= lendemain » et non « <= to » : deux congés bout à bout sont une seule absence.
    if (dernier !== undefined && conge.from <= addLocalDays(dernier.to, 1)) {
      if (conge.to > dernier.to) dernier.to = conge.to
      continue
    }
    fondus.push({ ...conge })
  }
  return fondus
}

/** Cette personne est-elle absente ce jour-là ? */
export function isOnLeave(leaves: Leave[], localDate: LocalDate): boolean {
  return leaves.some((conge) => conge.from <= localDate && localDate <= conge.to)
}

/** Les congés qui touchent la période demandée, bornes comprises. */
export function leavesOverlapping(leaves: Leave[], from: LocalDate, to: LocalDate): Leave[] {
  return leaves.filter((conge) => conge.from <= to && from <= conge.to)
}

/**
 * Retirer un congé, désigné par ses deux bornes.
 *
 * Par les bornes et non par un rang dans la liste : la liste est fondue et retriée à
 * chaque lecture, et un rang désignerait le mauvais congé dès qu'un autre est ajouté.
 */
export function withoutLeave(leaves: Leave[], leave: Leave): Leave[] {
  return leaves.filter((conge) => !(conge.from === leave.from && conge.to === leave.to))
}

/**
 * Les jours de congé que le calendrier d'une activité viendrait heurter.
 *
 * L'inverse du cas précédent, et il s'est posé aussitôt : on peut déclarer un congé
 * après avoir posé un atelier, mais on peut tout aussi bien poser un atelier après avoir
 * déclaré un congé. Le second sens ne disait rien du tout — l'activité s'enregistrait,
 * et l'on découvrait le lundi qu'elle tombait en pleine absence.
 *
 * Une activité ponctuelle tient en une date. Une activité hebdomadaire n'en a pas : elle
 * a des jours de semaine, et se répète indéfiniment. On ne compare donc pas des dates à
 * des dates — on parcourt les congés, qui sont bornés, et l'on regarde quels jours
 * tombent sur l'un des jours retenus. C'est fini, et c'est exact.
 *
 * Les dates rendues sont triées et sans doublon : elles s'écrivent telles quelles.
 */
export function leaveClashes(
  leaves: Leave[],
  schedule: { dates?: LocalDate[]; weekdays?: number[] },
  isoWeekdayOf: (localDate: LocalDate) => number,
  /*
    Le jour d'aujourd'hui, quand on veut écarter le passé.

    « Annuler » veut dire « n'aura pas lieu » : une séance de la semaine dernière a eu
    lieu, et les personnes qui y sont allées n'ont pas à lire qu'elle a été annulée.
    Facultatif — un appel qui ne le donne pas garde l'ancien comportement, celui d'une
    récurrence qu'on est en train d'écrire et qui n'a pas encore de passé.
  */
  today?: LocalDate,
): LocalDate[] {
  const heurtees = new Set<LocalDate>()
  const retenir = (jour: LocalDate): void => {
    if (today === undefined || jour >= today) heurtees.add(jour)
  }

  for (const jour of schedule.dates ?? []) {
    if (isOnLeave(leaves, jour)) retenir(jour)
  }

  const jours = schedule.weekdays ?? []
  if (jours.length > 0) {
    for (const conge of normalizeLeaves(leaves)) {
      let curseur = conge.from
      // Les congés sont bornés — au plus un an, `MAX_LEAVE_DAYS` y veille : le parcours
      // se termine toujours, là où parcourir une récurrence sans fin ne le ferait pas.
      for (let i = 0; i <= MAX_LEAVE_DAYS && curseur <= conge.to; i += 1) {
        if (jours.includes(isoWeekdayOf(curseur))) retenir(curseur)
        curseur = addLocalDays(curseur, 1)
      }
    }
  }

  return [...heurtees].sort()
}

/**
 * Ce que la période porte, en une phrase.
 *
 * Le nombre d'abord, la nature ensuite : « 3 séances et 1 rendez-vous » se lit d'un coup
 * d'œil, là où « des activités et des rendez-vous » oblige à aller compter plus bas.
 *
 * La phrase vivait en trois exemplaires — le serveur, la démonstration, et le titre de la
 * liste juste en dessous — et ils ne disaient pas la même chose : le titre savait écrire
 * « Séances que vous animez » sur son propre congé, la phrase du dessus restait à
 * « animées par cette personne ». On lisait donc, l'un sous l'autre, deux façons de
 * désigner le même être.
 */
export function leaveConflictSummary(
  appointments: number,
  sessions: number,
  who: { name?: string; isSelf?: boolean } = {},
): string {
  // Le complément ne s'accorde pas : « que vous animez », « qu'anime Claire » et
  // « animée(s) par cette personne » — seul le dernier suit le nombre.
  const qui =
    who.isSelf === true
      ? { singulier: 'que vous animez', pluriel: 'que vous animez' }
      : who.name !== undefined && who.name !== ''
        ? { singulier: `qu’anime ${who.name}`, pluriel: `qu’anime ${who.name}` }
        : { singulier: 'animée par cette personne', pluriel: 'animées par cette personne' }
  const bouts: string[] = []
  if (sessions > 0) {
    bouts.push(
      sessions === 1 ? `une séance ${qui.singulier}` : `${sessions} séances ${qui.pluriel}`,
    )
  }
  if (appointments > 0) {
    bouts.push(appointments === 1 ? 'un rendez-vous fixé' : `${appointments} rendez-vous fixés`)
  }
  return `Ce congé tombe sur ${bouts.join(' et ')}.`
}

/**
 * L'avertissement à écrire quand on pose un rendez-vous un jour de congé.
 *
 * L'application connaissait le congé — l'agenda croisé de la même page l'affichait — mais
 * le formulaire, lui, ne disait rien : la seule ligne visible était « Docteur Lemaire
 * reçoit : mardi de 09h00 à 12h00 », qui rassure au moment où elle devrait alerter. Le
 * rendez-vous s'enregistrait sans réserve, et c'est le patient qui l'apprenait devant une
 * porte fermée — précisément ce que les congés devaient éviter.
 *
 * Il avertit, il n'interdit pas : une urgence se cale où l'on veut, et personne ne connaît
 * mieux la situation que la personne devant l'écran.
 */
export function leaveWarning(
  leaves: Leave[],
  localDate: LocalDate,
  practitionerName: string,
  /*
    Qui est en congé : « vous » quand c'est soi-même, un nom sinon.

    L'avertissement disait « Claire est en congé ce jour-là […] prévenez la personne
    concernée » à Claire, sur son propre agenda, juste sous celui des plages qui, lui,
    avait appris à dire « vous ». Deux phrases voisines, deux façons de nommer le même
    être — et une consigne qui demande de se prévenir soi-même.
  */
  isSelf = false,
): string | null {
  if (!isOnLeave(leaves, localDate)) return null
  if (isSelf) {
    return 'Vous êtes en congé ce jour-là. Vous pouvez tout de même fixer le rendez-vous.'
  }
  return `${practitionerName} est en congé ce jour-là. Vous pouvez tout de même fixer le rendez-vous, mais prévenez la personne concernée.`
}
