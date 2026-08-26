import { describe, expect, it } from 'vitest'
import { friendlyError } from './errors'
import { DelaiDepasse, avecDelai, DELAI_ECRITURE, DELAI_LECTURE } from '../data/firestore/reseau'

/**
 * Le bouton de connexion doit toujours revenir.
 *
 * Symptôme constaté en service, sur un téléphone : « Un instant… » qui ne s'en va plus,
 * sans message et sans issue. La personne devant cet écran n'a encore rien vu de
 * l'application — elle en conclut que son code ne marche pas, et repart chercher un
 * soignant pour rien.
 *
 * Deux causes, et il fallait les deux pour que cela arrive :
 *
 * — l'authentification n'avait aucune limite de temps. `reseau.ts` bornait les lectures
 *   Firestore et les fonctions appelables, mais pas la connexion, qui traverse pourtant
 *   le même réseau. Sur un téléphone qui bascule du wifi à la 5G, l'appel n'échoue pas :
 *   il attend, indéfiniment ;
 * — et l'écran remettait son bouton en état **après** l'attente, hors de tout `finally` :
 *   une promesse rejetée ne l'atteignait jamais.
 */

describe('une connexion qui n’aboutit pas finit quand même', () => {
  it('rend la main au bout du délai, plutôt que d’attendre sans fin', async () => {
    // Une promesse qui ne se résout jamais : c'est exactement ce que fait la
    // bibliothèque d'authentification quand le réseau se dérobe.
    const jamais = new Promise<never>(() => {})
    await expect(avecDelai(jamais, 20)).rejects.toBeInstanceOf(DelaiDepasse)
  })

  it('laisse passer une connexion lente mais qui arrive', async () => {
    const lente = new Promise((r) => setTimeout(() => r('jeton'), 10))
    await expect(avecDelai(lente, 200)).resolves.toBe('jeton')
  })

  it('laisse à la connexion le délai long, pas celui d’une lecture', () => {
    /*
      Une fonction appelable qui n'a pas tourné depuis un quart d'heure démarre à froid,
      et cela prend une dizaine de secondes. Le code du patient passe par là : lui donner
      le délai d'une lecture le ferait échouer précisément le matin, au premier usage.
    */
    expect(DELAI_ECRITURE).toBeGreaterThan(DELAI_LECTURE)
    expect(DELAI_ECRITURE).toBeGreaterThanOrEqual(20_000)
  })

  it('dit quoi faire, et jamais « undefined »', () => {
    // Le message du délai dépassé doit se lire tel quel : c'est celui que l'écran affiche.
    const message = new DelaiDepasse().message
    expect(friendlyError(message, true)).toBe(message)
    expect(message).toContain('réessayez')
    expect(message).not.toContain('undefined')
  })

  it('parle de la connexion coupée quand c’est l’appareil qui n’a plus de réseau', () => {
    const dit = friendlyError(new DelaiDepasse().message, false)
    expect(dit).not.toBe('')
    expect(dit.toLowerCase()).toContain('connexion')
  })
})
