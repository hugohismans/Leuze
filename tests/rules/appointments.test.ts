import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAZUREL, asAdmin, asPatient, asStaff, asVisitor, createEnvironment } from './helpers'

/**
 * Rendez-vous individuels. Deux garanties : un patient ne voit que les siens, et il ne
 * peut ni fixer un rendez-vous, ni en créer un pour quelqu'un d'autre.
 */

let env: RulesTestEnvironment

const demande = (patientUid: string, overrides: Record<string, unknown> = {}) => ({
  patientUid,
  kindId: 'psychiatre',
  preference: 'peu-importe',
  status: 'requested',
  createdAt: new Date('2026-08-17T09:00:00Z'),
  ...overrides,
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
    await setDoc(doc(database, 'appointmentKinds', 'psychiatre'), {
      name: 'Le psychiatre',
      icon: '🩺',
      isActive: true,
    })
    await setDoc(doc(database, 'appointments', 'rdv-camille'), demande('p_camille'))
    await setDoc(doc(database, 'appointments', 'rdv-lucien'), demande('p_lucien'))
  })
})

describe('demander un rendez-vous', () => {
  it('laisse le patient créer sa demande', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertSucceeds(setDoc(doc(database, 'appointments', 'rdv-neuf'), demande('p_camille')))
  })

  it('refuse une demande créée au nom de quelqu’un d’autre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(setDoc(doc(database, 'appointments', 'rdv-usurpe'), demande('p_lucien')))
  })

  it('refuse que le patient fixe lui-même la date', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      setDoc(
        doc(database, 'appointments', 'rdv-force'),
        demande('p_camille', { start: new Date('2026-08-25T12:00:00Z'), withWhom: 'Docteur Lemaire' }),
      ),
    )
  })

  it('refuse une demande déjà marquée comme fixée', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      setDoc(doc(database, 'appointments', 'rdv-triche'), demande('p_camille', { status: 'scheduled' })),
    )
  })

  it('refuse une préférence inventée', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      setDoc(doc(database, 'appointments', 'rdv-bizarre'), demande('p_camille', { preference: 'la nuit' })),
    )
  })

  it('refuse tout à une personne non connectée', async () => {
    await assertFails(setDoc(doc(asVisitor(env), 'appointments', 'rdv-anonyme'), demande('p_camille')))
  })
})

describe('lecture des rendez-vous', () => {
  it('laisse le patient lire le sien', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertSucceeds(getDoc(doc(database, 'appointments', 'rdv-camille')))
  })

  it('refuse au patient celui de quelqu’un d’autre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(getDoc(doc(database, 'appointments', 'rdv-lucien')))
    await assertFails(getDocs(collection(database, 'appointments')))
  })

  it('accepte « mes rendez-vous », filtrée sur son identifiant', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    const snapshot = await assertSucceeds(
      getDocs(query(collection(database, 'appointments'), where('patientUid', '==', 'p_camille'))),
    )
    expect(snapshot.size).toBe(1)
  })

  it('laisse le personnel voir toute la file', async () => {
    const snapshot = await assertSucceeds(getDocs(collection(asStaff(env), 'appointments')))
    expect(snapshot.size).toBe(2)
  })
})

describe('fixer et retirer', () => {
  it('laisse un soignant fixer la date', async () => {
    const database = asStaff(env)
    await assertSucceeds(
      updateDoc(doc(database, 'appointments', 'rdv-camille'), {
        status: 'scheduled',
        localDate: '2026-08-25',
        start: new Date('2026-08-25T12:00:00Z'),
        end: new Date('2026-08-25T12:30:00Z'),
        withWhom: 'Docteur Lemaire',
      }),
    )
  })

  it('laisse le patient retirer sa demande tant qu’elle n’est pas fixée', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertSucceeds(updateDoc(doc(database, 'appointments', 'rdv-camille'), { status: 'cancelled' }))
  })

  it('refuse au patient de se fixer un rendez-vous en le modifiant', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      updateDoc(doc(database, 'appointments', 'rdv-camille'), {
        status: 'scheduled',
        withWhom: 'Docteur Lemaire',
      }),
    )
  })

  it('refuse au patient de toucher à la demande d’un autre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(updateDoc(doc(database, 'appointments', 'rdv-lucien'), { status: 'cancelled' }))
  })

  it('ne supprime jamais un rendez-vous, même pour un administrateur', async () => {
    const { deleteDoc } = await import('firebase/firestore')
    await assertFails(deleteDoc(doc(asAdmin(env), 'appointments', 'rdv-camille')))
  })
})

/**
 * Beaucoup de patients ne se serviront jamais de l'application : ils demandent leur
 * rendez-vous de vive voix. Le soignant doit pouvoir le fixer directement, sans demande
 * préalable — sans quoi l'agenda serait réservé à ceux qui ont un téléphone.
 */
describe('fixer un rendez-vous sans demande', () => {
  const fixe = (overrides: Record<string, unknown> = {}) => ({
    patientUid: 'p_camille',
    kindId: 'psychiatre',
    preference: 'peu-importe',
    status: 'scheduled',
    createdAt: new Date('2026-08-21T09:00:00Z'),
    start: new Date('2026-08-25T12:00:00Z'),
    end: new Date('2026-08-25T12:30:00Z'),
    localDate: '2026-08-25',
    withWhom: 'Docteur Lemaire',
    ...overrides,
  })

  it('laisse le soignant le créer déjà fixé', async () => {
    await assertSucceeds(setDoc(doc(asStaff(env), 'appointments', 'rdv-direct'), fixe()))
  })

  it('accepte un lieu', async () => {
    await assertSucceeds(
      setDoc(doc(asStaff(env), 'appointments', 'rdv-lieu'), fixe({ locationId: 'salon-daccueil' })),
    )
  })

  it('refuse un rendez-vous sans date', async () => {
    const sansDate = fixe()
    delete (sansDate as Record<string, unknown>).start
    await assertFails(setDoc(doc(asStaff(env), 'appointments', 'rdv-flou'), sansDate))
  })

  it('refuse un rendez-vous sans professionnel nommé', async () => {
    await assertFails(setDoc(doc(asStaff(env), 'appointments', 'rdv-anonyme'), fixe({ withWhom: '' })))
  })

  it('refuse tout champ imprévu — c’est ce qui tient le texte libre à distance', async () => {
    await assertFails(
      setDoc(doc(asStaff(env), 'appointments', 'rdv-note'), fixe({ motif: 'angoisses' })),
    )
  })

  it('refuse à un patient de s’en créer un déjà fixé', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(setDoc(doc(database, 'appointments', 'rdv-triche-2'), fixe()))
  })

  it('refuse à un visiteur d’en créer un', async () => {
    await assertFails(setDoc(doc(asVisitor(env), 'appointments', 'rdv-inconnu'), fixe()))
  })
})
