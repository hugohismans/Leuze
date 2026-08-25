import { describe, expect, it } from 'vitest'
import { makeOccurrence } from './fixtures'
import {
  clashLabel,
  clashesWith,
  myWeek,
  weekEntryCount,
  weekSummary,
  type WeekDay,
  type WeekEntry,
} from './myWeek'
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
    occurrenceId: 'seance-essai',
    start: new Date('2026-08-24T08:00:00Z'),
    end: new Date('2026-08-24T09:00:00Z'),
    title: 'Atelier',
    locationId: 'atelier',
    categoryId: 'creatif',
    cancelled,
    waiting: false,
    watching: false,
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

describe('un rendez-vous annulé sur la feuille de la semaine', () => {
  it('reste à son jour, barré, avec son motif', () => {
    const jours = ['2026-08-27']
    const semaine = myWeek(jours, [], [
      {
        id: 'rdv-1',
        patientUid: 'p_1',
        kindId: 'psychiatre',
        preference: 'peu-importe',
        status: 'cancelled',
        createdAt: new Date('2026-08-20T09:00:00Z'),
        localDate: '2026-08-27',
        start: new Date('2026-08-27T09:00:00Z'),
        end: new Date('2026-08-27T09:30:00Z'),
        withWhom: 'Docteur Lemaire',
        cancellationReason: "Le rendez-vous n'aura pas lieu",
      },
    ])
    const entree = semaine[0]?.entries[0]
    expect(entree?.kind).toBe('appointment')
    // « Rien de prévu » à sa place se lit comme une panne, et fait venir pour rien.
    expect(entree?.kind === 'appointment' && entree.cancelled).toBe(true)
    expect(entree?.kind === 'appointment' && entree.cancellationReason).toContain('n’aura pas lieu'.replace('’', "'"))
  })

  it('laisse un rendez-vous fixé sans marque d’annulation', () => {
    const semaine = myWeek(['2026-08-27'], [], [
      {
        id: 'rdv-2',
        patientUid: 'p_1',
        kindId: 'psychiatre',
        preference: 'peu-importe',
        status: 'scheduled',
        createdAt: new Date('2026-08-20T09:00:00Z'),
        localDate: '2026-08-27',
        start: new Date('2026-08-27T09:00:00Z'),
        end: new Date('2026-08-27T09:30:00Z'),
      },
    ])
    const entree = semaine[0]?.entries[0]
    expect(entree?.kind === 'appointment' && entree.cancelled).toBeUndefined()
  })
})

/**
 * Deux choses à la même heure, sur la feuille de la semaine.
 *
 * Constaté en service : un patient s'est inscrit à deux activités de quatorze heures.
 * « Ma semaine » les alignait l'une sous l'autre sans un mot — elles se lisent alors
 * comme deux rendez-vous de la journée, et l'on ne découvre le problème qu'une fois sur
 * place.
 */
describe('deux choses en même temps dans la semaine', () => {
  const seance = (
    titre: string,
    debut: string,
    fin: string,
    annulee = false,
  ): WeekEntry => ({
    kind: 'activity',
    occurrenceId: 'seance-essai',
    start: new Date(`2026-08-26T${debut}:00.000Z`),
    end: new Date(`2026-08-26T${fin}:00.000Z`),
    title: titre,
    locationId: 'salle',
    categoryId: 'sport',
    cancelled: annulee,
    waiting: false,
    watching: false,
  })
  const rendezVous = (debut: string, fin: string, withWhom?: string): WeekEntry => ({
    kind: 'appointment',
    start: new Date(`2026-08-26T${debut}:00.000Z`),
    end: new Date(`2026-08-26T${fin}:00.000Z`),
    kindId: 'psychiatre',
    ...(withWhom === undefined ? {} : { withWhom }),
  })
  const motif = () => 'le psychiatre'

  it('se tait quand les horaires s’enchaînent sans se toucher', () => {
    // Une activité qui finit à 15h00 et une qui commence à 15h00 s'enchaînent.
    const entrees = [seance('Jonglerie', '12:30', '13:30'), seance('Jeux de cartes', '13:30', '14:30')]
    expect(clashLabel(entrees, entrees[0]!, motif)).toBeNull()
    expect(clashesWith(entrees, entrees[0]!)).toEqual([])
  })

  it('nomme ce qui tombe en même temps, des deux côtés', () => {
    const entrees = [seance('Jonglerie', '12:30', '13:30'), seance('Jeux de cartes', '12:30', '13:30')]
    expect(clashLabel(entrees, entrees[0]!, motif)).toBe('En même temps que « Jeux de cartes »')
    expect(clashLabel(entrees, entrees[1]!, motif)).toBe('En même temps que « Jonglerie »')
  })

  it('repère un chevauchement partiel', () => {
    const entrees = [seance('Jonglerie', '12:30', '14:00'), seance('Jeux de cartes', '13:30', '15:00')]
    expect(clashLabel(entrees, entrees[0]!, motif)).toContain('Jeux de cartes')
  })

  it('nomme aussi un rendez-vous, avec la personne quand on la connaît', () => {
    const avecNom = [seance('Jonglerie', '12:30', '13:30'), rendezVous('12:45', '13:15', 'Docteur Lemaire')]
    expect(clashLabel(avecNom, avecNom[0]!, motif)).toBe(
      'En même temps que « Rendez-vous avec Docteur Lemaire »',
    )
    const sansNom = [seance('Jonglerie', '12:30', '13:30'), rendezVous('12:45', '13:15')]
    expect(clashLabel(sansNom, sansNom[0]!, motif)).toBe(
      'En même temps que « Rendez-vous avec le psychiatre »',
    )
  })

  it('compte, plutôt que d’énumérer, au-delà de deux', () => {
    const entrees = [
      seance('Jonglerie', '12:30', '13:30'),
      seance('Jeux de cartes', '12:30', '13:30'),
      seance('Chorale', '12:45', '13:15'),
    ]
    expect(clashLabel(entrees, entrees[0]!, motif)).toBe('En même temps que 2 autres choses')
  })

  it('ne compte pas ce qui est annulé, ni dans un sens ni dans l’autre', () => {
    /*
      Une séance annulée n'aura pas lieu : la barrer puis annoncer un conflit avec elle
      serait deux fois faux, et inquiéterait pour rien.
    */
    const entrees = [seance('Jonglerie', '12:30', '13:30'), seance('Jeux de cartes', '12:30', '13:30', true)]
    expect(clashLabel(entrees, entrees[0]!, motif)).toBeNull()
    expect(clashLabel(entrees, entrees[1]!, motif)).toBeNull()
  })
})
