import { describe, expect, it } from 'vitest'
import { friendlyError } from './errors'
import {
  loginErrorCode,
  loginFailureMessage,
  loginFailureOf,
  resetMessage,
  resetOutcomeOf,
  type LoginFailure,
} from './connexion'
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

/**
 * Ce qu'on répond à quelqu'un qui n'arrive pas à entrer.
 *
 * Le code n'avait qu'une phrase pour tout : « L'adresse ou le mot de passe ne correspond
 * pas. » Constaté en service : quelqu'un qui était sûr de son mot de passe se l'est vue
 * répondre, sans aucun moyen de savoir que le problème était ailleurs. C'est la pire
 * chose qu'un écran de connexion puisse faire — envoyer chercher une clé qu'on a déjà
 * dans la poche.
 */
describe('pourquoi la connexion a échoué', () => {
  it('ne met sur le dos du mot de passe que ce qui en relève', () => {
    for (const code of [
      'auth/invalid-credential',
      'auth/wrong-password',
      'auth/user-not-found',
      'auth/invalid-email',
    ]) {
      expect(loginFailureOf(code)).toBe('identifiants')
    }
  })

  it('reconnaît le compte mis en pause après plusieurs essais', () => {
    // Le cas qui a mordu : après quelques tentatives, l'accès est bloqué quelques
    // minutes. Le dire évite de chercher une faute de frappe qui n'existe pas.
    expect(loginFailureOf('auth/too-many-requests')).toBe('trop-d-essais')
    expect(loginFailureMessage('trop-d-essais')).toContain('Attendez')
  })

  it('reconnaît le réseau, et le délai dépassé du projet', () => {
    expect(loginFailureOf('auth/network-request-failed')).toBe('reseau')
    expect(loginFailureOf('auth/timeout')).toBe('reseau')
  })

  it('reconnaît une méthode de connexion fermée dans la console', () => {
    // Tout le monde se voit alors refuser, et rien à l'écran ne permet de le deviner.
    expect(loginFailureOf('auth/operation-not-allowed')).toBe('methode-fermee')
  })

  it('avoue ne pas savoir plutôt que d’accuser quelqu’un', () => {
    expect(loginFailureOf('auth/quelque-chose-de-neuf')).toBe('panne')
    expect(loginFailureOf('')).toBe('panne')
    expect(loginFailureMessage('panne')).not.toContain('mot de passe')
  })

  it('ne dit jamais lequel des deux est faux', () => {
    /*
      Volontaire : le dire permettrait de deviner qui possède un compte ici, en essayant
      des adresses au hasard. C'est la seule chose que cet écran doit taire.
    */
    const dit = loginFailureMessage('identifiants')
    expect(dit).toContain('adresse')
    expect(dit).toContain('mot de passe')
    expect(dit).not.toMatch(/adresse (inconnue|introuvable)/i)
  })

  it('dit toujours quoi faire, dans tous les cas', () => {
    const causes: LoginFailure[] = [
      'identifiants',
      'trop-d-essais',
      'compte-desactive',
      'reseau',
      'methode-fermee',
      'panne',
    ]
    for (const cause of causes) {
      const dit = loginFailureMessage(cause)
      expect(dit.length).toBeGreaterThan(20)
      expect(dit).not.toContain('undefined')
      // Pas de jargon : ni « Firebase », ni « auth », ni un code d'erreur.
      expect(dit.toLowerCase()).not.toContain('firebase')
      expect(dit).not.toContain('auth/')
    }
  })

  it('lit le code porté par l’erreur, quelle qu’en soit la forme', () => {
    expect(loginErrorCode({ code: 'auth/too-many-requests' })).toBe('auth/too-many-requests')
    expect(loginErrorCode(new DelaiDepasse())).toBe('auth/timeout')
    expect(loginErrorCode(new Error('sans code'))).toBe('')
    expect(loginErrorCode(null)).toBe('')
    expect(loginErrorCode('une chaîne')).toBe('')
  })
})

/**
 * Redemander un mot de passe.
 *
 * Il n'y avait aucun moyen d'en sortir : un soignant qui oublie le sien était bloqué
 * dehors, et il fallait ouvrir la console Firebase pour lui. Pour cinquante personnes,
 * cela ne tient pas.
 */
describe('demander un nouveau mot de passe', () => {
  it('répond la même chose que le compte existe ou non', () => {
    /*
      La même discipline que l'écran de connexion : dire « cette adresse n'a pas de
      compte » permettrait d'apprendre, en essayant des adresses au hasard, qui travaille
      ici. C'est la seule chose que cet écran doit taire.
    */
    expect(resetOutcomeOf('')).toBe('envoye')
    expect(resetOutcomeOf('auth/user-not-found')).toBe('envoye')
    expect(resetMessage('envoye')).toContain('Si cette adresse a un compte')
  })

  it('dit ce qui appelle un geste', () => {
    expect(resetOutcomeOf('auth/invalid-email')).toBe('adresse-invalide')
    expect(resetOutcomeOf('auth/too-many-requests')).toBe('trop-d-essais')
    expect(resetOutcomeOf('auth/quelque-chose')).toBe('panne')
  })

  it('pense aux courriers indésirables : c’est là qu’il finit une fois sur deux', () => {
    expect(resetMessage('envoye')).toContain('indésirables')
  })

  it('ne laisse passer ni jargon ni code d’erreur', () => {
    for (const cause of ['envoye', 'adresse-invalide', 'trop-d-essais', 'panne'] as const) {
      const dit = resetMessage(cause)
      expect(dit.toLowerCase()).not.toContain('firebase')
      expect(dit).not.toContain('auth/')
      expect(dit).not.toContain('undefined')
    }
  })
})
