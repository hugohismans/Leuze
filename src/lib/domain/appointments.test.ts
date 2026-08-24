import { describe, expect, it } from 'vitest'
import {
  PREFERENCE_LABELS,
  kindName,
  nextScheduled,
  upcomingScheduled,
  patientStatusLabel,
  pendingFirst,
  waitingDays,
  waitingLabel,
} from './appointments'
import type { Appointment, AppointmentKind } from './types'

const kinds: AppointmentKind[] = [
  { id: 'psychiatre', name: 'Le psychiatre', icon: '🩺', isActive: true },
  { id: 'kine', name: 'Le kinésithérapeute', icon: '🤸', isActive: true },
]

const demande = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'rdv-1',
  patientUid: 'p_1',
  kindId: 'psychiatre',
  preference: 'peu-importe',
  status: 'requested',
  createdAt: new Date('2026-08-17T09:00:00Z'),
  ...overrides,
})

describe('ce que le patient lit', () => {
  it('dit que la demande est partie, sans promettre de délai', () => {
    const texte = patientStatusLabel(demande(), kinds)
    expect(texte).toContain('Demande envoyée')
    expect(texte).toContain('Un soignant vous dira quand')
    // Aucune promesse chiffrée : personne ne peut la tenir.
    expect(texte).not.toMatch(/\d+ (heures?|jours?)/)
  })

  it('donne le rendez-vous en toutes lettres une fois fixé', () => {
    const texte = patientStatusLabel(
      demande({
        status: 'scheduled',
        localDate: '2026-08-25',
        start: new Date('2026-08-25T12:00:00Z'),
        end: new Date('2026-08-25T12:30:00Z'),
        withWhom: 'Docteur Lemaire',
      }),
      kinds,
    )
    expect(texte).toContain('Mardi 25 août')
    expect(texte).toContain('Docteur Lemaire')
  })

  it('propose une suite quand le rendez-vous est annulé', () => {
    expect(patientStatusLabel(demande({ status: 'cancelled' }), kinds)).toContain('peut vous en proposer un autre')
    expect(
      patientStatusLabel(demande({ status: 'cancelled', cancellationReason: 'Le médecin est absent' }), kinds),
    ).toContain('Le médecin est absent')
  })

  it('nomme le professionnel, même si le motif a disparu de la liste', () => {
    expect(kindName(kinds, 'psychiatre')).toBe('Le psychiatre')
    expect(kindName(kinds, 'supprime')).toBe('Un professionnel')
  })
})

describe('la file des demandes', () => {
  it('met les plus anciennes d’abord : c’est l’ordre à traiter', () => {
    const file = pendingFirst([
      demande({ id: 'recente', createdAt: new Date('2026-08-19T09:00:00Z') }),
      demande({ id: 'ancienne', createdAt: new Date('2026-08-15T09:00:00Z') }),
      demande({ id: 'fixee', status: 'scheduled', createdAt: new Date('2026-08-10T09:00:00Z') }),
    ])
    expect(file.map((a) => a.id)).toEqual(['ancienne', 'recente'])
  })

  it('compte l’attente en jours, sans jamais compter à l’envers', () => {
    const now = new Date('2026-08-20T09:00:00Z')
    expect(waitingDays(demande({ createdAt: new Date('2026-08-20T08:00:00Z') }), now)).toBe(0)
    expect(waitingDays(demande({ createdAt: new Date('2026-08-19T08:00:00Z') }), now)).toBe(1)
    expect(waitingDays(demande({ createdAt: new Date('2026-08-15T08:00:00Z') }), now)).toBe(5)
    expect(waitingDays(demande({ createdAt: new Date('2026-08-25T08:00:00Z') }), now)).toBe(0)
  })

  it('dit l’attente en français, pour qu’un oubli se voie', () => {
    expect(waitingLabel(0)).toBe("Demandé aujourd'hui")
    expect(waitingLabel(1)).toBe('Demandé hier')
    expect(waitingLabel(5)).toBe('En attente depuis 5 jours')
  })
})

describe('préférence de moment', () => {
  it('reste grossière : ce n’est qu’une préférence', () => {
    expect(Object.keys(PREFERENCE_LABELS)).toEqual(['matin', 'apres-midi', 'peu-importe'])
    expect(PREFERENCE_LABELS['peu-importe']).toBe('Peu importe le moment')
  })
})

describe('le prochain rendez-vous', () => {
  const maintenant = new Date('2026-08-20T09:00:00Z')
  const fixe = (id: string, quand: string): Appointment =>
    demande({ id, status: 'scheduled', start: new Date(quand), end: new Date(quand) })

  it('est le plus proche à venir, jamais un rendez-vous passé', () => {
    const liste = [
      fixe('apres-demain', '2026-08-22T09:00:00Z'),
      fixe('hier', '2026-08-19T09:00:00Z'),
      fixe('demain', '2026-08-21T09:00:00Z'),
    ]
    expect(nextScheduled(liste, maintenant)?.id).toBe('demain')
  })

  it('n’existe pas quand tout est passé, annulé ou encore en attente', () => {
    expect(nextScheduled([fixe('hier', '2026-08-19T09:00:00Z')], maintenant)).toBeNull()
    expect(nextScheduled([demande({ status: 'requested' })], maintenant)).toBeNull()
    expect(
      nextScheduled([demande({ status: 'cancelled', start: new Date('2026-08-25T09:00:00Z') })], maintenant),
    ).toBeNull()
    expect(nextScheduled([], maintenant)).toBeNull()
  })
})

describe('les rendez-vous qui restent à venir', () => {
  const maintenant = new Date('2026-08-21T10:00:00Z')
  const fixe = (id: string, debut: string, fin: string): Appointment =>
    demande({ id, status: 'scheduled', start: new Date(debut), end: new Date(fin) })

  it('laissent de côté ceux qui ont déjà eu lieu', () => {
    const liste = [
      fixe('avant-hier', '2026-08-19T07:30:00Z', '2026-08-19T08:00:00Z'),
      fixe('demain', '2026-08-22T08:00:00Z', '2026-08-22T08:30:00Z'),
    ]
    expect(upcomingScheduled(liste, maintenant).map((a) => a.id)).toEqual(['demain'])
  })

  it('gardent celui qui est en train de se dérouler', () => {
    const encours = fixe('maintenant', '2026-08-21T09:45:00Z', '2026-08-21T10:15:00Z')
    expect(upcomingScheduled([encours], maintenant).map((a) => a.id)).toEqual(['maintenant'])
  })

  it('sont rangés du plus proche au plus lointain, sans les demandes ni les annulations', () => {
    const liste = [
      fixe('dans-dix-jours', '2026-08-31T08:00:00Z', '2026-08-31T08:30:00Z'),
      fixe('demain', '2026-08-22T08:00:00Z', '2026-08-22T08:30:00Z'),
      demande({ id: 'en-attente', status: 'requested' }),
      demande({ id: 'annule', status: 'cancelled', start: new Date('2026-08-25T08:00:00Z') }),
    ]
    expect(upcomingScheduled(liste, maintenant).map((a) => a.id)).toEqual(['demain', 'dans-dix-jours'])
  })
})

/**
 * Une date qui disparaît sans un mot passe pour une panne.
 *
 * Le rendez-vous était fixé, la personne s'est déclarée absente, et la demande est
 * retournée dans la file. Le patient n'y est pour rien : il doit lire ce qui s'est passé,
 * et savoir qu'il n'a rien à refaire.
 */
describe('un rendez-vous rouvert par un congé', () => {
  const kinds = [{ id: 'psychiatre', name: 'Le psychiatre', icon: '🩺', isActive: true }]
  const base = {
    id: 'r1',
    patientUid: 'p1',
    kindId: 'psychiatre',
    preference: 'peu-importe' as const,
    createdAt: new Date('2026-08-20T10:00:00Z'),
  }

  it("dit que la personne sera absente, et que la demande tient toujours", () => {
    const phrase = patientStatusLabel(
      { ...base, status: 'requested', reopenedForLeave: true },
      kinds,
    )
    expect(phrase).toContain('absente')
    expect(phrase).toContain('de nouveau en attente')
  })

  it('ne dit jamais pourquoi la personne s’absente', () => {
    const phrase = patientStatusLabel(
      { ...base, status: 'requested', reopenedForLeave: true },
      kinds,
    )
    expect(phrase.toLowerCase()).not.toContain('congé')
    expect(phrase.toLowerCase()).not.toContain('vacances')
  })

  it('une demande ordinaire garde exactement sa phrase d’avant', () => {
    expect(patientStatusLabel({ ...base, status: 'requested' }, kinds)).toBe(
      'Demande envoyée pour voir le psychiatre. Un soignant vous dira quand.',
    )
  })
})
