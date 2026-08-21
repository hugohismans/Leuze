import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  MAZUREL,
  activityDoc,
  asAdmin,
  asPatient,
  asPractitioner,
  asStaff,
  createEnvironment,
} from './helpers'

/**
 * Le catalogue : lieux, catégories, services. Les soignants les paramètrent,
 * les activités sont réservées au personnel, et rien n'est supprimé physiquement.
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
    await setDoc(doc(database, 'services', MAZUREL), { name: 'Le Mazurel', isActive: true })
    await setDoc(doc(database, 'locations', 'atelier'), { name: "L'atelier créatif", isActive: true })
    await setDoc(doc(database, 'categories', 'creatif'), { name: 'Créatif', icon: '🎨', colorToken: 'creatif' })
    await setDoc(doc(database, 'activities', 'activite-1'), activityDoc())
    await setDoc(doc(database, 'staff', 'soignant-1'), { firstName: 'Marc', role: 'staff', isActive: true })
    await setDoc(doc(database, 'staff', 'soignant-2'), { firstName: 'Claire', role: 'staff', isActive: true })
    await setDoc(doc(database, 'config', 'app'), { retentionDays: 90 })
  })
})

describe('lieux, catégories et services', () => {
  it('sont lisibles par toute personne connectée', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertSucceeds(getDocs(collection(database, 'locations')))
    await assertSucceeds(getDocs(collection(database, 'categories')))
    await assertSucceeds(getDocs(collection(database, 'services')))
  })

  it('ne sont modifiables que par l’administrateur', async () => {
    await assertFails(setDoc(doc(asPatient(env, 'p_1', MAZUREL), 'locations', 'jardin'), { name: 'Le jardin' }))
    await assertFails(setDoc(doc(asStaff(env), 'locations', 'jardin'), { name: 'Le jardin' }))
    await assertSucceeds(
      setDoc(doc(asAdmin(env), 'locations', 'jardin'), { name: 'Le jardin', isActive: true }),
    )
  })

  it('laissent l’administrateur ajouter un service, sans passer par le code', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(env), 'services', 'nouveau-service'), { name: 'Service culturel', isActive: true }),
    )
  })
})

describe('activités', () => {
  it('ne sont pas lisibles par un patient : tout ce qu’il voit est sur l’occurrence', async () => {
    const database = asPatient(env, 'p_1', MAZUREL)
    await assertFails(getDoc(doc(database, 'activities', 'activite-1')))
    await assertFails(getDocs(collection(database, 'activities')))
  })

  // Qui a le droit d'en créer et d'en modifier — et au nom de qui — est vérifié dans
  // `activites.test.ts`. Ici, on ne regarde que la forme du document.
  it('sont créées et modifiées par l’administrateur', async () => {
    const database = asAdmin(env)
    await assertSucceeds(setDoc(doc(database, 'activities', 'activite-2'), activityDoc({ title: 'Marche' })))
    await assertSucceeds(updateDoc(doc(database, 'activities', 'activite-1'), { title: 'Atelier peinture' }))
  })

  it('refusent une audience incohérente : « tous les services » avec une liste de services', async () => {
    const database = asStaff(env)
    await assertFails(
      setDoc(doc(database, 'activities', 'activite-3'), activityDoc({ audience: 'all', serviceIds: [MAZUREL] })),
    )
  })

  it('acceptent une réservation à plusieurs services', async () => {
    const database = asAdmin(env)
    await assertSucceeds(
      setDoc(
        doc(database, 'activities', 'activite-4'),
        activityDoc({ audience: 'services', serviceIds: [MAZUREL, 'la-joncquerelle'] }),
      ),
    )
  })

  it('refusent un titre vide ou une capacité négative', async () => {
    const database = asStaff(env)
    await assertFails(setDoc(doc(database, 'activities', 'activite-5'), activityDoc({ title: '' })))
    await assertFails(setDoc(doc(database, 'activities', 'activite-6'), activityDoc({ capacity: -1 })))
  })

  it('ne se suppriment jamais : une activité se désactive', async () => {
    const database = asAdmin(env)
    await assertFails(deleteDoc(doc(database, 'activities', 'activite-1')))
    await assertSucceeds(updateDoc(doc(database, 'activities', 'activite-1'), { isActive: false }))
  })
})

describe('comptes du personnel', () => {
  it('laissent un soignant lire sa propre fiche, pas celle des autres', async () => {
    const database = asStaff(env, 'soignant-1')
    await assertSucceeds(getDoc(doc(database, 'staff', 'soignant-1')))
    await assertFails(getDoc(doc(database, 'staff', 'soignant-2')))
  })

  it('laissent l’administrateur voir la liste', async () => {
    await assertSucceeds(getDocs(collection(asAdmin(env), 'staff')))
    await assertFails(getDocs(collection(asStaff(env), 'staff')))
  })

  it('refusent qu’un soignant s’attribue un rôle', async () => {
    // Le rôle qui fait autorité est le « custom claim », posé par une Cloud Function.
    await assertFails(setDoc(doc(asStaff(env), 'staff', 'soignant-1'), { role: 'admin' }))
    await assertFails(setDoc(doc(asAdmin(env), 'staff', 'soignant-1'), { role: 'admin' }))
  })
})

describe('réglages de l’application', () => {
  it('sont lisibles par tous et modifiables par l’administrateur seul', async () => {
    await assertSucceeds(getDoc(doc(asPatient(env, 'p_1', MAZUREL), 'config', 'app')))
    await assertFails(updateDoc(doc(asStaff(env), 'config', 'app'), { retentionDays: 3650 }))
    await assertSucceeds(updateDoc(doc(asAdmin(env), 'config', 'app'), { retentionDays: 30 }))
  })
})

describe('disponibilités d’un intervenant', () => {
  const plages = [{ weekday: 2, from: '09:00', to: '12:00' }]

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'practitioners', 'docteur-lemaire'), {
        name: 'Docteur Lemaire',
        role: 'Psychiatre',
        isActive: true,
      })
    })
  })

  it('se tiennent à jour par la personne elle-même : elle seule sait quand elle est là', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertSucceeds(
      updateDoc(doc(database, 'practitioners', 'docteur-lemaire'), { availability: plages }),
    )
  })

  it('mais pas celles d’un collègue', async () => {
    const database = asPractitioner(env, 'claire')
    await assertFails(
      updateDoc(doc(database, 'practitioners', 'docteur-lemaire'), { availability: plages }),
    )
  })

  it('et rien d’autre de sa fiche au passage', async () => {
    const database = asPractitioner(env, 'docteur-lemaire')
    await assertFails(
      updateDoc(doc(database, 'practitioners', 'docteur-lemaire'), {
        availability: plages,
        role: 'Directeur',
      }),
    )
    await assertFails(
      updateDoc(doc(database, 'practitioners', 'docteur-lemaire'), { isActive: false }),
    )
  })

  it('un compte relié à personne n’en écrit aucune', async () => {
    await assertFails(
      updateDoc(doc(asStaff(env), 'practitioners', 'docteur-lemaire'), { availability: plages }),
    )
  })

  it('l’administrateur, lui, tient la fiche entière', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(env), 'practitioners', 'docteur-lemaire'), {
        availability: plages,
        role: 'Psychiatre référent',
      }),
    )
  })
})
