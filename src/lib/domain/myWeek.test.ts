import { describe, expect, it } from 'vitest'
import { makeOccurrence } from './fixtures'
import { myWeek, weekEntryCount } from './myWeek'
import type { Appointment } from './types'

const JOURS = ['2026-08-31', '2026-09-01', '2026-09-02']

const inscription = (id: string, localDate: string, heure: string, overrides = {}) => ({
  occurrence: makeOccurrence({
    id,
    localDate,
    start: new Date(`${localDate}T${heure}:00Z`),
    end: new Date(`${localDate}T${heure}:00Z`),
    ...overrides,
  }),
  status: 'confirmed' as const,
})

const rendezVous = (localDate: string, heure: string, overrides: Partial<Appointment> = {}): Appointment => ({
  id: `rdv-${localDate}-${heure}`,
  patientUid: 'p_1',
  kindId: 'psychiatre',
  preference: 'peu-importe',
  status: 'scheduled',
  createdAt: new Date('2026-08-20T09:00:00Z'),
  localDate,
  start: new Date(`${localDate}T${heure}:00Z`),
  end: new Date(`${localDate}T${heure}:00Z`),
  ...overrides,
})

describe('la semaine d’un patient', () => {
  it('mêle activités et rendez-vous dans l’ordre de la journée', () => {
    const semaine = myWeek(
      JOURS,
      [inscription('a', '2026-09-01', '14:00'), inscription('b', '2026-09-01', '08:00')],
      [rendezVous('2026-09-01', '11:00')],
    )
    const mardi = semaine[1]!
    expect(mardi.entries.map((e) => e.kind)).toEqual(['activity', 'appointment', 'activity'])
    expect(mardi.entries.map((e) => e.start.getUTCHours())).toEqual([8, 11, 14])
  })

  it('donne les sept jours, même vides', () => {
    const semaine = myWeek(JOURS, [], [])
    expect(semaine.map((j) => j.date)).toEqual(JOURS)
    expect(weekEntryCount(semaine)).toBe(0)
  })

  it('ignore ce qui tombe hors de la semaine demandée', () => {
    const semaine = myWeek(JOURS, [inscription('hors', '2026-09-20', '10:00')], [rendezVous('2026-09-20', '10:00')])
    expect(weekEntryCount(semaine)).toBe(0)
  })

  it('ignore un rendez-vous demandé mais pas encore fixé', () => {
    const demande: Appointment = {
      id: 'rdv-en-attente',
      patientUid: 'p_1',
      kindId: 'psychiatre',
      preference: 'matin',
      status: 'requested',
      createdAt: new Date('2026-08-20T09:00:00Z'),
    }
    expect(weekEntryCount(myWeek(JOURS, [], [demande]))).toBe(0)
  })

  it('garde une activité annulée, barrée avec son motif', () => {
    const semaine = myWeek(
      JOURS,
      [
        {
          ...inscription('annulee', '2026-09-01', '14:00', {
            status: 'cancelled',
            cancellationReason: "L'animateur est absent",
          }),
        },
      ],
      [],
    )
    const entree = semaine[1]!.entries[0]!
    expect(entree.kind).toBe('activity')
    expect(entree.kind === 'activity' && entree.cancelled).toBe(true)
    expect(entree.kind === 'activity' && entree.cancellationReason).toBe("L'animateur est absent")
  })

  it('signale une place encore en liste d’attente', () => {
    const semaine = myWeek(
      JOURS,
      [{ ...inscription('attente', '2026-08-31', '10:00'), status: 'waitlist' as const }],
      [],
    )
    const entree = semaine[0]!.entries[0]!
    expect(entree.kind === 'activity' && entree.waiting).toBe(true)
  })
})
