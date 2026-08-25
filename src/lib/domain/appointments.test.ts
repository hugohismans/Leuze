import { describe, expect, it } from 'vitest'
import {
  PREFERENCE_LABELS,
  alreadyAskedMessage,
  cancelledToShow,
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

describe('les rendez-vous annulés que le patient doit encore lire', () => {
  const maintenant = new Date('2026-08-25T14:00:00Z')

  it("montre l'annulation d'un soignant, avec son motif", () => {
    const liste = cancelledToShow(
      [
        demande({
          status: 'cancelled',
          localDate: '2026-08-27',
          start: new Date('2026-08-27T09:00:00Z'),
          cancellationReason: 'Le rendez-vous a été déplacé',
        }),
      ],
      '2026-08-25',
      maintenant,
    )
    expect(liste).toHaveLength(1)
    // La longueur vient d'être vérifiée juste au-dessus : la case existe.
    expect(patientStatusLabel(liste[0]!, kinds)).toContain('Le rendez-vous a été déplacé')
  })

  it("ne remet pas sous les yeux ce que le patient a retiré lui-même", () => {
    // Un retrait par le patient n'écrit aucun motif : il sait ce qu'il a fait.
    const liste = cancelledToShow([demande({ status: 'cancelled' })], '2026-08-25', maintenant)
    expect(liste).toEqual([])
  })

  it('oublie un rendez-vous annulé dont la date est passée', () => {
    const liste = cancelledToShow(
      [
        demande({
          status: 'cancelled',
          localDate: '2026-08-24',
          start: new Date('2026-08-24T09:00:00Z'),
          cancellationReason: 'Le rendez-vous a été déplacé',
        }),
      ],
      '2026-08-25',
      maintenant,
    )
    expect(liste).toEqual([])
  })

  it("garde le jour même : le rendez-vous annulé de cet après-midi doit se lire", () => {
    const liste = cancelledToShow(
      [
        demande({
          status: 'cancelled',
          localDate: '2026-08-25',
          start: new Date('2026-08-25T16:00:00Z'),
          cancellationReason: 'Le rendez-vous a été déplacé',
        }),
      ],
      '2026-08-25',
      maintenant,
    )
    expect(liste).toHaveLength(1)
  })

  it('montre une demande retirée de la file par un soignant, puis finit par l’oublier', () => {
    const recente = demande({
      id: 'recente',
      status: 'cancelled',
      createdAt: new Date('2026-08-20T09:00:00Z'),
      cancellationReason: 'Un soignant en a parlé avec la personne',
    })
    const ancienne = demande({
      id: 'ancienne',
      status: 'cancelled',
      createdAt: new Date('2026-07-01T09:00:00Z'),
      cancellationReason: 'Un soignant en a parlé avec la personne',
    })
    const liste = cancelledToShow([recente, ancienne], '2026-08-25', maintenant)
    expect(liste.map((a) => a.id)).toEqual(['recente'])
  })

  it('met le plus récent en tête', () => {
    const liste = cancelledToShow(
      [
        demande({
          id: 'apres',
          status: 'cancelled',
          localDate: '2026-08-28',
          start: new Date('2026-08-28T09:00:00Z'),
          cancellationReason: 'Le rendez-vous a été déplacé',
        }),
        demande({
          id: 'avant',
          status: 'cancelled',
          localDate: '2026-08-26',
          start: new Date('2026-08-26T09:00:00Z'),
          cancellationReason: 'Le rendez-vous a été déplacé',
        }),
      ],
      '2026-08-25',
      maintenant,
    )
    expect(liste.map((a) => a.id)).toEqual(['apres', 'avant'])
  })

  it('laisse tranquille ce qui est encore fixé ou en attente', () => {
    const liste = cancelledToShow(
      [demande(), demande({ status: 'scheduled', localDate: '2026-08-27' })],
      '2026-08-25',
      maintenant,
    )
    expect(liste).toEqual([])
  })
})

describe('un motif sans article', () => {
  const sansArticle: AppointmentKind[] = [
    { id: 'autre', name: 'Autre', icon: '👤', isActive: true },
  ]

  it('ne produit pas « pour voir autre » : la phrase se passe du nom', () => {
    const texte = patientStatusLabel(demande({ kindId: 'autre' }), sansArticle)
    expect(texte).not.toContain('pour voir autre')
    expect(texte).toContain('Demande envoyée')
    expect(texte).toContain('Un soignant vous dira quand')
  })

  it('garde le nom quand il porte son article', () => {
    expect(patientStatusLabel(demande(), kinds)).toContain('le psychiatre')
  })
})

describe('une seconde demande pour le même motif', () => {
  it('distingue une demande en attente d’un rendez-vous déjà fixé', () => {
    const attente = alreadyAskedMessage(kinds, 'psychiatre', 'requested')
    expect(attente).toContain('déjà demandé')
    expect(attente).toContain('le psychiatre')
    // Ce n'est pas un rendez-vous : ne pas le dire.
    expect(attente).not.toContain('rendez-vous prévu')

    const fixe = alreadyAskedMessage(kinds, 'psychiatre', 'scheduled')
    expect(fixe).toContain('rendez-vous prévu')
  })

  it('ne parle jamais d’« une personne » : la règle porte sur le motif', () => {
    const texte = alreadyAskedMessage(kinds, 'psychiatre', 'requested')
    expect(texte).not.toContain('cette personne')
  })

  it('reste lisible avec un motif sans article', () => {
    const sansArticle: AppointmentKind[] = [{ id: 'autre', name: 'Autre', icon: '👤', isActive: true }]
    expect(alreadyAskedMessage(sansArticle, 'autre', 'requested')).toContain('ce professionnel')
  })
})

describe('depuis combien de jours une demande attend', () => {
  const depose = (quand: string) => demande({ createdAt: new Date(quand) })

  it('compte des jours de calendrier, et non des tranches de vingt-quatre heures', () => {
    // Déposée hier à 22 h, lue ce matin à 9 h : elle a passé la nuit, et cela doit se voir.
    const hierSoir = depose('2026-08-24T20:00:00Z')
    expect(waitingDays(hierSoir, new Date('2026-08-25T07:00:00Z'))).toBe(1)
    expect(waitingLabel(waitingDays(hierSoir, new Date('2026-08-25T07:00:00Z')))).toBe('Demandé hier')
  })

  it('dit « aujourd’hui » pour une demande du jour même', () => {
    const ceMatin = depose('2026-08-25T06:00:00Z')
    expect(waitingDays(ceMatin, new Date('2026-08-25T20:00:00Z'))).toBe(0)
  })

  it('ne compte jamais en négatif', () => {
    expect(waitingDays(depose('2026-08-30T06:00:00Z'), new Date('2026-08-25T06:00:00Z'))).toBe(0)
  })

  it('compte plusieurs jours', () => {
    expect(waitingDays(depose('2026-08-20T20:00:00Z'), new Date('2026-08-25T07:00:00Z'))).toBe(5)
  })
})
