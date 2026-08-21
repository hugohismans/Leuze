import { describe, expect, it } from 'vitest'
import {
  AUTO_DURATION_MIN,
  AUTO_HORIZON_DAYS,
  autoAcceptMessage,
  findFirstSlot,
  type BusySlot,
} from './autoAccept'
import type { AvailabilityWindow } from './types'

// 2026-08-24 est un lundi ; la semaine qui suit sert de repère à tous les cas.
const LUNDI = '2026-08-24'
const MARDI = '2026-08-25'
const MERCREDI = '2026-08-26'
const JEUDI = '2026-08-27'

const mardiMatin: AvailabilityWindow[] = [{ weekday: 2, from: '09:00', to: '12:00' }]
const mardiEtJeudi: AvailabilityWindow[] = [
  { weekday: 2, from: '09:00', to: '12:00' },
  { weekday: 4, from: '14:00', to: '17:00' },
]

function chercher(
  windows: AvailabilityWindow[],
  options: Partial<Parameters<typeof findFirstSlot>[0]> = {},
): ReturnType<typeof findFirstSlot> {
  return findFirstSlot({
    windows,
    busy: [],
    preference: 'peu-importe',
    from: LUNDI,
    horizonDays: AUTO_HORIZON_DAYS,
    durationMin: AUTO_DURATION_MIN,
    ...options,
  })
}

describe('la première place libre', () => {
  it('tombe à l’ouverture de la première plage venue', () => {
    expect(chercher(mardiMatin)).toEqual({
      localDate: MARDI,
      time: '09:00',
      matchesPreference: true,
    })
  })

  it('n’existe pas sans plage déclarée — on ne devine pas les horaires de quelqu’un', () => {
    expect(chercher([])).toBeNull()
  })

  it('ignore les plages trop courtes pour la durée demandée', () => {
    const court: AvailabilityWindow[] = [{ weekday: 2, from: '09:00', to: '09:20' }]
    expect(chercher(court, { durationMin: 30 })).toBeNull()
  })

  it('se décale après un rendez-vous déjà pris', () => {
    const pris: BusySlot[] = [{ localDate: MARDI, from: '09:00', to: '09:30' }]
    expect(chercher(mardiMatin, { busy: pris })?.time).toBe('09:30')
  })

  it('se glisse dans un trou laissé entre deux rendez-vous', () => {
    const pris: BusySlot[] = [
      { localDate: MARDI, from: '09:00', to: '09:30' },
      { localDate: MARDI, from: '10:00', to: '11:00' },
    ]
    expect(chercher(mardiMatin, { busy: pris })?.time).toBe('09:30')
  })

  it('passe au jour suivant quand la journée est pleine', () => {
    const pris: BusySlot[] = [{ localDate: MARDI, from: '09:00', to: '12:00' }]
    expect(chercher(mardiMatin, { busy: pris })).toEqual({
      localDate: '2026-09-01',
      time: '09:00',
      matchesPreference: true,
    })
  })

  it('ne propose jamais le jour de départ lui-même quand il n’est pas dans les plages', () => {
    // Le lundi n'est pas une plage : la recherche commence de toute façon au mardi.
    expect(chercher(mardiMatin)?.localDate).not.toBe(LUNDI)
  })
})

describe('la préférence du patient', () => {
  it('écarte l’après-midi quand le matin est demandé', () => {
    const trouve = chercher(mardiEtJeudi, { preference: 'matin' })
    expect(trouve).toEqual({ localDate: MARDI, time: '09:00', matchesPreference: true })
  })

  it('écarte le matin quand l’après-midi est demandé', () => {
    const trouve = chercher(mardiEtJeudi, { preference: 'apres-midi' })
    expect(trouve).toEqual({ localDate: JEUDI, time: '14:00', matchesPreference: true })
  })

  it('ne prend pas pour le matin un créneau à cheval sur midi', () => {
    const cheval: AvailabilityWindow[] = [{ weekday: 2, from: '11:45', to: '13:00' }]
    // 11h45 finirait à 12h15 : ce n'est plus le matin. La place est tout de même
    // retenue faute de mieux, mais elle est annoncée comme hors du moment souhaité.
    expect(chercher(cheval, { preference: 'matin' })).toEqual({
      localDate: MARDI,
      time: '11:45',
      matchesPreference: false,
    })
  })

  it('propose un autre moment plutôt que rien, en le disant', () => {
    // Rien que des après-midi : une demande « le matin » n'a aucune place à sa main.
    const apresMidi: AvailabilityWindow[] = [{ weekday: 2, from: '14:00', to: '17:00' }]
    expect(chercher(apresMidi, { preference: 'matin' })).toEqual({
      localDate: MARDI,
      time: '14:00',
      matchesPreference: false,
    })
  })

  it('ne cherche pas deux fois quand aucun moment n’était demandé', () => {
    expect(chercher([{ weekday: 3, from: '09:00', to: '09:10' }])).toBeNull()
  })
})

describe('l’horizon', () => {
  it('arrête la recherche au bout du délai fixé', () => {
    // Une plage le mercredi, mais on ne regarde que deux jours à partir du lundi.
    const mercredi: AvailabilityWindow[] = [{ weekday: 3, from: '09:00', to: '12:00' }]
    expect(chercher(mercredi, { horizonDays: 2 })).toBeNull()
    expect(chercher(mercredi, { horizonDays: 3 })?.localDate).toBe(MERCREDI)
  })
})

describe('un créneau occupé mal formé', () => {
  it('bloque la journée plutôt que de laisser poser un rendez-vous par-dessus', () => {
    const abime: BusySlot[] = [{ localDate: MARDI, from: 'x', to: '10:00' }]
    expect(chercher(mardiMatin, { busy: abime })?.localDate).not.toBe(MARDI)
  })
})

describe('ce que le patient lit', () => {
  it('dit que c’est fixé, et quand', () => {
    const message = autoAcceptMessage(
      { localDate: MARDI, time: '09:00', matchesPreference: true },
      'Mardi 25 août, 09h00 → 09h30',
      'le psychiatre',
    )
    expect(message).toBe("C'est noté : Mardi 25 août, 09h00 → 09h30 avec le psychiatre.")
  })

  it('prévient quand le moment souhaité n’était pas libre', () => {
    const message = autoAcceptMessage(
      { localDate: JEUDI, time: '14:00', matchesPreference: false },
      'Jeudi 27 août, 14h00 → 14h30',
      'le psychiatre',
    )
    expect(message).toContain('pas possible au moment que vous souhaitiez')
    expect(message).toContain('dites-le à un soignant')
  })
})
