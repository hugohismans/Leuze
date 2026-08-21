import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAZUREL, asPatient, asStaff, asVisitor, createEnvironment } from './helpers'

/**
 * Invariants n°2 et n°3 : un patient ne lit que sa propre inscription, et personne
 * n'écrit dans `registrations` depuis un navigateur — la capacité ne se défend que
 * dans une transaction de Cloud Function.
 */

let env: RulesTestEnvironment

const registration = (patientUid: string, status = 'confirmed') => ({
  occurrenceId: 'occ-1',
  patientUid,
  status,
  createdAt: new Date('2026-08-01T09:00:00Z'),
  queuedAt: new Date('2026-08-01T09:00:00Z'),
  createdBy: 'patient',
})

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
    await setDoc(doc(database, 'registrations', 'insc-camille'), registration('p_camille'))
    await setDoc(doc(database, 'registrations', 'insc-lucien'), registration('p_lucien', 'waitlist'))
    await setDoc(doc(database, 'patients', 'p_camille'), {
      firstName: 'Camille',
      serviceId: MAZUREL,
      createdAt: new Date(),
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    })
    await setDoc(doc(database, 'patientCodes', 'empreinte-quelconque'), {
      uid: 'p_camille',
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    })
  })
})

describe('lecture des inscriptions', () => {
  it('laisse le patient lire la sienne', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertSucceeds(getDoc(doc(database, 'registrations', 'insc-camille')))
  })

  it('refuse au patient l’inscription de quelqu’un d’autre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(getDoc(doc(database, 'registrations', 'insc-lucien')))
  })

  it('accepte « mes inscriptions », filtrée sur son identifiant', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    const snapshot = await assertSucceeds(
      getDocs(query(collection(database, 'registrations'), where('patientUid', '==', 'p_camille'))),
    )
    expect(snapshot.size).toBe(1)
  })

  it('refuse la liste des inscrits d’une activité à un patient', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      getDocs(query(collection(database, 'registrations'), where('occurrenceId', '==', 'occ-1'))),
    )
  })

  it('refuse même une requête déguisée en « les miennes » avec l’identifiant d’un autre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      getDocs(query(collection(database, 'registrations'), where('patientUid', '==', 'p_lucien'))),
    )
  })

  it('refuse au personnel de lire les inscriptions directement', async () => {
    // Une inscription porte aussi la présence, qui n'appartient qu'à la personne qui
    // anime l'activité. Le personnel obtient ses listes par `staffRoster`, une fonction
    // appelable qui sait à qui elle parle.
    const database = asStaff(env)
    await assertFails(
      getDocs(query(collection(database, 'registrations'), where('occurrenceId', '==', 'occ-1'))),
    )
    await assertFails(getDoc(doc(database, 'registrations', 'insc-camille')))
  })

  it('refuse tout à une personne non connectée', async () => {
    const database = asVisitor(env)
    await assertFails(getDoc(doc(database, 'registrations', 'insc-camille')))
  })
})

describe('écriture des inscriptions — interdite depuis un navigateur', () => {
  it('refuse au patient de créer sa propre inscription', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(addDoc(collection(database, 'registrations'), registration('p_camille')))
  })

  it('refuse au patient de se promouvoir depuis la liste d’attente', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(updateDoc(doc(database, 'registrations', 'insc-camille'), { status: 'confirmed' }))
  })

  it('refuse au patient de supprimer une inscription', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(deleteDoc(doc(database, 'registrations', 'insc-camille')))
  })

  it('refuse aussi au personnel : la capacité ne se modifie qu’en transaction', async () => {
    const database = asStaff(env)
    await assertFails(addDoc(collection(database, 'registrations'), registration('p_lucien')))
    await assertFails(updateDoc(doc(database, 'registrations', 'insc-lucien'), { status: 'confirmed' }))
  })
})

describe('identités des patients', () => {
  it('reste illisible pour le patient lui-même', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(getDoc(doc(database, 'patients', 'p_camille')))
  })

  it('reste illisible pour le personnel : les prénoms passent par une Cloud Function', async () => {
    const database = asStaff(env)
    await assertFails(getDoc(doc(database, 'patients', 'p_camille')))
    await assertFails(getDocs(collection(database, 'patients')))
  })

  it('ne laisse jamais lire les empreintes des codes d’accès', async () => {
    await assertFails(getDoc(doc(asStaff(env), 'patientCodes', 'empreinte-quelconque')))
    await assertFails(getDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'patientCodes', 'empreinte-quelconque')))
    await assertFails(getDocs(collection(asVisitor(env), 'patientCodes')))
  })
})
