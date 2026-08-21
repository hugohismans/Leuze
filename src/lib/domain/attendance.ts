/**
 * L'appel : qui était là, qui ne l'était pas.
 *
 * Fait sur papier jusqu'ici. Deux règles, et une seule vraie question — qui a le droit
 * de cocher.
 *
 * L'activité appartient à celui qui l'anime : c'est lui qui voit qui est venu, et lui
 * seul qui coche. Un administrateur le peut aussi, sans quoi une absence ou un départ
 * bloquerait la feuille. Et lorsqu'aucun intervenant n'est nommé sur l'activité, personne
 * n'en est responsable en particulier : l'équipe du service s'en charge, faute de quoi
 * l'appel ne pourrait jamais être fait.
 */

export type Attendance = 'present' | 'absent'

export type Marker = {
  role: 'staff' | 'admin' | null
  /** L'intervenant auquel ce compte est relié, quand il l'est. */
  practitionerId?: string | null
}

export function canMarkAttendance(actor: Marker, occurrence: { facilitatorId?: string }): boolean {
  if (actor.role === 'admin') return true
  if (actor.role !== 'staff') return false
  // Activité sans intervenant nommé : l'équipe fait l'appel.
  if (occurrence.facilitatorId === undefined || occurrence.facilitatorId === '') return true
  return actor.practitionerId === occurrence.facilitatorId
}

/** Ce que l'écran dit quand le bouton n'est pas proposé. Toujours dire pourquoi. */
export function attendanceRefusal(occurrence: { facilitator?: string }): string {
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
  return morceaux.length === 0 ? 'Personne d’inscrit' : morceaux.join(', ')
}
