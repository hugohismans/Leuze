import { describe, expect, it } from 'vitest'
import { capacityOf, patientCapacityLabel, registrationBlock, staffCapacityLabel } from './capacity'
import { makeOccurrence } from './fixtures'
import { instantOf } from './time'

const avant = new Date('2025-08-19T09:00:00Z')

describe('capacité', () => {
  it('distingue les cinq états', () => {
    expect(capacityOf(makeOccurrence({ status: 'cancelled' })).kind).toBe('cancelled')
    expect(capacityOf(makeOccurrence({ registrationRequired: false })).kind).toBe('no-registration')
    expect(capacityOf(makeOccurrence({ capacity: null })).kind).toBe('unlimited')
    expect(capacityOf(makeOccurrence({ capacity: 12, confirmedCount: 4 })).kind).toBe('available')
    expect(capacityOf(makeOccurrence({ capacity: 12, confirmedCount: 10 })).kind).toBe('last-places')
    expect(capacityOf(makeOccurrence({ capacity: 12, confirmedCount: 12 })).kind).toBe('full')
  })

  it('ne descend jamais en dessous de zéro place restante', () => {
    const state = capacityOf(makeOccurrence({ capacity: 4, confirmedCount: 6 }))
    expect(state.kind).toBe('full')
  })

  it('parle au patient en français simple, sans chiffre anxiogène par défaut', () => {
    expect(patientCapacityLabel(makeOccurrence({ registrationRequired: false }))).toBe(
      'Ouvert à tous, sans inscription',
    )
    expect(patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 2 }))).toBe(
      'Il reste des places',
    )
    expect(patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 11 }))).toBe(
      'Dernières places',
    )
    expect(patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 12 }))).toBe(
      'Complet — vous pouvez vous mettre en attente',
    )
    expect(
      patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 12, waitlistEnabled: false })),
    ).toBe('Complet')
  })

  it('donne les chiffres exacts au personnel', () => {
    expect(staffCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 8, waitlistCount: 3 }))).toBe(
      '8 / 12 inscrits (4 restantes), 3 en attente',
    )
  })

  it('refuse l’inscription dans les cas prévus, et dit pourquoi', () => {
    expect(registrationBlock(makeOccurrence({ capacity: 12 }), avant)).toBeNull()
    expect(registrationBlock(makeOccurrence({ status: 'cancelled' }), avant)).toBe('cancelled')
    expect(registrationBlock(makeOccurrence({ registrationRequired: false }), avant)).toBe(
      'no-registration-required',
    )
    expect(registrationBlock(makeOccurrence({ capacity: 2, confirmedCount: 2, waitlistEnabled: false }), avant)).toBe(
      'full-no-waitlist',
    )
  })

  it('refuse l’inscription une fois l’activité commencée', () => {
    const occurrence = makeOccurrence({ localDate: '2025-08-19', capacity: 12 })
    const pendant = new Date(instantOf('2025-08-19', '14:30').getTime())
    expect(registrationBlock(occurrence, pendant)).toBe('past')
  })
})
