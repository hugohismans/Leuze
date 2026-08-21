import { describe, expect, it } from 'vitest'
import { attendanceLabel, attendanceRefusal, canMarkAttendance, countAttendance } from './attendance'

describe('qui peut faire l’appel', () => {
  const activite = { facilitatorId: 'docteur-lemaire' }

  it('celui qui anime l’activité', () => {
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'docteur-lemaire' }, activite)).toBe(true)
  })

  it('mais pas un autre soignant', () => {
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'claire' }, activite)).toBe(false)
    expect(canMarkAttendance({ role: 'staff', practitionerId: null }, activite)).toBe(false)
  })

  it('un administrateur, toujours — sans quoi une absence bloquerait la feuille', () => {
    expect(canMarkAttendance({ role: 'admin', practitionerId: null }, activite)).toBe(true)
  })

  it('personne quand on n’est pas du personnel', () => {
    expect(canMarkAttendance({ role: null }, activite)).toBe(false)
  })

  it('n’importe quel soignant quand aucun intervenant n’est nommé', () => {
    // Sinon l'appel de ces activités-là ne pourrait jamais être fait.
    expect(canMarkAttendance({ role: 'staff', practitionerId: null }, {})).toBe(true)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'claire' }, { facilitatorId: '' })).toBe(true)
  })

  it('dit qui s’en charge quand le bouton n’est pas proposé', () => {
    expect(attendanceRefusal({ facilitator: 'Marc' })).toContain('fait par Marc')
    expect(attendanceRefusal({})).toContain("réservé à la personne qui l'anime")
  })
})

describe('le compte de l’appel', () => {
  it('sépare présents, absents et sans réponse', () => {
    const compte = countAttendance([
      { attendance: 'present' },
      { attendance: 'present' },
      { attendance: 'absent' },
      {},
    ])
    expect(compte).toEqual({ present: 2, absent: 1, unmarked: 1 })
  })

  it('se lit en toutes lettres', () => {
    expect(attendanceLabel({ present: 6, absent: 2, unmarked: 1 })).toBe('6 présents, 2 absents, 1 sans réponse')
    expect(attendanceLabel({ present: 1, absent: 0, unmarked: 0 })).toBe('1 présent')
    expect(attendanceLabel({ present: 0, absent: 0, unmarked: 0 })).toBe('Personne d’inscrit')
  })
})
