import { describe, expect, it } from 'vitest'
import { makeActivity, makeOccurrence } from './fixtures'
import { cancelRange, expand, mergeOccurrences, occurrenceId, splitSeries } from './recurrence'
import { formatTime } from './time'

describe('récurrence — dépliage', () => {
  it('produit une occurrence par jour concerné dans la fenêtre', () => {
    const dates = expand(makeActivity(), '2025-08-01', '2025-08-31').map((o) => o.localDate)
    expect(dates).toEqual(['2025-08-05', '2025-08-12', '2025-08-19', '2025-08-26'])
  })

  it('respecte les bornes de la règle et la fenêtre demandée', () => {
    const activity = makeActivity({
      recurrence: {
        freq: 'weekly',
        byWeekday: [2],
        startTime: '14:00',
        durationMin: 90,
        from: '2025-08-10',
        until: '2025-08-20',
        skipDates: [],
      },
    })
    const dates = expand(activity, '2025-08-01', '2025-08-31').map((o) => o.localDate)
    expect(dates).toEqual(['2025-08-12', '2025-08-19'])
  })

  it('saute les dates de congé', () => {
    const activity = makeActivity({
      recurrence: { ...makeActivity().recurrence!, skipDates: ['2025-08-12', '2025-08-19'] },
    })
    const dates = expand(activity, '2025-08-01', '2025-08-31').map((o) => o.localDate)
    expect(dates).toEqual(['2025-08-05', '2025-08-26'])
  })

  it('gère plusieurs jours par semaine', () => {
    const activity = makeActivity({
      recurrence: { ...makeActivity().recurrence!, byWeekday: [1, 4] },
    })
    const dates = expand(activity, '2025-08-04', '2025-08-17').map((o) => o.localDate)
    expect(dates).toEqual(['2025-08-04', '2025-08-07', '2025-08-11', '2025-08-14'])
  })

  it('garde 14h00 après le passage à l’heure d’hiver', () => {
    const activity = makeActivity({
      recurrence: { ...makeActivity().recurrence!, from: '2025-10-01' },
    })
    const occurrences = expand(activity, '2025-10-20', '2025-11-05')
    expect(occurrences.map((o) => formatTime(o.start))).toEqual(['14h00', '14h00', '14h00'])
    expect(occurrences.map((o) => formatTime(o.end))).toEqual(['15h30', '15h30', '15h30'])
  })

  it('ignore une activité désactivée', () => {
    expect(expand(makeActivity({ isActive: false }), '2025-08-01', '2025-08-31')).toEqual([])
  })

  it('déplie une activité ponctuelle', () => {
    const activity = makeActivity({
      recurrence: null,
      singleStart: { date: '2025-09-03', time: '10:00', durationMin: 60 },
    })
    expect(expand(activity, '2025-09-01', '2025-09-30')).toHaveLength(1)
    expect(expand(activity, '2025-10-01', '2025-10-31')).toHaveLength(0)
  })

  it('produit des identifiants déterministes', () => {
    expect(occurrenceId('act-yoga', '2025-08-19', '14:00')).toBe('act-yoga_20250819T1400')
    const a = expand(makeActivity(), '2025-08-01', '2025-08-31').map((o) => o.id)
    const b = expand(makeActivity(), '2025-08-01', '2025-08-31').map((o) => o.id)
    expect(a).toEqual(b)
  })
})

describe('récurrence — rapprochement avec l’existant', () => {
  it('est idempotent : régénérer deux fois ne crée pas de doublon', () => {
    const drafts = expand(makeActivity(), '2025-08-01', '2025-08-31')
    const plan = mergeOccurrences(drafts, drafts)
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(4)
    expect(plan.remove).toHaveLength(0)
  })

  it('n’écrase jamais une occurrence modifiée isolément', () => {
    const drafts = expand(makeActivity({ title: 'Yoga doux (nouveau nom)' }), '2025-08-01', '2025-08-31')
    const existing = [
      makeOccurrence({
        id: 'act-yoga_20250819T1400',
        localDate: '2025-08-19',
        status: 'cancelled',
        cancellationReason: "L'animatrice est absente",
        overridden: true,
      }),
    ]
    const plan = mergeOccurrences(drafts, existing)
    expect(plan.preserved).toHaveLength(1)
    expect(plan.preserved[0]?.status).toBe('cancelled')
    expect(plan.update).toHaveLength(0)
    expect(plan.create).toHaveLength(3)
  })

  it('écrase l’exception quand le soignant choisit « et les suivantes »', () => {
    const drafts = expand(makeActivity(), '2025-08-01', '2025-08-31')
    const existing = [
      makeOccurrence({ id: 'act-yoga_20250819T1400', localDate: '2025-08-19', status: 'cancelled', overridden: true }),
    ]
    const plan = mergeOccurrences(drafts, existing, { overrideFrom: '2025-08-19' })
    expect(plan.preserved).toHaveLength(0)
    expect(plan.update[0]?.status).toBe('scheduled')
    expect(plan.update[0]?.overridden).toBe(false)
  })

  it('conserve les compteurs d’inscription lors d’une mise à jour', () => {
    const drafts = expand(makeActivity({ title: 'Yoga du mardi' }), '2025-08-19', '2025-08-19')
    const existing = [makeOccurrence({ localDate: '2025-08-19', confirmedCount: 5, waitlistCount: 2 })]
    const plan = mergeOccurrences(drafts, existing)
    expect(plan.update[0]?.title).toBe('Yoga du mardi')
    expect(plan.update[0]?.confirmedCount).toBe(5)
    expect(plan.update[0]?.waitlistCount).toBe(2)
  })

  it('annule au lieu de supprimer quand des patients sont inscrits', () => {
    const drafts = expand(makeActivity({ recurrence: { ...makeActivity().recurrence!, byWeekday: [3] } }), '2025-08-18', '2025-08-24')
    const existing = [makeOccurrence({ localDate: '2025-08-19', confirmedCount: 3 })]
    const plan = mergeOccurrences(drafts, existing)
    expect(plan.remove).toHaveLength(0)
    expect(plan.cancel).toHaveLength(1)
    expect(plan.cancel[0]?.status).toBe('cancelled')
    expect(plan.cancel[0]?.cancellationReason).toBeTruthy()
  })

  it('supprime une occurrence devenue hors série et sans inscription', () => {
    const drafts = expand(makeActivity({ recurrence: { ...makeActivity().recurrence!, byWeekday: [3] } }), '2025-08-18', '2025-08-24')
    const existing = [makeOccurrence({ localDate: '2025-08-19' })]
    const plan = mergeOccurrences(drafts, existing)
    expect(plan.remove).toEqual(['act-yoga_20250819T1400'])
    expect(plan.cancel).toHaveLength(0)
  })
})

describe('récurrence — scission de série', () => {
  it('clôt la série la veille et démarre la nouvelle à la date choisie', () => {
    const { previous, next } = splitSeries(makeActivity(), '2025-09-02', { locationId: 'jardin' }, 'act-yoga-2')
    expect(previous.recurrence?.until).toBe('2025-09-01')
    expect(next.id).toBe('act-yoga-2')
    expect(next.seriesId).toBe(previous.seriesId)
    expect(next.recurrence?.from).toBe('2025-09-02')
    expect(next.locationId).toBe('jardin')
  })

  it('ne produit aucun chevauchement entre l’ancienne et la nouvelle série', () => {
    const { previous, next } = splitSeries(makeActivity(), '2025-09-02', { title: 'Yoga sur chaise' }, 'act-yoga-2')
    const avant = expand(previous, '2025-08-01', '2025-09-30').map((o) => o.localDate)
    const apres = expand(next, '2025-08-01', '2025-09-30').map((o) => o.localDate)
    expect(avant.filter((d) => apres.includes(d))).toEqual([])
    expect(avant.at(-1)).toBe('2025-08-26')
    expect(apres[0]).toBe('2025-09-02')
  })
})

describe('récurrence — annulation en série', () => {
  it('barre les occurrences de la période sans les supprimer', () => {
    const occurrences = expand(makeActivity(), '2025-08-01', '2025-08-31')
    const cancelled = cancelRange(occurrences, '2025-08-11', '2025-08-24', "L'animatrice est en congé")
    expect(cancelled.map((o) => o.localDate)).toEqual(['2025-08-12', '2025-08-19'])
    expect(cancelled.every((o) => o.status === 'cancelled' && o.overridden)).toBe(true)
    expect(cancelled[0]?.cancellationReason).toBe("L'animatrice est en congé")
  })
})

describe('retirer une activité du programme, puis l’y remettre', () => {
  const activite = makeActivity({
    recurrence: {
      freq: 'weekly',
      byWeekday: [2],
      startTime: '14:00',
      durationMin: 90,
      from: '2026-08-01',
      until: null,
      skipDates: [],
    },
  })

  it('rend les séances qui portaient des inscriptions, et pas seulement les vides', () => {
    const prevues = expand(activite, '2026-08-25', '2026-09-08')
    expect(prevues.length).toBeGreaterThan(0)

    // Le retrait : plus aucune séance prévue. Celles qui portent des inscriptions sont
    // barrées plutôt que supprimées — on n'efface pas ce à quoi quelqu'un s'est inscrit.
    const avecInscrits = prevues.map((o, i) => (i === 0 ? { ...o, confirmedCount: 3 } : o))
    const retrait = mergeOccurrences([], avecInscrits)
    expect(retrait.cancel).toHaveLength(1)
    expect(retrait.remove).toHaveLength(prevues.length - 1)

    // La remise au programme : la séance barrée redevient normale, sans motif.
    const barrees = retrait.cancel
    const remise = mergeOccurrences(prevues, barrees)
    expect(remise.update).toHaveLength(1)
    expect(remise.update[0]!.status).toBe('scheduled')
    expect(remise.update[0]!.cancellationReason).toBeUndefined()
    expect(remise.update[0]!.overridden).toBe(false)
    // Les inscriptions, elles, n'ont jamais bougé.
    expect(remise.update[0]!.confirmedCount).toBe(3)
  })

  it('ne rétablit pas une séance qu’un soignant a annulée avec un motif', () => {
    const prevues = expand(activite, '2026-08-25', '2026-09-08')
    const annuleeALaMain = prevues.map((o, i) =>
      i === 0
        ? {
            ...o,
            confirmedCount: 3,
            status: 'cancelled' as const,
            cancellationReason: 'La salle est prise',
            overridden: true,
            autoCancelled: false,
          }
        : o,
    )
    const plan = mergeOccurrences(prevues, annuleeALaMain)
    // Modifiée isolément : la régénération l'épargne, elle reste barrée avec son motif.
    expect(plan.preserved.map((o) => o.id)).toContain(prevues[0]!.id)
    expect(plan.update.map((o) => o.id)).not.toContain(prevues[0]!.id)
  })

  it('dit à la personne inscrite quoi faire quand l’horaire change', () => {
    const prevues = expand(activite, '2026-08-25', '2026-09-08')
    const avecInscrits = prevues.map((o, i) => (i === 0 ? { ...o, confirmedCount: 3 } : o))
    const plan = mergeOccurrences([], avecInscrits)
    // Le projet impose des messages qui disent quoi faire.
    expect(plan.cancel[0]!.cancellationReason).toContain('Inscrivez-vous')
    expect(plan.cancel[0]!.autoCancelled).toBe(true)
  })
})
