import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  JONCQUERELLE,
  MAZUREL,
  asPatient,
  asStaff,
  asVisitor,
  createEnvironment,
  occurrenceDoc,
} from './helpers'

/**
 * Invariant n°1 : une activité réservée à un autre service n'atteint jamais le
 * navigateur du patient — pas même son titre.
 */

let env: RulesTestEnvironment

const OUVERTE = 'occ-ouverte'
const MAZUREL_SEUL = 'occ-mazurel'
const JONCQUERELLE_SEUL = 'occ-joncquerelle'
const DEUX_SERVICES = 'occ-deux-services'

beforeAll(async () => {
  env = await createEnvironment()
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore()
    await setDoc(doc(database, 'occurrences', OUVERTE), occurrenceDoc({ audienceKeys: ['all'] }))
    await setDoc(
      doc(database, 'occurrences', MAZUREL_SEUL),
      occurrenceDoc({ title: 'Groupe de parole', audienceKeys: [MAZUREL] }),
    )
    await setDoc(
      doc(database, 'occurrences', JONCQUERELLE_SEUL),
      occurrenceDoc({ title: 'Ping-pong', audienceKeys: [JONCQUERELLE] }),
    )
    await setDoc(
      doc(database, 'occurrences', DEUX_SERVICES),
      occurrenceDoc({ title: 'Relaxation', audienceKeys: [MAZUREL, JONCQUERELLE] }),
    )
  })
})

describe('lecture d’une occurrence isolée', () => {
  it('accepte une activité ouverte à tous les services', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertSucceeds(getDoc(doc(database, 'occurrences', OUVERTE)))
  })

  it('accepte une activité réservée à son service', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertSucceeds(getDoc(doc(database, 'occurrences', MAZUREL_SEUL)))
    await assertSucceeds(getDoc(doc(database, 'occurrences', DEUX_SERVICES)))
  })

  it('refuse une activité réservée à un autre service, même avec l’adresse exacte', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(getDoc(doc(database, 'occurrences', JONCQUERELLE_SEUL)))
  })

  it('refuse tout à une personne non connectée', async () => {
    const database = asVisitor(env)
    await assertFails(getDoc(doc(database, 'occurrences', OUVERTE)))
  })
})

describe('requête du calendrier', () => {
  it('accepte la requête filtrée sur le service du patient', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(database, 'occurrences'),
          where('audienceKeys', 'array-contains-any', ['all', MAZUREL]),
        ),
      ),
    )
    const titres = snapshot.docs.map((d) => d.data().title).sort()
    expect(titres).toEqual(['Atelier créatif', 'Groupe de parole', 'Relaxation'])
    expect(titres).not.toContain('Ping-pong')
  })

  it('refuse en bloc une requête non filtrée : pas de sous-ensemble silencieux', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(getDocs(collection(database, 'occurrences')))
  })

  it('refuse une requête qui réclame le service de quelqu’un d’autre', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(
      getDocs(
        query(
          collection(database, 'occurrences'),
          where('audienceKeys', 'array-contains-any', ['all', JONCQUERELLE]),
        ),
      ),
    )
  })

  it('laisse le personnel voir tout le programme', async () => {
    const database = asStaff(env)
    const snapshot = await assertSucceeds(getDocs(collection(database, 'occurrences')))
    expect(snapshot.size).toBe(4)
  })
})

describe('modification d’une occurrence', () => {
  it('laisse un soignant annuler avec un motif', async () => {
    const database = asStaff(env)
    await assertSucceeds(
      updateDoc(doc(database, 'occurrences', OUVERTE), {
        status: 'cancelled',
        cancellationReason: "L'animateur est absent",
      }),
    )
  })

  it('refuse qu’un soignant touche aux compteurs de places', async () => {
    const database = asStaff(env)
    await assertFails(updateDoc(doc(database, 'occurrences', OUVERTE), { confirmedCount: 99 }))
  })

  it('refuse qu’un soignant change l’audience sans passer par l’activité', async () => {
    const database = asStaff(env)
    await assertFails(updateDoc(doc(database, 'occurrences', OUVERTE), { audienceKeys: [MAZUREL] }))
  })

  it('refuse toute modification par un patient', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(updateDoc(doc(database, 'occurrences', OUVERTE), { status: 'cancelled' }))
  })

  it('refuse la suppression, y compris au personnel', async () => {
    const database = asStaff(env)
    await assertFails(deleteDoc(doc(database, 'occurrences', OUVERTE)))
  })
})
