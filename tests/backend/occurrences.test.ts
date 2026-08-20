import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import { regenerateActivity } from '../../functions/src/lib/occurrences'
import { addLocalDays, todayLocalDate } from '../../src/lib/domain/time'

/**
 * Génération des occurrences sur la fenêtre glissante, contre l'émulateur.
 * Deux règles d'or à ne jamais enfreindre : ne pas écraser l'exception saisie par
 * un soignant, ne pas faire disparaître une occurrence portant des inscriptions.
 */

const ACTIVITE = 'yoga-du-mardi'
const from = todayLocalDate()
const to = addLocalDays(from, 84)

async function seedActivity(overrides: Record<string, unknown> = {}): Promise<void> {
  await db()
    .collection(COLLECTIONS.activities)
    .doc(ACTIVITE)
    .set({
      seriesId: 'serie-yoga',
      title: 'Yoga',
      description: 'Des mouvements lents, assis ou debout.',
      categoryId: 'relaxation',
      locationId: 'salle-de-detente',
      audience: 'all',
      serviceIds: [],
      capacity: 8,
      registrationRequired: true,
      waitlistEnabled: true,
      recurrence: {
        freq: 'weekly',
        byWeekday: [2],
        startTime: '14:00',
        durationMin: 90,
        from,
        until: null,
        skipDates: [],
      },
      isActive: true,
      ...overrides,
    })
}

const occurrences = async () => {
  const snapshot = await db().collection(COLLECTIONS.occurrences).where('activityId', '==', ACTIVITE).get()
  return snapshot.docs.map((document) => ({ id: document.id, ...(document.data() as Record<string, unknown>) }))
}

beforeEach(async () => {
  for (const name of [COLLECTIONS.occurrences, COLLECTIONS.activities]) {
    const snapshot = await db().collection(name).get()
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()))
  }
})

describe('matérialisation d’une série', () => {
  it('crée une occurrence par mardi de la fenêtre', async () => {
    await seedActivity()
    const rapport = await regenerateActivity(db(), ACTIVITE, { window: { from, to } })

    const liste = await occurrences()
    expect(liste.length).toBe(rapport.created)
    expect(liste.length).toBeGreaterThanOrEqual(11)
    // Tous les identifiants suivent le format déterministe, et tombent un mardi.
    expect(liste.every((o) => o.id.startsWith(`${ACTIVITE}_`) && o.id.endsWith('T1400'))).toBe(true)
  })

  it('est idempotente : la relancer ne crée aucun doublon', async () => {
    await seedActivity()
    const premier = await regenerateActivity(db(), ACTIVITE, { window: { from, to } })
    const second = await regenerateActivity(db(), ACTIVITE, { window: { from, to } })

    expect(second.created).toBe(0)
    expect(second.updated).toBe(premier.created)
    expect((await occurrences()).length).toBe(premier.created)
  })

  it('reporte les changements de la série sur les occurrences à venir', async () => {
    await seedActivity()
    await regenerateActivity(db(), ACTIVITE, { window: { from, to } })
    await db().collection(COLLECTIONS.activities).doc(ACTIVITE).update({ title: 'Yoga sur chaise' })
    await regenerateActivity(db(), ACTIVITE, { window: { from, to } })

    expect((await occurrences()).every((o) => o.title === 'Yoga sur chaise')).toBe(true)
  })
})

describe('exceptions saisies par un soignant', () => {
  it('n’écrase pas une occurrence annulée isolément', async () => {
    await seedActivity()
    await regenerateActivity(db(), ACTIVITE, { window: { from, to } })
    const cible = (await occurrences())[0] as { id: string }

    await db().collection(COLLECTIONS.occurrences).doc(cible.id).update({
      status: 'cancelled',
      cancellationReason: "L'animatrice est en congé",
      overridden: true,
    })
    const rapport = await regenerateActivity(db(), ACTIVITE, { window: { from, to } })

    expect(rapport.preserved).toBe(1)
    const apres = (await occurrences()).find((o) => o.id === cible.id)
    expect(apres).toMatchObject({ status: 'cancelled', cancellationReason: "L'animatrice est en congé" })
  })

  it('écrase l’exception seulement sur un « et les suivantes » explicite', async () => {
    await seedActivity()
    await regenerateActivity(db(), ACTIVITE, { window: { from, to } })
    const cible = (await occurrences()).sort((a, b) => (a.id < b.id ? -1 : 1))[0] as {
      id: string
      localDate: string
    }
    await db()
      .collection(COLLECTIONS.occurrences)
      .doc(cible.id)
      .update({ status: 'cancelled', overridden: true })

    await regenerateActivity(db(), ACTIVITE, { window: { from, to }, overrideFrom: cible.localDate })

    const apres = (await occurrences()).find((o) => o.id === cible.id)
    expect(apres).toMatchObject({ status: 'scheduled', overridden: false })
  })
})

describe('activité désactivée', () => {
  it('annule les occurrences portant des inscriptions et supprime les autres', async () => {
    await seedActivity()
    await regenerateActivity(db(), ACTIVITE, { window: { from, to } })
    const liste = await occurrences()
    const avecInscrits = liste[0] as { id: string }
    await db().collection(COLLECTIONS.occurrences).doc(avecInscrits.id).update({ confirmedCount: 3 })

    await db().collection(COLLECTIONS.activities).doc(ACTIVITE).update({ isActive: false })
    const rapport = await regenerateActivity(db(), ACTIVITE, { window: { from, to } })

    expect(rapport.cancelled).toBe(1)
    expect(rapport.removed).toBe(liste.length - 1)

    const restantes = await occurrences()
    expect(restantes).toHaveLength(1)
    expect(restantes[0]).toMatchObject({ id: avecInscrits.id, status: 'cancelled', confirmedCount: 3 })
  })
})
