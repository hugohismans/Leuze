import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAZUREL, asAdmin, asPatient, asPractitioner, asStaff, createEnvironment } from './helpers'

/**
 * Les idées d'activité déposées par les patients.
 *
 * Une idée porte un texte libre et le prénom de qui l'a écrite. Deux invariants, et ce
 * fichier ne vérifie qu'eux :
 *
 *   1. **Chacun ne lit que les siennes.** Laisser un patient lire celles des autres
 *      reviendrait à publier qui demande quoi — et le texte libre y est plus révélateur
 *      qu'un titre d'activité.
 *   2. **Aucune écriture cliente, par personne.** Déposer et répondre passent par des
 *      fonctions appelables, qui seules peuvent garantir la longueur des textes et la
 *      règle « une seule idée en attente ». Un navigateur qui écrirait ici pourrait
 *      déposer dix mille caractères, ou dix idées d'affilée.
 */

let env: RulesTestEnvironment

const idee = (overrides: Record<string, unknown> = {}) => ({
  patientUid: 'p_camille',
  patientFirstName: 'Camille',
  serviceId: MAZUREL,
  title: 'Tournoi d’échecs',
  description: 'On jouerait aux échecs, j’apprendrais les règles à ceux qui ne savent pas.',
  wantsToLead: true,
  status: 'proposed',
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
    await setDoc(doc(database, 'proposals', 'idee-de-camille'), idee())
    await setDoc(
      doc(database, 'proposals', 'idee-de-bernard'),
      idee({ patientUid: 'p_bernard', patientFirstName: 'Bernard', title: 'Atelier tricot' }),
    )
  })
})

describe('lire les idées', () => {
  it('un patient lit la sienne', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertSucceeds(getDoc(doc(database, 'proposals', 'idee-de-camille')))
  })

  it('un patient ne lit pas celle de quelqu’un d’autre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(getDoc(doc(database, 'proposals', 'idee-de-bernard')))
  })

  it('un patient obtient les siennes en le demandant explicitement', async () => {
    /*
      Firestore valide la REQUÊTE, pas le résultat : c'est le filtre qui rend la lecture
      permise, et l'écran doit donc le poser. Ce test tient ce contrat — s'il tombe, la
      page « Proposer une activité » n'affichera plus rien du tout.
    */
    const database = asPatient(env, 'p_camille', MAZUREL)
    const miennes = query(collection(database, 'proposals'), where('patientUid', '==', 'p_camille'))
    const snapshot = await assertSucceeds(getDocs(miennes))
    expect(snapshot.size).toBe(1)
  })

  it('ne peut pas demander celles d’un autre en changeant le filtre', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(
      getDocs(query(collection(database, 'proposals'), where('patientUid', '==', 'p_bernard'))),
    )
  })

  it('un patient ne peut pas demander toute la liste', async () => {
    // Le refus doit valoir aussi pour la requête large : sans cela, il suffirait de ne
    // pas filtrer pour tout obtenir.
    await assertFails(getDocs(collection(asPatient(env, 'p_camille', MAZUREL), 'proposals')))
  })

  it('l’administrateur les lit toutes : c’est lui qui répond', async () => {
    const snapshot = await assertSucceeds(getDocs(collection(asAdmin(env), 'proposals')))
    expect(snapshot.size).toBe(2)
  })

  it('un soignant ordinaire n’y a pas accès', async () => {
    await assertFails(getDocs(collection(asStaff(env), 'proposals')))
    await assertFails(getDoc(doc(asPractitioner(env, 'marc'), 'proposals', 'idee-de-camille')))
  })
})

describe('écrire une idée', () => {
  it('un patient ne dépose pas directement : tout passe par une fonction', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(setDoc(doc(database, 'proposals', 'la-mienne'), idee()))
  })

  it('un patient ne modifie pas la sienne une fois déposée', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(updateDoc(doc(database, 'proposals', 'idee-de-camille'), { title: 'Autre chose' }))
  })

  it('un patient ne répond pas à sa propre idée', async () => {
    const database = asPatient(env, 'p_camille', MAZUREL)
    await assertFails(updateDoc(doc(database, 'proposals', 'idee-de-camille'), { status: 'accepted' }))
  })

  it('l’administrateur non plus n’écrit pas directement', async () => {
    // Répondre passe par une fonction appelable : elle seule sait exiger un motif de
    // refus, et une réponse sans motif décourage plus que le refus lui-même.
    await assertFails(
      updateDoc(doc(asAdmin(env), 'proposals', 'idee-de-camille'), { status: 'declined' }),
    )
  })

  it('un soignant ordinaire non plus', async () => {
    await assertFails(updateDoc(doc(asStaff(env), 'proposals', 'idee-de-camille'), { status: 'accepted' }))
  })
})
