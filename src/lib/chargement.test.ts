import { describe, expect, it, vi } from 'vitest'
import { chargeurRessayable } from './chargement'

/**
 * Une promesse rejetée reste rejetée.
 *
 * C'est la règle de JavaScript, et c'est elle qui a coûté une matinée : l'adapter de
 * données était gardé dans un champ, et un chargement raté condamnait l'application
 * jusqu'au rechargement de la page. Chaque nouvel essai retombait sur la même promesse,
 * à l'instant, sans rien retenter — pendant que l'écran invitait à réessayer.
 */
describe('le chargement de l’adapter', () => {
  it('ne charge qu’une fois quand tout va bien', async () => {
    const demarrer = vi.fn(async () => 'adapter')
    const charger = chargeurRessayable(demarrer)
    expect(await charger()).toBe('adapter')
    expect(await charger()).toBe('adapter')
    expect(await charger()).toBe('adapter')
    expect(demarrer).toHaveBeenCalledTimes(1)
  })

  it('commence à charger sans attendre qu’on le demande', () => {
    // Le fragment se télécharge pendant que la page s'affiche : le premier geste ne
    // paie pas l'attente. C'est ce que faisait le champ d'origine.
    const demarrer = vi.fn(async () => 'adapter')
    chargeurRessayable(demarrer)
    expect(demarrer).toHaveBeenCalledTimes(1)
  })

  it('retente après un échec, au lieu de s’y enfermer', async () => {
    let essais = 0
    const charger = chargeurRessayable(async () => {
      essais += 1
      if (essais < 3) throw new Error('réseau coupé')
      return 'adapter'
    })

    await expect(charger()).rejects.toThrow('réseau coupé')
    await expect(charger()).rejects.toThrow('réseau coupé')
    // Le troisième aboutit : c'est ce que « réessayez » promettait à l'écran.
    expect(await charger()).toBe('adapter')
    expect(essais).toBe(3)
  })

  it('garde le résultat une fois qu’il est arrivé, même après des échecs', async () => {
    let essais = 0
    const charger = chargeurRessayable(async () => {
      essais += 1
      if (essais === 1) throw new Error('coupure')
      return `adapter-${essais}`
    })

    await expect(charger()).rejects.toThrow('coupure')
    expect(await charger()).toBe('adapter-2')
    expect(await charger()).toBe('adapter-2')
    // Deux tentatives en tout : celle qui a raté, et celle qui a réussi.
    expect(essais).toBe(2)
  })

  it('ne lance pas deux chargements pour deux appels simultanés', async () => {
    const demarrer = vi.fn(
      () => new Promise<string>((r) => setTimeout(() => r('adapter'), 10)),
    )
    const charger = chargeurRessayable(demarrer)
    const [a, b] = await Promise.all([charger(), charger()])
    expect(a).toBe('adapter')
    expect(b).toBe('adapter')
    expect(demarrer).toHaveBeenCalledTimes(1)
  })
})
