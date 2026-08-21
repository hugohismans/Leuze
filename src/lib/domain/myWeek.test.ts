import { describe, expect, it } from 'vitest'
import { makeOccurrence } from './fixtures'
import { myWeek, weekEntryCount, weekSummary, type WeekDay, type WeekEntry } from './myWeek'
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

describe('ce que porte une feuille, en toutes lettres', () => {
  const jour = (entries: WeekEntry[]): WeekDay[] => [{ date: '2026-08-24', entries }]
  const activite = (cancelled = false): WeekEntry => ({
    kind: 'activity',
    start: new Date('2026-08-24T08:00:00Z'),
    end: new Date('2026-08-24T09:00:00Z'),
    title: 'Atelier',
    locationId: 'atelier',
    categoryId: 'creatif',
    cancelled,
    waiting: false,
  })
  const rendezVous = (): WeekEntry => ({
    kind: 'appointment',
    start: new Date('2026-08-24T10:00:00Z'),
    end: new Date('2026-08-24T10:30:00Z'),
    kindId: 'psychiatre',
    patientUid: 'p1',
  })

  it('ne parle de rendez-vous que lorsqu’il y en a', () => {
    expect(weekSummary(jour([activite(), activite()]))).toBe('2 activités')
    expect(weekSummary(jour([activite()]))).toBe('1 activité')
  })

  it('ne parle d’activités que lorsqu’il y en a', () => {
    expect(weekSummary(jour([rendezVous()]))).toBe('1 rendez-vous')
    // « rendez-vous » a déjà son « s ».
    expect(weekSummary(jour([rendezVous(), rendezVous()]))).toBe('2 rendez-vous')
  })

  it('nomme les deux quand les deux sont là', () => {
    expect(weekSummary(jour([activite(), activite(), rendezVous()]))).toBe(
      '2 activités et 1 rendez-vous',
    )
  })

  it('compte les séances annulées à part : elles sont barrées sur la feuille', () => {
    expect(weekSummary(jour([activite(), activite(true)]))).toBe('1 activité et 1 annulée')
    expect(weekSummary(jour([activite(), rendezVous(), activite(true)]))).toBe(
      '1 activité, 1 rendez-vous et 1 annulée',
    )
  })

  it('dit qu’une feuille est vierge plutôt que « 0 »', () => {
    expect(weekSummary(jour([]))).toBe('Rien de prévu — feuille vierge')
    expect(weekSummary([])).toBe('Rien de prévu — feuille vierge')
  })
})
