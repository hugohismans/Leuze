/**
 * Ce que l'adapter Firestore promet d'envoyer au serveur.
 *
 * Un défaut est passé par ici, et il n'était visible qu'en production. `register`
 * déclarait un seul paramètre — l'identifiant de la séance — alors que le port en
 * annonce deux, et que le serveur lit bien le second. « Je viens seulement regarder »
 * repartait donc en inscription ordinaire : on prenait une place sans le savoir, et
 * changer d'avis se faisait répondre « Vous êtes déjà inscrit à cette activité ».
 *
 * Ni `tsc` ni `svelte-check` ne peuvent le voir : en TypeScript, une fonction qui prend
 * **moins** de paramètres reste assignable à un type qui en déclare plus. C'est correct —
 * et c'est précisément le trou par lequel une option se perd en silence.
 *
 * L'adapter de démonstration, lui, honorait l'option. Les deux adapters se comportaient
 * donc différemment, et c'est celui qu'on ne peut pas essayer chez soi qui était faux.
 * D'où ce test, qui lit les signatures plutôt que d'exécuter quoi que ce soit : ouvrir un
 * vrai Firestore pour vérifier qu'un argument est déclaré coûterait mille fois plus cher.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ICI = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(ICI, 'firestoreRepository.ts'), 'utf8')

/** Le corps de la méthode nommée, jusqu'à sa parenthèse fermante de signature. */
function signature(nom: string): string {
  const marque = `async ${nom}(`
  const debut = source.indexOf(marque)
  expect(debut, `méthode « ${nom} » introuvable`).toBeGreaterThan(-1)
  let profondeur = 0
  let i = debut + marque.length - 1
  while (true) {
    if (source[i] === '(') profondeur += 1
    else if (source[i] === ')') {
      profondeur -= 1
      if (profondeur === 0) return source.slice(debut, i + 1)
    }
    i += 1
  }
}

describe('les options du port arrivent jusqu’au serveur', () => {
  it('register accepte « as » et « replacing »', () => {
    const sig = signature('register')
    expect(sig, 'le genre d’inscription doit être accepté').toContain('as?:')
    expect(sig, 'les séances à quitter doivent être acceptées').toContain('replacing?:')
  })

  it('register transmet les deux au serveur, et non le seul identifiant', () => {
    const appel = source.slice(source.indexOf("async register("))
    const charge = appel.slice(appel.indexOf("'register',"), appel.indexOf('"L\'inscription'))
    expect(charge, 'le genre doit figurer dans ce qui part').toContain('options.as')
    expect(charge, 'les séances à quitter doivent figurer dans ce qui part').toContain(
      'options.replacing',
    )
  })
})
