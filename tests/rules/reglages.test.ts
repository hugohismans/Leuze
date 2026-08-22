import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAZUREL, asAdmin, asPatient, asStaff, asVisitor, createEnvironment } from './helpers'

/**
 * Le réglage de ce que les patients ont le droit de faire.
 *
 * Il vit dans la configuration du service. Deux choses doivent être vraies, et la
 * seconde est facile à oublier :
 *
 *   1. L'administrateur seul le modifie — c'est une décision de service.
 *   2. **Un patient doit pouvoir le lire.** Son écran s'en sert pour ne pas proposer un
 *      geste qui serait refusé, et pour dire à la place ce qu'il faut faire. S'il ne
 *      pouvait pas le lire, l'application resterait ouverte partout — sans danger, mais
 *      le réglage ne servirait à rien, et personne ne s'en apercevrait.
 */

let env: RulesTestEnvironment

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
    await setDoc(doc(database, 'config', 'app'), {
      retentionDays: 90,
      patientActions: { register: true, unregister: false, requestAppointment: true, proposeActivity: true },
    })
    await setDoc(doc(database, 'patientActions', 'p_camille'), { register: false })
    await setDoc(doc(database, 'patientActions', 'p_bernard'), { proposeActivity: true })
  })
})

describe('lire le réglage', () => {
  it('un patient le lit : son écran en dépend', async () => {
    const snapshot = await assertSucceeds(getDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'config', 'app')))
    expect(snapshot.data()?.['patientActions']).toMatchObject({ unregister: false })
  })

  it('le personnel le lit aussi', async () => {
    await assertSucceeds(getDoc(doc(asStaff(env), 'config', 'app')))
    await assertSucceeds(getDoc(doc(asAdmin(env), 'config', 'app')))
  })

  it('un visiteur sans session ne lit rien', async () => {
    await assertFails(getDoc(doc(asVisitor(env), 'config', 'app')))
  })
})

describe('modifier le réglage', () => {
  it('l’administrateur le peut : c’est une décision de service', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(env), 'config', 'app'), {
        patientActions: { register: false, unregister: false, requestAppointment: false, proposeActivity: false },
      }),
    )
  })

  it('un soignant ordinaire ne le peut pas', async () => {
    await assertFails(
      updateDoc(doc(asStaff(env), 'config', 'app'), { patientActions: { register: false } }),
    )
  })

  it('un patient ne s’ouvre pas de droits tout seul', async () => {
    await assertFails(
      updateDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'config', 'app'), {
        patientActions: { unregister: true },
      }),
    )
  })
})

describe('le réglage particulier d’une personne', () => {
  it('elle lit le sien : son écran en dépend', async () => {
    const snapshot = await assertSucceeds(
      getDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'patientActions', 'p_camille')),
    )
    expect(snapshot.data()).toMatchObject({ register: false })
  })

  it('elle ne lit pas celui de quelqu’un d’autre', async () => {
    await assertFails(
      getDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'patientActions', 'p_bernard')),
    )
  })

  it('le personnel les lit tous : c’est lui qui voit la fiche', async () => {
    await assertSucceeds(getDoc(doc(asStaff(env), 'patientActions', 'p_camille')))
    await assertSucceeds(getDoc(doc(asAdmin(env), 'patientActions', 'p_bernard')))
  })

  it('l’administrateur seul l’écrit : une exception est une décision de service', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(env), 'patientActions', 'p_camille'), { register: true }))
    await assertFails(setDoc(doc(asStaff(env), 'patientActions', 'p_camille'), { register: true }))
  })

  it('personne ne s’accorde d’exception à soi-même', async () => {
    await assertFails(
      setDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'patientActions', 'p_camille'), {
        register: true,
      }),
    )
  })

  it('un visiteur sans session ne lit rien', async () => {
    await assertFails(getDoc(doc(asVisitor(env), 'patientActions', 'p_camille')))
  })
})
