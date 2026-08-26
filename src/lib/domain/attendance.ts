/**
 * L'appel : qui était là, qui ne l'était pas.
 *
 * Fait sur papier jusqu'ici. Deux règles, et une seule vraie question — qui a le droit
 * de cocher.
 *
 * L'activité appartient à celui qui l'anime : c'est lui qui voit qui est venu, et lui
 * seul qui coche. Un administrateur le peut aussi, sans quoi une absence ou un départ
 * bloquerait la feuille.
 *
 * Sans intervenant nommé, il n'y a pas d'appel du tout. C'est un choix : ouvrir la
 * feuille à toute l'équipe reviendrait à dire que la présence d'un patient se coche par
 * n'importe qui — or personne ne serait alors responsable de ce qui est noté, ni de ce
 * qui ne l'est pas. Le formulaire d'activité prévient au moment d'enregistrer.
 */
import { animePar, facilitatorIdsOf, type Anime } from './animation'

export type Attendance = 'present' | 'absent'

export type Marker = {
  role: 'staff' | 'admin' | null
  /** L'intervenant auquel ce compte est relié, quand il l'est. */
  practitionerId?: string | null
}

/** Vrai quand l'activité désigne quelqu'un pour l'animer. Sans cela, pas d'appel. */
export function hasFacilitator(occurrence: Anime): boolean {
  return facilitatorIdsOf(occurrence).length > 0
}

/**
 * L'activité est animée par un patient, seul.
 *
 * Il n'y a alors pas d'appel, et ce n'est pas un manque : c'est une décision. Un patient
 * qui anime une partie d'échecs n'a pas à noter qui était là — personne ne le lui a
 * demandé, et lui confier la présence de ses camarades serait lui confier autre chose
 * que l'activité.
 *
 * À ne pas confondre avec une activité dont l'animateur n'est qu'un nom écrit à la main :
 * là, quelqu'un du personnel anime mais n'a pas de compte, et il faut le lui créer.
 */
export function isLedByPatient(occurrence: { ledByPatient?: boolean }): boolean {
  return occurrence.ledByPatient === true
}

/**
 * L'appel est-il possible sur cette séance, quel qu'en soit l'auteur ?
 *
 * C'est la question que pose l'écran avant de proposer un bouton : proposer un geste qui
 * mènera à un refus est une promesse en l'air. Elle vaut aussi comme garde-fou contre une
 * donnée incohérente — un intervenant resté renseigné sur une activité animée par un
 * patient ne doit pas rouvrir un appel dont personne n'a voulu.
 */
export function attendanceOpen(occurrence: {
  facilitatorId?: string
  ledByPatient?: boolean
  status?: string
}): boolean {
  /*
    Une séance annulée n'a pas d'appel.

    Le bouton « Faire l'appel » restait proposé sur une carte pourtant marquée
    « Annulée », l'écran d'appel ne disait nulle part qu'elle l'était, et l'on pouvait y
    noter des présences sur une séance qui n'aurait pas lieu. Seul l'ajout d'une personne
    échouait — avec un message écrit pour le patient, affiché à un soignant, dans le
    bandeau vert des réussites.
  */
  if (occurrence.status === 'cancelled') return false
  return hasFacilitator(occurrence) && !isLedByPatient(occurrence)
}

export function canMarkAttendance(
  actor: Marker,
  occurrence: Anime & { ledByPatient?: boolean; status?: string },
): boolean {
  /*
    Une activité animée par un patient n'a pas d'appel, pour personne — pas même pour
    l'administrateur. Le contrôle passe avant tous les autres, et il ne regarde pas si un
    intervenant est par ailleurs désigné : si les deux étaient renseignés, la décision
    « c'est un patient qui anime » l'emporte. Un appel dont personne n'a voulu ne doit
    pas pouvoir se rouvrir par une donnée oubliée.
  */
  if (isLedByPatient(occurrence)) return false
  // Ni sur une séance annulée : elle n'aura pas lieu, il n'y a personne à cocher.
  if (occurrence.status === 'cancelled') return false
  // L'administrateur reste le recours : sans lui, l'absence de la personne qui anime
  // laisserait la feuille inachevée jusqu'à son retour.
  if (actor.role === 'admin') return hasFacilitator(occurrence)
  if (actor.role !== 'staff') return false
  if (!hasFacilitator(occurrence)) return false
  /*
    Chacun de ceux qui animent, et pas seulement le premier.

    La question se posait par une égalité. Dès qu'un atelier se tenait à deux, la seconde
    personne se voyait refuser l'appel de sa propre séance — alors qu'elle était dans la
    salle, et souvent la seule à savoir qui était venu.
  */
  return animePar(occurrence, actor.practitionerId)
}

/**
 * Ce que l'écran dit quand le bouton n'est pas proposé. Toujours dire pourquoi.
 *
 * Une activité porte deux choses différentes : le **nom** de qui l'anime, écrit à la main
 * et affiché sur le programme, et le **compte** auquel cette personne est reliée. L'appel
 * exige le second — cocher « présent » engage quelqu'un, et il faut donc savoir qui.
 *
 * On disait « personne n'anime cette activité » dans les deux cas. Sur une séance qui
 * affiche « avec Fatima » trois lignes plus haut, c'était faux, et deux phrases qui se
 * contredisent à l'écran font douter de tout le reste. On distingue donc : il n'y a
 * personne, ou il y a quelqu'un mais sans compte — et l'on dit quoi faire dans les deux cas.
 */
export function attendanceRefusal(
  occurrence: {
    facilitator?: string
    facilitatorId?: string
    facilitatorIds?: string[]
    ledByPatient?: boolean
    status?: string
    cancellationReason?: string
  },
  /*
    Qui lit compte : la phrase disait « Modifiez l'activité pour désigner quelqu'un » à
    un soignant à qui l'écran venait de retirer le bouton « Modifier l'activité ». Une
    consigne qu'on ne peut pas suivre est pire que pas de consigne du tout — elle laisse
    croire à une maladresse de sa part.
  */
  canEditActivity = true,
): string {
  // L'annulation passe avant tout le reste : c'est la raison la plus visible, et la seule
  // qui explique pourquoi il n'y a personne à cocher.
  if (occurrence.status === 'cancelled') {
    const motif = occurrence.cancellationReason
    return motif === undefined || motif === ''
      ? "Cette séance est annulée : il n'y a pas d'appel à faire."
      : `Cette séance est annulée — ${motif}. Il n'y a pas d'appel à faire.`
  }
  if (isLedByPatient(occurrence)) {
    // Ni un manque ni une erreur : on ne propose pas de « corriger » quoi que ce soit.
    const qui = occurrence.facilitator
    return qui === undefined || qui === ''
      ? "Cette activité est animée par un patient. Il n'y a pas d'appel, et c'est voulu."
      : `${qui} anime cette activité. Il n'y a pas d'appel, et c'est voulu.`
  }
  if (!hasFacilitator(occurrence)) {
    const nomme = occurrence.facilitator
    if (nomme !== undefined && nomme !== '') {
      return canEditActivity
        ? `${nomme} n'a pas de compte dans l'application : l'appel n'est pas possible. Créez son compte dans « Le personnel », puis rattachez cette personne à l'activité.`
        : `${nomme} n'a pas de compte dans l'application : l'appel n'est pas possible. Demandez à un administrateur de lui en créer un.`
    }
    return canEditActivity
      ? "Personne n'anime cette activité : l'appel n'est pas possible. Modifiez l'activité pour désigner quelqu'un."
      : "Personne n'anime cette activité : l'appel n'est pas possible. Demandez à un administrateur de désigner quelqu'un."
  }
  const qui = occurrence.facilitator
  return qui === undefined || qui === ''
    ? "L'appel de cette activité est réservé à la personne qui l'anime."
    : `L'appel de cette activité est fait par ${qui}.`
}

export type AttendanceCount = { present: number; absent: number; unmarked: number }

export function countAttendance(lines: Array<{ attendance?: Attendance }>): AttendanceCount {
  return {
    present: lines.filter((l) => l.attendance === 'present').length,
    absent: lines.filter((l) => l.attendance === 'absent').length,
    unmarked: lines.filter((l) => l.attendance === undefined).length,
  }
}

/** Résumé lisible, jamais un simple chiffre nu : « 6 présents, 2 absents, 1 sans réponse ». */
export function attendanceLabel(compte: AttendanceCount): string {
  const morceaux: string[] = []
  if (compte.present > 0) morceaux.push(`${compte.present} ${compte.present > 1 ? 'présents' : 'présent'}`)
  if (compte.absent > 0) morceaux.push(`${compte.absent} ${compte.absent > 1 ? 'absents' : 'absent'}`)
  if (compte.unmarked > 0) {
    morceaux.push(`${compte.unmarked} ${compte.unmarked > 1 ? 'sans réponse' : 'sans réponse'}`)
  }
  /*
    Rien à compter : on ne le dit pas deux fois.

    « Personne d'inscrit » — tournure elliptique — s'empilait au-dessus de « Personne
    n'est inscrit à cette activité. », qui dit la même chose en français simple. Une
    chaîne vide laisse la place à cette seule phrase.
  */
  return morceaux.join(', ')
}
