import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import { registerTx, rosterFor, unregisterTx } from '../../functions/src/lib/registration'

/**
 * La capacité et la liste d'attente, éprouvées sur l'émulateur avec le code réel
 * des Cloud Functions. C'est ici que se joue le pire scénario du projet :
 * deux patients qui touchent la dernière place au même instant.
 */

const OCCURRENCE = 'atelier-cuisine_20260901T1400'
const MAZUREL = 'le-mazurel'
const JONCQUERELLE = 'la-joncquerelle'

const demain = () => new Date(Date.now() + 86_400_000)

async function seedOccurrence(overrides: Record<string, unknown> = {}): Promise<void> {
  const start = demain()
  await db()
    .collection(COLLECTIONS.occurrences)
    .doc(OCCURRENCE)
    .set({
      activityId: 'atelier-cuisine',
      seriesId: 'serie-cuisine',
      title: 'Atelier cuisine',
      description: 'Vous préparez un plat simple, ensemble.',
      categoryId: 'creatif',
      locationId: 'cuisine',
      localDate: '2026-09-01',
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(new Date(start.getTime() + 5_400_000)),
      audienceKeys: ['all'],
      capacity: 2,
      registrationRequired: true,
      waitlistEnabled: true,
      status: 'scheduled',
      overridden: false,
      confirmedCount: 0,
      waitlistCount: 0,
      ...overrides,
    })
}

async function clear(): Promise<void> {
  for (const name of [COLLECTIONS.occurrences, COLLECTIONS.registrations, COLLECTIONS.patients]) {
    const snapshot = await db().collection(name).get()
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()))
    // Un résidu fausserait silencieusement les comptages : mieux vaut échouer ici.
    expect((await db().collection(name).count().get()).data().count).toBe(0)
  }
}

const counters = async () => {
  const snapshot = await db().collection(COLLECTIONS.occurrences).doc(OCCURRENCE).get()
  const data = snapshot.data() as { confirmedCount: number; waitlistCount: number }
  return { confirmed: data.confirmedCount, waitlist: data.waitlistCount }
}

beforeEach(async () => {
  await clear()
})

describe('capacité', () => {
  it('confirme jusqu’à la dernière place, puis bascule en liste d’attente', async () => {
    await seedOccurrence({ capacity: 2 })

    const premier = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    const deuxieme = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2', by: 'patient', serviceId: MAZUREL })
    const troisieme = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_3', by: 'patient', serviceId: MAZUREL })

    expect(premier).toMatchObject({ ok: true, status: 'confirmed' })
    expect(deuxieme).toMatchObject({ ok: true, status: 'confirmed' })
    expect(troisieme).toMatchObject({ ok: true, status: 'waitlist', position: 1 })
    expect(await counters()).toEqual({ confirmed: 2, waitlist: 1 })
  })

  it('ne confirme qu’une seule personne quand cinq cliquent en même temps sur la dernière place', async () => {
    // Le scénario de la borne en salle commune. Sans transaction, deux patients
    // repartiraient tous les deux « inscrits » sur une place unique.
    await seedOccurrence({ capacity: 1 })

    const resultats = await Promise.all(
      ['p_1', 'p_2', 'p_3', 'p_4', 'p_5'].map((uid) =>
        registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: uid, by: 'patient', serviceId: MAZUREL }),
      ),
    )

    const confirmes = resultats.filter((r) => r.ok && r.status === 'confirmed')
    const attente = resultats.filter((r) => r.ok && r.status === 'waitlist')
    expect(confirmes).toHaveLength(1)
    expect(attente).toHaveLength(4)

    // Les positions d'attente sont distinctes : personne ne partage la place n°1.
    const positions = attente.map((r) => (r.ok ? r.position : null)).sort()
    expect(positions).toEqual([1, 2, 3, 4])
    expect(await counters()).toEqual({ confirmed: 1, waitlist: 4 })
  })

  it('refuse la seconde inscription du même patient', async () => {
    await seedOccurrence()
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    const encore = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    expect(encore).toMatchObject({ ok: false, reason: 'already-registered' })
    expect(await counters()).toEqual({ confirmed: 1, waitlist: 0 })
  })

  it('refuse une activité annulée, avec un message qui dit quoi faire', async () => {
    await seedOccurrence({ status: 'cancelled', cancellationReason: "L'animateur est absent" })
    const resultat = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.message).toContain('soignant')
  })
})

describe('audience', () => {
  it('refuse l’inscription à une activité réservée à un autre service', async () => {
    await seedOccurrence({ audienceKeys: [JONCQUERELLE] })
    const resultat = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    // Message volontairement identique à celui d'une activité inexistante :
    // ne pas révéler qu'elle existe.
    expect(resultat).toMatchObject({ ok: false, reason: 'unknown' })
    expect(await counters()).toEqual({ confirmed: 0, waitlist: 0 })
  })

  it('laisse le soignant inscrire quelqu’un, sans contrainte de service', async () => {
    await seedOccurrence({ audienceKeys: [JONCQUERELLE] })
    const resultat = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'staff' })
    expect(resultat).toMatchObject({ ok: true, status: 'confirmed' })
  })
})

describe('liste d’attente', () => {
  it('promeut le premier en attente dès qu’une place se libère', async () => {
    await seedOccurrence({ capacity: 1 })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_3', by: 'patient', serviceId: MAZUREL })
    expect(await counters()).toEqual({ confirmed: 1, waitlist: 2 })

    const sortie = await unregisterTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1' })
    expect(sortie.ok).toBe(true)
    expect(await counters()).toEqual({ confirmed: 1, waitlist: 1 })

    const lignes = await rosterFor(db(), OCCURRENCE)
    expect(lignes.find((l) => l.patientUid === 'p_2')?.status).toBe('confirmed')
    expect(lignes.find((l) => l.patientUid === 'p_3')).toMatchObject({ status: 'waitlist', position: 1 })
  })

  it('ne promeut personne quand c’est une personne en attente qui se retire', async () => {
    await seedOccurrence({ capacity: 1 })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2', by: 'patient', serviceId: MAZUREL })

    await unregisterTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2' })
    expect(await counters()).toEqual({ confirmed: 1, waitlist: 0 })
  })

  it('refuse la désinscription de quelqu’un qui n’est pas inscrit', async () => {
    await seedOccurrence()
    const resultat = await unregisterTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_inconnu' })
    expect(resultat.ok).toBe(false)
  })
})

describe('liste des inscrits', () => {
  it('joint les prénoms, qui ne sont lisibles par aucun client', async () => {
    await seedOccurrence({ capacity: 1 })
    await db().collection(COLLECTIONS.patients).doc('p_1').set({
      firstName: 'Camille',
      serviceId: MAZUREL,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(demain()),
    })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2', by: 'patient', serviceId: MAZUREL })

    const lignes = await rosterFor(db(), OCCURRENCE)
    expect(lignes[0]).toMatchObject({ firstName: 'Camille', status: 'confirmed', serviceId: MAZUREL })
    // Un patient dont la fiche a été purgée n'empêche pas d'imprimer la liste.
    expect(lignes[1]).toMatchObject({ firstName: 'Prénom inconnu', status: 'waitlist', position: 1 })
  })
})
