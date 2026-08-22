import { describe, expect, it } from 'vitest'
import {
  attendanceLabel,
  attendanceRefusal,
  canMarkAttendance,
  countAttendance,
  hasFacilitator,
} from './attendance'

describe('qui peut faire l’appel', () => {
  const activite = { facilitatorId: 'docteur-lemaire' }

  it('celui qui anime l’activité', () => {
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'docteur-lemaire' }, activite)).toBe(true)
  })

  it('mais pas un autre soignant', () => {
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'claire' }, activite)).toBe(false)
    expect(canMarkAttendance({ role: 'staff', practitionerId: null }, activite)).toBe(false)
  })

  it('un administrateur aussi — sans quoi une absence bloquerait la feuille', () => {
    expect(canMarkAttendance({ role: 'admin', practitionerId: null }, activite)).toBe(true)
  })

  it('personne quand on n’est pas du personnel', () => {
    expect(canMarkAttendance({ role: null }, activite)).toBe(false)
  })

  it('personne quand aucun intervenant n’est nommé — pas même l’administrateur', () => {
    // Une présence cochée par n'importe qui n'engage personne : sans animateur désigné,
    // il n'y a pas d'appel. Le formulaire d'activité prévient au moment d'enregistrer.
    expect(canMarkAttendance({ role: 'staff', practitionerId: null }, {})).toBe(false)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'claire' }, { facilitatorId: '' })).toBe(false)
    expect(canMarkAttendance({ role: 'admin', practitionerId: 'claire' }, {})).toBe(false)
  })

  it('reconnaît une activité qui désigne quelqu’un', () => {
    expect(hasFacilitator(activite)).toBe(true)
    expect(hasFacilitator({})).toBe(false)
    expect(hasFacilitator({ facilitatorId: '' })).toBe(false)
  })

  it('dit qui s’en charge quand le bouton n’est pas proposé', () => {
    expect(attendanceRefusal({ facilitator: 'Marc', facilitatorId: 'marc' })).toContain('fait par Marc')
    expect(attendanceRefusal({ facilitatorId: 'marc' })).toContain("réservé à la personne qui l'anime")
    expect(attendanceRefusal({})).toContain("l'appel n'est pas possible")
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

describe('ce que l’écran dit quand l’appel n’est pas possible', () => {
  it('nomme la personne quand elle n’a pas de compte', () => {
    /*
      Le cas signalé : la séance affiche « La cafétéria — Fatima », et l'application
      répondait « personne n'anime cette activité » trois lignes plus bas.
    */
    const phrase = attendanceRefusal({ facilitator: 'Fatima' })
    expect(phrase).toContain('Fatima')
    expect(phrase).not.toContain("Personne n'anime")
    expect(phrase).toContain('Le personnel')
  })

  it('dit qu’il n’y a personne quand il n’y a vraiment personne', () => {
    expect(attendanceRefusal({})).toContain("Personne n'anime")
  })

  it('renvoie à la personne qui anime quand elle a bien un compte', () => {
    expect(attendanceRefusal({ facilitator: 'Marc', facilitatorId: 'marc' })).toBe(
      "L'appel de cette activité est fait par Marc.",
    )
  })

  it('reste compréhensible quand le compte existe mais pas le nom', () => {
    expect(attendanceRefusal({ facilitatorId: 'marc' })).toContain('réservé à la personne')
  })
})
