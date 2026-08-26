/**
 * La limite de temps, et ce qu'elle garantit.
 *
 * Ce fichier existe pour une panne constatée : « Chargement… » qui ne s'en va plus sur
 * l'écran soignant, puis qui se débloque tout seul quelques minutes plus tard. Firestore
 * ne rend jamais la main quand la connexion tombe — il attend, en réessayant en silence.
 * Une lecture sans limite de temps est donc une promesse qui peut ne jamais se tenir, et
 * un écran qui l'attend est un écran figé.
 */
import { describe, expect, it, vi } from 'vitest'
import { avecDelai, DelaiDepasse, DELAI_LECTURE, lire } from './reseau'

describe('avecDelai', () => {
  it('rend le résultat quand il arrive à temps', async () => {
    await expect(avecDelai(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('renonce quand rien ne vient, plutôt que d’attendre pour toujours', async () => {
    vi.useFakeTimers()
    const jamais = new Promise<string>(() => {})
    const course = avecDelai(jamais, 1_000)
    const attendu = expect(course).rejects.toBeInstanceOf(DelaiDepasse)
    await vi.advanceTimersByTimeAsync(1_000)
    await attendu
    vi.useRealTimers()
  })

  it('dit quoi faire, et non « erreur »', () => {
    expect(new DelaiDepasse().message).toContain('Vérifiez la connexion')
  })

  it('laisse passer une erreur d’origine telle quelle', async () => {
    const refus = new Error('permission-denied')
    await expect(avecDelai(Promise.reject(refus), 50)).rejects.toBe(refus)
  })

  it('n’attend pas indéfiniment une lecture', async () => {
    vi.useFakeTimers()
    const jamais = new Promise<string>(() => {})
    const course = lire(jamais)
    const attendu = expect(course).rejects.toBeInstanceOf(DelaiDepasse)
    await vi.advanceTimersByTimeAsync(DELAI_LECTURE)
    await attendu
    vi.useRealTimers()
  })
})
