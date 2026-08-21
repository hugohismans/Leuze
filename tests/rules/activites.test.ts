import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAZUREL, asAdmin, asPatient, asPractitioner, asStaff, createEnvironment } from './helpers'

/**
 * Le programme est un calendrier partagé : tout le personnel le lit, il est affiché au
 * mur de l'unité. Le modifier est autre chose — un soignant crée des activités, mais ce
 * sont les siennes : il les anime. Confier une activité à quelqu'un d'autre relève de
 * l'organisation du service, donc de l'administrateur.
 */

let env: RulesTestEnvironment

const activite = (overrides: Record<string, unknown> = {}) => ({
  title: 'Atelier peinture',
  description: 'Peinture libre, tout le matériel est fourni.',
  categoryId: 'creatif',
  locationId: 'atelier-creatif',
  capacity: 8,
  registrationRequired: true,
  waitlistEnabled: true,
  isActive: true,
  audience: 'all',
  serviceIds: [],
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
    await setDoc(doc(database, 'activities', 'chez-marc'), activite({ facilitatorId: 'marc' }))
    await setDoc(doc(database, 'activities', 'chez-claire'), activite({ facilitatorId: 'claire' }))
    await setDoc(doc(database, 'activities', 'sans-personne'), activite())
  })
})

describe('lire le programme', () => {
  it('tout le personnel le lit : il est affiché au mur', async () => {
    const snapshot = await assertSucceeds(getDocs(collection(asStaff(env), 'activities')))
    expect(snapshot.size).toBe(3)
    await assertSucceeds(getDocs(collection(asPractitioner(env, 'marc'), 'activities')))
  })

  it('un patient ne lit jamais la définition des activités', async () => {
    await assertFails(getDocs(collection(asPatient(env, 'p_camille', MAZUREL), 'activities')))
  })
})

describe('créer une activité', () => {
  it('un intervenant la crée, à son nom', async () => {
    const database = asPractitioner(env, 'marc')
    await assertSucceeds(
      setDoc(doc(database, 'activities', 'neuve-marc'), activite({ facilitatorId: 'marc' })),
    )
  })

  it('mais jamais au nom d’un collègue', async () => {
    const database = asPractitioner(env, 'marc')
    await assertFails(
      setDoc(doc(database, 'activities', 'neuve-usurpee'), activite({ facilitatorId: 'claire' })),
    )
  })

  it('ni sans animateur : elle n’appartiendrait à personne', async () => {
    await assertFails(setDoc(doc(asPractitioner(env, 'marc'), 'activities', 'neuve-orpheline'), activite()))
  })

  it('l’administrateur, lui, la confie à qui il veut — ou à personne', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(env), 'activities', 'neuve-claire'), activite({ facilitatorId: 'claire' })),
    )
    await assertSucceeds(setDoc(doc(asAdmin(env), 'activities', 'neuve-libre'), activite()))
  })

  it('un compte du personnel relié à personne n’en crée aucune', async () => {
    await assertFails(
      setDoc(doc(asStaff(env), 'activities', 'neuve-anonyme'), activite({ facilitatorId: 'marc' })),
    )
  })
})

describe('modifier une activité', () => {
  it('un intervenant modifie les siennes', async () => {
    const database = asPractitioner(env, 'marc')
    await assertSucceeds(
      updateDoc(doc(database, 'activities', 'chez-marc'), { ...activite({ facilitatorId: 'marc' }), title: 'Peinture' }),
    )
  })

  it('jamais celle d’un collègue', async () => {
    const database = asPractitioner(env, 'marc')
    await assertFails(
      updateDoc(doc(database, 'activities', 'chez-claire'), {
        ...activite({ facilitatorId: 'claire' }),
        title: 'Peinture',
      }),
    )
  })

  it('et surtout, ne se l’attribue pas au passage', async () => {
    const database = asPractitioner(env, 'marc')
    await assertFails(
      updateDoc(doc(database, 'activities', 'chez-claire'), {
        ...activite({ facilitatorId: 'marc' }),
      }),
    )
  })

  it('ne reprend pas non plus une activité que personne n’anime', async () => {
    // Elle relève de l'organisation du service : c'est l'administrateur qui l'attribue.
    const database = asPractitioner(env, 'marc')
    await assertFails(
      updateDoc(doc(database, 'activities', 'sans-personne'), { ...activite({ facilitatorId: 'marc' }) }),
    )
    await assertSucceeds(
      updateDoc(doc(asAdmin(env), 'activities', 'sans-personne'), { ...activite({ facilitatorId: 'marc' }) }),
    )
  })

  it('ne se retire pas des siennes en les donnant à un autre', async () => {
    const database = asPractitioner(env, 'marc')
    await assertFails(
      updateDoc(doc(database, 'activities', 'chez-marc'), { ...activite({ facilitatorId: 'claire' }) }),
    )
  })

  it('une activité ne se supprime jamais : elle se désactive', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(env), 'activities', 'chez-marc'), {
        ...activite({ facilitatorId: 'marc', isActive: false }),
      }),
    )
  })
})
