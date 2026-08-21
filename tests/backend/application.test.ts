import { describe, expect, it } from 'vitest'
import { initializeApp } from 'firebase-admin/app'
import { auth, COLLECTIONS, db } from '../../functions/src/lib/firestore'

/**
 * Reproduit ce que fait le SDK des fonctions dès qu'un appel est authentifié : pour
 * vérifier le jeton, il initialise sa propre application, sous un nom à lui. `getApps()`
 * cesse alors d'être vide sans que l'application *par défaut* existe pour autant.
 *
 * Toutes les fonctions appelées par une personne connectée échouaient là-dessus, en
 * production seulement — « The default Firebase app does not exist » — tandis que les
 * appels anonymes passaient. Les tests ne le voyaient pas : rien n'y crée d'application
 * nommée. D'où celui-ci.
 */
describe('l’application d’administration', () => {
  it('existe même quand une application nommée a déjà été créée', async () => {
    initializeApp({ projectId: 'demo-leuze' }, '__FIREBASE_FUNCTIONS_SDK__')

    const config = await db().collection(COLLECTIONS.config).doc('app').get()
    expect(config).toBeDefined()
    expect(() => auth()).not.toThrow()
  })
})
