import { describe, expect, it } from 'vitest'
import { friendlyError, HORS_LIGNE, PANNE } from './errors'

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
