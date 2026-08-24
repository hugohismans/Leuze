import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAZUREL, asAdmin, asPatient, asStaff, asVisitor, createEnvironment } from './helpers'

/**
 * Les congés du personnel.
 *
 * Ils vivent dans leur propre collection, et non sur la fiche de l'intervenant : celle-ci
 * est lisible par toute personne connectée — le patient y lit le nom de qui il demande à
 * voir. Les dates d'absence de quelqu'un n'ont rien à y faire.
 *
 * Deux choses doivent tenir :
 *
 *   1. Le personnel les lit — l'agenda et l'écran des rendez-vous en dépendent.
 *   2. **Personne ne les écrit depuis le navigateur.** Déclarer un congé rouvre les
 *      rendez-vous déjà fixés sur ces jours-là : deux écritures qui doivent tenir
 *      ensemble ne se confient pas au client. La fonction appelable s'en charge.
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
    await setDoc(doc(context.firestore(), 'leaves', 'claire'), {
      leaves: [{ from: '2026-08-24', to: '2026-08-28' }],
    })
  })
})

describe('lire les congés', () => {
  it('un soignant les lit : son agenda en dépend', async () => {
    const snapshot = await assertSucceeds(getDoc(doc(asStaff(env, 'u_marc'), 'leaves', 'claire')))
    expect(snapshot.data()?.['leaves']).toHaveLength(1)
  })

  it("l'administrateur les lit aussi : c'est lui qui répartit", async () => {
    await assertSucceeds(getDoc(doc(asAdmin(env, 'u_admin'), 'leaves', 'claire')))
  })

  it('un patient ne les lit pas : quand quelqu’un s’absente ne le regarde pas', async () => {
    await assertFails(getDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'leaves', 'claire')))
  })

  it('un visiteur non connecté ne les lit pas', async () => {
    await assertFails(getDoc(doc(asVisitor(env), 'leaves', 'claire')))
  })
})

describe('écrire les congés', () => {
  const conge = { leaves: [{ from: '2026-09-01', to: '2026-09-05' }] }

  it('un soignant ne les écrit pas, même les siens', async () => {
    // Ce n'est pas une défiance : déclarer un congé rouvre des rendez-vous, et cela se
    // fait en une seule fois, côté serveur.
    await assertFails(setDoc(doc(asStaff(env, 'u_claire'), 'leaves', 'claire'), conge))
  })

  it("l'administrateur non plus", async () => {
    await assertFails(setDoc(doc(asAdmin(env, 'u_admin'), 'leaves', 'claire'), conge))
  })

  it('un patient encore moins', async () => {
    await assertFails(setDoc(doc(asPatient(env, 'p_camille', MAZUREL), 'leaves', 'claire'), conge))
  })
})
