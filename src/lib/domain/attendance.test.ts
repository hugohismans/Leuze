import { describe, expect, it } from 'vitest'
import {
  attendanceLabel,
  attendanceOpen,
  attendanceRefusal,
  isLedByPatient,
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

describe('une activité animée par un patient', () => {
  /*
    Ce n'est ni un manque ni une erreur : c'est une décision. Un patient qui anime une
    partie d'échecs n'a pas à noter qui était là — lui confier la présence de ses
    camarades serait lui confier autre chose que l'activité.
  */
  it('n’a pas d’appel, et l’écran ne propose pas de le corriger', () => {
    const phrase = attendanceRefusal({ facilitator: 'Bernard', ledByPatient: true })
    expect(phrase).toBe("Bernard anime cette activité. Il n'y a pas d'appel, et c'est voulu.")
    expect(phrase).not.toContain('compte')
    expect(phrase).not.toContain('Modifiez')
  })

  it('se dit même sans prénom', () => {
    expect(attendanceRefusal({ ledByPatient: true })).toContain("animée par un patient")
  })

  it('n’est confondue avec aucune autre situation', () => {
    expect(isLedByPatient({ ledByPatient: true })).toBe(true)
    expect(isLedByPatient({})).toBe(false)
    // Un nom du personnel écrit à la main, sans compte : autre cas, autre phrase.
    expect(attendanceRefusal({ facilitator: 'Fatima' })).toContain('compte')
  })

  it('reste sans appel pour tout le monde, administrateur compris', () => {
    expect(canMarkAttendance({ role: 'admin' }, { ledByPatient: true })).toBe(false)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'marc' }, { ledByPatient: true })).toBe(false)
  })

  it('l’emporte même si un intervenant est resté renseigné', () => {
    // Un appel dont personne n'a voulu ne doit pas se rouvrir par une donnée oubliée.
    const seance = { ledByPatient: true, facilitatorId: 'marc' }
    expect(canMarkAttendance({ role: 'admin' }, seance)).toBe(false)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'marc' }, seance)).toBe(false)
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

describe('une séance annulée', () => {
  it("n'a pas d'appel : le bouton ne doit même pas être proposé", () => {
    expect(attendanceOpen({ facilitatorId: 'marc', status: 'cancelled' })).toBe(false)
    expect(attendanceOpen({ facilitatorId: 'marc', status: 'scheduled' })).toBe(true)
  })

  it('refuse de noter, à l’administrateur comme à l’animateur', () => {
    const seance = { facilitatorId: 'marc', status: 'cancelled' }
    expect(canMarkAttendance({ role: 'admin', practitionerId: null }, seance)).toBe(false)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'marc' }, seance)).toBe(false)
  })

  it('dit pourquoi, avec le motif quand il y en a un', () => {
    const texte = attendanceRefusal({
      facilitatorId: 'marc',
      status: 'cancelled',
      cancellationReason: "L'animateur est absent",
    })
    expect(texte).toContain('annulée')
    expect(texte).toContain("L'animateur est absent")
    expect(attendanceRefusal({ facilitatorId: 'marc', status: 'cancelled' })).toContain('annulée')
  })
})
