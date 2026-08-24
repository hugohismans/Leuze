import { describe, expect, it } from 'vitest'
import { agendaWeek, firstBookableDay, freeSlotsOn, suggestSlot, suggestionMessage } from './agenda'
import type { BusyEntry } from './conflicts'
import { instantOf } from './time'
import type { AvailabilityWindow } from './types'

// 2026-08-24 est un lundi ; 25 mardi, 26 mercredi, 27 jeudi.
const LUNDI = '2026-08-24'
const MARDI = '2026-08-25'
const JEUDI = '2026-08-27'

const mardiMatin: AvailabilityWindow[] = [{ weekday: 2, from: '09:00', to: '12:00' }]
const mardiEtJeudi: AvailabilityWindow[] = [
  { weekday: 2, from: '09:00', to: '12:00' },
  { weekday: 4, from: '14:00', to: '17:00' },
]

const pris = (jour: string, de: string, a: string, label = 'Occupé'): BusyEntry => ({
  start: instantOf(jour, de),
  end: instantOf(jour, a),
  label,
  kind: 'appointment',
})

describe('ce qui reste libre dans une journée', () => {
  it('est la plage entière quand rien n’est pris', () => {
    expect(freeSlotsOn(mardiMatin, [], MARDI, 30)).toEqual([{ from: '09:00', to: '12:00' }])
  })

  it('se coupe autour de ce qui est déjà pris', () => {
    const occupe = [pris(MARDI, '10:00', '10:30')]
    expect(freeSlotsOn(mardiMatin, occupe, MARDI, 30)).toEqual([
      { from: '09:00', to: '10:00' },
      { from: '10:30', to: '12:00' },
    ])
  })

  it('ignore les trous trop courts pour la durée demandée', () => {
    // Il reste 09h00–09h20 et 09h50–12h00 : le premier ne sert à rien pour 30 minutes.
    const occupe = [pris(MARDI, '09:20', '09:50')]
    expect(freeSlotsOn(mardiMatin, occupe, MARDI, 30)).toEqual([{ from: '09:50', to: '12:00' }])
  })

  it('fond deux créneaux pris qui se chevauchent', () => {
    const occupe = [pris(MARDI, '10:00', '11:00'), pris(MARDI, '10:30', '11:30')]
    expect(freeSlotsOn(mardiMatin, occupe, MARDI, 30)).toEqual([
      { from: '09:00', to: '10:00' },
      { from: '11:30', to: '12:00' },
    ])
  })

  it('ne rend rien un jour sans plage', () => {
    expect(freeSlotsOn(mardiMatin, [], LUNDI, 30)).toEqual([])
  })

  it('ne rend rien quand la journée est pleine', () => {
    expect(freeSlotsOn(mardiMatin, [pris(MARDI, '09:00', '12:00')], MARDI, 30)).toEqual([])
  })

  it('ignore ce qui est pris un autre jour', () => {
    expect(freeSlotsOn(mardiMatin, [pris(JEUDI, '09:00', '12:00')], MARDI, 30)).toEqual([
      { from: '09:00', to: '12:00' },
    ])
  })
})

describe('la semaine telle qu’on la lit pour poser un rendez-vous', () => {
  it('donne pour chaque jour la plage annoncée, ce qui est pris et ce qui reste', () => {
    const semaine = agendaWeek([LUNDI, MARDI], mardiMatin, [pris(MARDI, '10:00', '10:30', 'Camille')], 30)
    expect(semaine[0]).toEqual({ localDate: LUNDI, windows: [], taken: [], free: [] })
    expect(semaine[1]?.windows).toEqual([{ weekday: 2, from: '09:00', to: '12:00' }])
    expect(semaine[1]?.taken.map((t) => t.label)).toEqual(['Camille'])
    expect(semaine[1]?.free).toEqual([
      { from: '09:00', to: '10:00' },
      { from: '10:30', to: '12:00' },
    ])
  })
})

describe('le créneau proposé', () => {
  const chercher = (options: Partial<Parameters<typeof suggestSlot>[0]> = {}) =>
    suggestSlot({
      windows: mardiEtJeudi,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: LUNDI,
      horizonDays: 21,
      durationMin: 30,
      ...options,
    })

  it('tombe à l’ouverture de la première plage libre', () => {
    expect(chercher()).toEqual({ localDate: MARDI, time: '09:00', matchesPreference: true })
  })

  it('évite ce que l’intervenant a déjà', () => {
    expect(chercher({ practitionerBusy: [pris(MARDI, '09:00', '10:00')] })?.time).toBe('10:00')
  })

  it('évite aussi ce que le patient a déjà — c’est tout l’objet', () => {
    const occupe: BusyEntry[] = [
      { ...pris(MARDI, '09:00', '11:00', 'Atelier cuisine'), kind: 'activity' },
    ]
    expect(chercher({ patientBusy: occupe })?.time).toBe('11:00')
  })

  it('respecte le moment souhaité quand c’est possible', () => {
    expect(chercher({ preference: 'apres-midi' })).toEqual({
      localDate: JEUDI,
      time: '14:00',
      matchesPreference: true,
    })
  })

  it('préfère une place plus tôt à un moment souhaité très lointain', () => {
    /*
      Le mardi matin est pris. Le moment souhaité — le matin — ne revient que le mardi
      suivant, dans huit jours ; le jeudi après-midi est libre dans trois. On propose le
      jeudi, en disant que le matin n'était pas possible : c'est ce qu'un soignant
      proposerait de vive voix.
    */
    const occupe = [pris(MARDI, '09:00', '12:00')]
    expect(chercher({ preference: 'matin', practitionerBusy: occupe })).toEqual({
      localDate: JEUDI,
      time: '14:00',
      matchesPreference: false,
    })
  })

  it('n’existe pas sans plage déclarée', () => {
    expect(chercher({ windows: [] })).toBeNull()
  })

  it('n’existe pas quand tout est pris dans l’horizon regardé', () => {
    const semainePleine = [pris(MARDI, '09:00', '12:00'), pris(JEUDI, '14:00', '17:00')]
    expect(chercher({ practitionerBusy: semainePleine, horizonDays: 6 })).toBeNull()
  })
})

describe('ce que l’écran dit du créneau proposé', () => {
  it('l’annonce simplement quand il convient', () => {
    const message = suggestionMessage(
      { localDate: MARDI, time: '09:00', matchesPreference: true },
      'matin',
      'Mardi 25 août, de 09h00 à 09h30',
    )
    expect(message).toBe('Créneau proposé : Mardi 25 août, de 09h00 à 09h30.')
  })

  it('dit d’abord ce qui n’a pas pu être respecté', () => {
    const message = suggestionMessage(
      { localDate: JEUDI, time: '14:00', matchesPreference: false },
      'matin',
      'Jeudi 27 août, de 14h00 à 14h30',
    )
    expect(message).toContain('Rien de libre le matin dans la semaine qui vient')
    expect(message).toContain('Jeudi 27 août')
  })

  it('ne laisse pas sans réponse quand il n’y a rien', () => {
    const message = suggestionMessage(null, 'peu-importe', '')
    expect(message).toContain('Aucun créneau')
    expect(message).toContain('Vous pouvez tout de même fixer le rendez-vous')
  })
})

/**
 * « Jamais aujourd'hui » — la règle qui manquait du côté de l'agenda croisé.
 *
 * L'acceptation automatique l'appliquait déjà ; la proposition faite à la bulle, non.
 * Elle a donc proposé un rendez-vous le jour même à neuf heures trente, alors qu'il en
 * était quatorze : rien dans ce module ne connaît l'heure qu'il est, et rien ne devrait
 * avoir à la connaître.
 */
describe('le premier jour où l’on propose', () => {
  it('est le lendemain, jamais le jour même', () => {
    expect(firstBookableDay('2026-08-24')).toBe('2026-08-25')
  })

  it('franchit les fins de mois', () => {
    expect(firstBookableDay('2026-08-31')).toBe('2026-09-01')
    expect(firstBookableDay('2026-12-31')).toBe('2027-01-01')
  })

  it('ne propose plus rien aujourd’hui, même si la plage y est libre', () => {
    // Une plage le lundi, et l'on cherche depuis un lundi : la proposition doit sauter
    // au lundi suivant plutôt que d'offrir une heure déjà passée.
    const lundi = '2026-08-24'
    const proposition = suggestSlot({
      windows: [{ weekday: 1, from: '09:00', to: '12:00' }],
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: firstBookableDay(lundi),
      horizonDays: 21,
      durationMin: 30,
    })
    expect(proposition?.localDate).toBe('2026-08-31')
  })
})
