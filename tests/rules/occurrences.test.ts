import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
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

  it('accepte la requête réelle de l’adapter : service, fenêtre de dates et tri', async () => {
    // Mot pour mot la requête de `firestoreRepository.listBetween`. Ce test vérifie deux
    // choses d'un coup : que les règles l'acceptent, et que Firestore accepte de combiner
    // `array-contains-any` avec un intervalle sur un autre champ.
    const database = asPatient(env, 'p_1', MAZUREL)
    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(database, 'occurrences'),
          where('audienceKeys', 'array-contains-any', ['all', MAZUREL]),
          where('localDate', '>=', '2026-08-31'),
          where('localDate', '<=', '2026-09-06'),
          orderBy('localDate'),
          orderBy('start'),
        ),
      ),
    )
    expect(snapshot.docs.map((d) => d.data().title).sort()).toEqual([
      'Atelier créatif',
      'Groupe de parole',
      'Relaxation',
    ])
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

  it('laisse un soignant rafraîchir l’audience — c’est ce que fait une régénération', async () => {
    // Le soignant définit déjà l'audience sur l'activité : la lui interdire ici ne
    // protégerait rien. Ce qui reste interdit, dans tous les cas, ce sont les compteurs.
    const database = asStaff(env)
    await assertSucceeds(updateDoc(doc(database, 'occurrences', OUVERTE), { audienceKeys: [MAZUREL] }))
    await assertFails(updateDoc(doc(database, 'occurrences', OUVERTE), { confirmedCount: 1 }))
  })

  it('refuse toute modification par un patient', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(updateDoc(doc(database, 'occurrences', OUVERTE), { status: 'cancelled' }))
  })

  it('refuse toute écriture d’occurrence à un patient', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(setDoc(doc(database, 'occurrences', 'occ-forgee'), occurrenceDoc()))
    await assertFails(deleteDoc(doc(database, 'occurrences', OUVERTE)))
  })
})

describe('génération des occurrences par l’application soignante', () => {
  // Sans Cloud Functions (plan gratuit), c'est l'écran soignant qui matérialise les
  // occurrences. Les règles doivent donc l'autoriser — sans jamais lui laisser toucher
  // aux compteurs de places, qui appartiennent aux inscriptions.

  it('laisse un soignant créer une occurrence vide', async () => {
    const database = asStaff(env)
    await assertSucceeds(
      setDoc(doc(database, 'occurrences', 'occ-nouvelle'), occurrenceDoc({ localDate: '2026-09-08' })),
    )
  })

  it('refuse une occurrence créée avec des inscrits', async () => {
    const database = asStaff(env)
    await assertFails(
      setDoc(doc(database, 'occurrences', 'occ-truquee'), occurrenceDoc({ confirmedCount: 5 })),
    )
  })

  it('laisse rafraîchir les champs d’une occurrence lors d’une régénération', async () => {
    const database = asStaff(env)
    await assertSucceeds(
      setDoc(doc(database, 'occurrences', OUVERTE), occurrenceDoc({ title: 'Atelier peinture' })),
    )
  })

  it('refuse une régénération qui modifierait les compteurs', async () => {
    const database = asStaff(env)
    await assertFails(
      setDoc(doc(database, 'occurrences', OUVERTE), occurrenceDoc({ confirmedCount: 3 })),
    )
  })

  it('supprime une occurrence sortie de la série, si personne n’y est inscrit', async () => {
    const database = asStaff(env)
    await assertSucceeds(deleteDoc(doc(database, 'occurrences', OUVERTE)))
  })

  it('refuse de supprimer une occurrence portant des inscriptions', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'occurrences', 'occ-avec-inscrits'),
        occurrenceDoc({ confirmedCount: 2 }),
      )
    })
    const database = asStaff(env)
    await assertFails(deleteDoc(doc(database, 'occurrences', 'occ-avec-inscrits')))
  })
})
