import { describe, expect, it } from 'vitest'
import { RECHARGER, needsReload, friendlyError, HORS_LIGNE, PANNE } from './errors'

describe('traduire une panne', () => {
  it('nomme la coupure de réseau avant tout : c’est la cause la plus fréquente', () => {
    expect(friendlyError('internal', false)).toBe(HORS_LIGNE)
    expect(friendlyError('Ce code n’est pas reconnu.', false)).toBe(HORS_LIGNE)
  })

  it('remplace « internal » par une phrase qui dit quoi faire', () => {
    expect(friendlyError('internal', true)).toBe(PANNE)
    expect(friendlyError('functions/internal: internal', true)).toBe(PANNE)
    expect(friendlyError('unavailable', true)).toBe(PANNE)
  })

  it('laisse passer les messages du projet, qui sont déjà en français', () => {
    const dit = "Cette action est réservée à l'administrateur."
    expect(friendlyError(`FirebaseError: ${dit}`, true)).toBe(dit)
    expect(friendlyError(dit, true)).toBe(dit)
  })

  it('remplace aussi le vide, qui n’apprend rien non plus', () => {
    expect(friendlyError('', true)).toBe(PANNE)
    expect(friendlyError('   ', true)).toBe(PANNE)
  })

  it('dit toujours quoi faire, jamais seulement ce qui ne va pas', () => {
    expect(HORS_LIGNE).toMatch(/Vérifiez/)
    expect(PANNE).toMatch(/Réessayez/)
  })
})

/**
 * Un morceau de l'application qui n'a pas pu se charger.
 *
 * Vérifié dans un navigateur : le navigateur **retient** l'échec d'un module. Redemander
 * le même fragment ne repart pas sur le réseau — une seule requête part, quel que soit le
 * nombre d'essais. Dire « réessayez » est donc une promesse en l'air ; seul un
 * rechargement de la page remet le compteur à zéro.
 */
describe('un fragment qui manque', () => {
  const chrome =
    'Failed to fetch dynamically imported module: https://leuze-d23b5.web.app/assets/staffRepository-58sL4eMn.js'
  const safari = 'Importing a module script failed.'
  const firefox = 'error loading dynamically imported module'

  it('se reconnaît quel que soit le navigateur', () => {
    for (const brut of [chrome, safari, firefox]) expect(needsReload(brut)).toBe(true)
  })

  it('ne se déclenche pas sur une panne ordinaire', () => {
    expect(needsReload('internal')).toBe(false)
    expect(needsReload("Cette activité est complète.")).toBe(false)
    expect(needsReload('')).toBe(false)
  })

  it('demande de recharger, et ne montre jamais l’adresse du fichier', () => {
    /*
      La découpe sur le deux-points ne laissait que l'adresse du fichier — et c'est
      exactement ce qu'on lisait à l'écran : « ⚠️ https://…/assets/staffRepository-….js ».
    */
    const dit = friendlyError(chrome, true)
    expect(dit).toBe(RECHARGER)
    expect(dit).not.toContain('http')
    expect(dit).not.toContain('.js')
    expect(dit).toContain('Rechargez')
  })

  it('passe avant « hors ligne » : le réseau n’y changera rien', () => {
    // Le réseau est peut-être revenu ; le navigateur a retenu l'échec de toute façon.
    // Envoyer vérifier la connexion ferait tourner en rond.
    expect(friendlyError(chrome, false)).toBe(RECHARGER)
  })
})
