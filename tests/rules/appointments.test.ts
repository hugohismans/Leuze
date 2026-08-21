import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MAZUREL,
  asAdmin,
  asPatient,
  asPractitioner,
  asStaff,
  asVisitor,
  createEnvironment,
} from './helpers'

/**
 * Rendez-vous individuels. Trois garanties : un patient ne voit que les siens et ne peut
 * ni fixer un rendez-vous ni en créer un pour quelqu'un d'autre ; un intervenant ne voit
 * que son agenda et n'y écrit que des rendez-vous à son nom ; l'administrateur voit tout,
 * parce que quelqu'un doit répartir les demandes.
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

/** Un rendez-vous déjà fixé, au nom d'un intervenant précis. */
const fixe = (patientUid: string, practitionerId: string) => ({
  patientUid,
  kindId: 'psychiatre',
  preference: 'peu-importe',
  status: 'scheduled',
  createdAt: new Date('2026-08-17T09:00:00Z'),
  localDate: '2026-08-25',
  start: new Date('2026-08-25T12:00:00Z'),
  end: new Date('2026-08-25T12:30:00Z'),
  withWhom: 'Peu importe',
  practitionerId,
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
    // Deux rendez-vous déjà fixés, chacun à un professionnel différent.
    await setDoc(doc(database, 'appointments', 'rdv-chez-lemaire'), fixe('p_camille', 'docteur-lemaire'))
    await setDoc(doc(database, 'appointments', 'rdv-chez-claire'), fixe('p_lucien', 'claire'))
  })
})

describe('demander un rendez-vous', () => {
  /*
    La demande passe désormais par une fonction appelable : décider s'il reste une place
    chez quelqu'un suppose de lire son agenda, ce qu'un patient ne verra jamais. Le
    navigateur n'écrit donc plus rien ici — pas même une demande bien formée.
  */
  it('refuse au patient d’écrire lui-même sa demande', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(setDoc(doc(database, 'appointments', 'rdv-neuf'), demande('p_camille')))
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
    // Sa demande, et le rendez-vous qu'on lui a fixé. Ceux de Lucien, jamais.
    expect(snapshot.size).toBe(2)
  })

  it('laisse l’administrateur voir toute la file : c’est lui qui répartit', async () => {
    const snapshot = await assertSucceeds(getDocs(collection(asAdmin(env), 'appointments')))
    expect(snapshot.size).toBe(4)
  })

  it('refuse toute la file à un soignant : « avec le psychiatre » en dit déjà trop', async () => {
    await assertFails(getDocs(collection(asStaff(env), 'appointments')))
    await assertFails(getDocs(collection(asPractitioner(env, 'docteur-lemaire'), 'appointments')))
  })

  it('laisse un intervenant lire son agenda, filtré sur son nom', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    const snapshot = await assertSucceeds(
      getDocs(
        query(collection(database, 'appointments'), where('practitionerId', '==', 'docteur-lemaire')),
      ),
    )
    expect(snapshot.size).toBe(1)
    await assertSucceeds(getDoc(doc(database, 'appointments', 'rdv-chez-lemaire')))
  })

  it('refuse à un intervenant l’agenda d’un collègue', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertFails(getDoc(doc(database, 'appointments', 'rdv-chez-claire')))
    await assertFails(
      getDocs(query(collection(database, 'appointments'), where('practitionerId', '==', 'claire'))),
    )
  })

  it('refuse à un intervenant les demandes que personne n’a encore prises', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertFails(getDoc(doc(database, 'appointments', 'rdv-camille')))
  })

  it('refuse tout à un compte du personnel relié à personne', async () => {
    // Une chaîne vide ne doit jamais être égale à un identifiant d'intervenant.
    const database = asStaff(env)
    await assertFails(getDoc(doc(database, 'appointments', 'rdv-chez-lemaire')))
    await assertFails(
      getDocs(query(collection(database, 'appointments'), where('practitionerId', '==', ''))),
    )
  })
})

describe('fixer et retirer', () => {
  it('laisse l’administrateur fixer la date et nommer qui il veut', async () => {
    const database = asAdmin(env)
    await assertSucceeds(
      updateDoc(doc(database, 'appointments', 'rdv-camille'), {
        status: 'scheduled',
        localDate: '2026-08-25',
        start: new Date('2026-08-25T12:00:00Z'),
        end: new Date('2026-08-25T12:30:00Z'),
        withWhom: 'Docteur Lemaire',
        practitionerId: 'docteur-lemaire',
      }),
    )
  })

  it('refuse à un intervenant de s’attribuer une demande en attente', async () => {
    // Il ne peut pas la lire : il ne peut pas davantage se la donner.
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertFails(
      updateDoc(doc(database, 'appointments', 'rdv-camille'), {
        status: 'scheduled',
        localDate: '2026-08-25',
        start: new Date('2026-08-25T12:00:00Z'),
        end: new Date('2026-08-25T12:30:00Z'),
        withWhom: 'Docteur Lemaire',
        practitionerId: 'docteur-lemaire',
      }),
    )
  })

  it('laisse un intervenant créer un rendez-vous à son nom', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertSucceeds(
      setDoc(doc(database, 'appointments', 'rdv-neuf-lemaire'), fixe('p_camille', 'docteur-lemaire')),
    )
  })

  it('refuse à un intervenant d’en créer un au nom d’un collègue', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertFails(
      setDoc(doc(database, 'appointments', 'rdv-usurpe-claire'), fixe('p_camille', 'claire')),
    )
  })

  it('refuse un rendez-vous qui ne nomme personne, sauf à l’administrateur', async () => {
    const { practitionerId: _sansNom, ...anonyme } = fixe('p_camille', 'docteur-lemaire')
    await assertFails(
      setDoc(doc(asPractitioner(env, 'docteur-lemaire'), 'appointments', 'rdv-anonyme-1'), anonyme),
    )
    await assertSucceeds(setDoc(doc(asAdmin(env), 'appointments', 'rdv-anonyme-2'), anonyme))
  })

  it('refuse à un intervenant de se retirer d’un rendez-vous en le donnant à un autre', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertFails(
      updateDoc(doc(database, 'appointments', 'rdv-chez-lemaire'), { practitionerId: 'claire' }),
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

  it('laisse l’administrateur le créer déjà fixé', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(env), 'appointments', 'rdv-direct'), fixe()))
  })

  it('laisse un intervenant le créer, à son nom', async () => {
    await assertSucceeds(
      setDoc(
        doc(asPractitioner(env, 'docteur-lemaire'), 'appointments', 'rdv-direct-lemaire'),
        fixe({ practitionerId: 'docteur-lemaire' }),
      ),
    )
  })

  it('accepte un lieu', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(env), 'appointments', 'rdv-lieu'), fixe({ locationId: 'salon-daccueil' })),
    )
  })

  it('refuse un rendez-vous sans date', async () => {
    const sansDate = fixe()
    delete (sansDate as Record<string, unknown>).start
    await assertFails(setDoc(doc(asAdmin(env), 'appointments', 'rdv-flou'), sansDate))
  })

  it('refuse un rendez-vous sans professionnel nommé', async () => {
    await assertFails(setDoc(doc(asAdmin(env), 'appointments', 'rdv-anonyme'), fixe({ withWhom: '' })))
  })

  it('refuse tout champ imprévu — c’est ce qui tient le texte libre à distance', async () => {
    await assertFails(
      setDoc(doc(asAdmin(env), 'appointments', 'rdv-note'), fixe({ motif: 'angoisses' })),
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
