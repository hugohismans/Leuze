import { describe, expect, it } from 'vitest'
import {
  availabilityLabel,
  availabilityWarning,
  coversAppointment,
  firstWindowRefusal,
  formatLocalTime,
  minutesOf,
  normalizeAvailability,
  windowRefusal,
  windowsOn,
  type AvailabilityWindow,
} from './availability'

const mardiMatin: AvailabilityWindow = { weekday: 2, from: '09:00', to: '12:00' }
const jeudiApresMidi: AvailabilityWindow = { weekday: 4, from: '14:00', to: '17:00' }

describe('lire une heure', () => {
  it('convertit en minutes depuis minuit', () => {
    expect(minutesOf('00:00')).toBe(0)
    expect(minutesOf('09:30')).toBe(570)
    expect(minutesOf('23:59')).toBe(1439)
  })

  it('refuse ce qui n’est pas une heure, plutôt que de deviner', () => {
    expect(minutesOf('9:00')).toBeNull()
    expect(minutesOf('25:00')).toBeNull()
    expect(minutesOf('12:60')).toBeNull()
    expect(minutesOf('')).toBeNull()
  })

  it('s’écrit à la française, sans abréviation', () => {
    expect(formatLocalTime('09:00')).toBe('09h00')
    expect(formatLocalTime('14:30')).toBe('14h30')
  })
})

describe('remettre de l’ordre dans les plages', () => {
  it('trie par jour puis par heure', () => {
    const ordre = normalizeAvailability([jeudiApresMidi, mardiMatin])
    expect(ordre.map((f) => f.weekday)).toEqual([2, 4])
  })

  it('fond deux plages qui se chevauchent le même jour', () => {
    const fondu = normalizeAvailability([
      { weekday: 2, from: '09:00', to: '11:00' },
      { weekday: 2, from: '10:00', to: '12:00' },
    ])
    expect(fondu).toEqual([{ weekday: 2, from: '09:00', to: '12:00' }])
  })

  it('fond aussi deux plages qui se touchent', () => {
    const fondu = normalizeAvailability([
      { weekday: 2, from: '09:00', to: '12:00' },
      { weekday: 2, from: '12:00', to: '13:00' },
    ])
    expect(fondu).toEqual([{ weekday: 2, from: '09:00', to: '13:00' }])
  })

  it('ne fond pas deux jours différents, ni deux plages séparées', () => {
    const garde = normalizeAvailability([
      { weekday: 2, from: '09:00', to: '12:00' },
      { weekday: 3, from: '09:00', to: '12:00' },
      { weekday: 2, from: '14:00', to: '17:00' },
    ])
    expect(garde).toHaveLength(3)
  })

  it('jette ce qui n’a pas de sens : fin avant le début, heure illisible', () => {
    expect(
      normalizeAvailability([
        { weekday: 2, from: '12:00', to: '09:00' },
        { weekday: 2, from: '12:00', to: '12:00' },
        { weekday: 2, from: 'midi', to: '14:00' },
      ]),
    ).toEqual([])
  })

  it('ne modifie pas la liste reçue', () => {
    const liste = [{ weekday: 2 as const, from: '09:00', to: '11:00' }]
    normalizeAvailability([...liste, { weekday: 2, from: '10:00', to: '12:00' }])
    expect(liste[0]!.to).toBe('11:00')
  })
})

describe('le rendez-vous tient-il dans une plage', () => {
  const plages = [mardiMatin, jeudiApresMidi]

  it('oui quand il y tient entièrement', () => {
    expect(coversAppointment(plages, 2, '09:00', 30)).toBe(true)
    expect(coversAppointment(plages, 2, '11:30', 30)).toBe(true)
    expect(coversAppointment(plages, 4, '16:00', 60)).toBe(true)
  })

  it('non quand il déborde, fût-ce de dix minutes', () => {
    expect(coversAppointment(plages, 2, '11:30', 45)).toBe(false)
    expect(coversAppointment(plages, 2, '08:45', 30)).toBe(false)
  })

  it('non un jour où la personne ne reçoit pas', () => {
    expect(coversAppointment(plages, 3, '10:00', 30)).toBe(false)
  })

  it('non quand aucune plage n’est renseignée', () => {
    expect(coversAppointment([], 2, '10:00', 30)).toBe(false)
  })

  it('les plages d’un jour se lisent séparément', () => {
    expect(windowsOn(plages, 2)).toEqual([mardiMatin])
    expect(windowsOn(plages, 3)).toEqual([])
  })
})

describe('l’avertissement', () => {
  const plages = [mardiMatin, jeudiApresMidi]

  it('se tait quand le rendez-vous tombe dans une plage', () => {
    expect(availabilityWarning(plages, 2, '10:00', 30)).toBeNull()
  })

  it('se tait aussi quand rien n’est renseigné : on ne reproche pas un silence', () => {
    expect(availabilityWarning([], 3, '10:00', 30)).toBeNull()
  })

  it('dit que la personne ne reçoit pas ce jour-là', () => {
    expect(availabilityWarning(plages, 3, '10:00', 30)).toMatch(/ne reçoit pas le mercredi/)
  })

  it('rappelle les heures du jour quand on tombe à côté', () => {
    const message = availabilityWarning(plages, 2, '14:00', 30)
    expect(message).toContain('09h00 → 12h00')
    expect(message).toMatch(/ce mardi/i)
  })

  it('n’interdit jamais : il le dit en toutes lettres', () => {
    expect(availabilityWarning(plages, 3, '10:00', 30)).toMatch(/tout de même/)
  })
})

describe('la phrase qui résume', () => {
  it('nomme les jours et les heures, sans abréviation', () => {
    expect(availabilityLabel([jeudiApresMidi, mardiMatin])).toBe(
      'Mardi de 09h00 à 12h00 · Jeudi de 14h00 à 17h00',
    )
  })

  it('est vide quand rien n’est renseigné', () => {
    expect(availabilityLabel([])).toBe('')
  })
})

describe('une plage qui ne tient pas debout', () => {
  it('dit ce qui cloche plutôt que de disparaître en silence', () => {
    expect(windowRefusal({ weekday: 5, from: '16:00', to: '08:00' })).toContain(
      "L'heure de fin est avant l'heure de début",
    )
    expect(windowRefusal({ weekday: 1, from: '10:00', to: '10:00' })).toContain('ne dure rien')
    expect(windowRefusal({ weekday: 1, from: 'n’importe quoi', to: '10:00' })).toContain(
      'Indiquez une heure',
    )
  })

  it('se tait quand la plage est bonne', () => {
    expect(windowRefusal({ weekday: 2, from: '09:00', to: '12:00' })).toBeNull()
  })

  it('désigne la ligne fautive, pour qu’on sache laquelle corriger', () => {
    const refus = firstWindowRefusal([
      { weekday: 2, from: '09:00', to: '12:00' },
      { weekday: 4, from: '17:00', to: '09:00' },
    ])
    expect(refus?.index).toBe(1)
    expect(refus?.message).toContain('avant')
  })

  it('ne trouve rien à redire à une liste vide ou entièrement valide', () => {
    expect(firstWindowRefusal([])).toBeNull()
    expect(firstWindowRefusal([{ weekday: 2, from: '09:00', to: '12:00' }])).toBeNull()
  })
})
