/**
 * Toute lecture Firestore passe par `lire`.
 *
 * Une règle qu'on ne peut pas tenir de tête : il y a vingt lectures réparties dans deux
 * fichiers, et il suffit d'en ajouter une vingt-et-unième sans y penser pour ramener la
 * panne. Elle s'est déjà produite ainsi — `reseau.ts` avait été écrit pour la connexion,
 * puis jamais posé sur les lectures, et l'écran soignant est resté sur « Chargement… »
 * jusqu'au retour du réseau.
 *
 * Le test lit le code source. C'est inhabituel, et c'est ici le seul endroit d'où l'on
 * peut voir la règle dans son ensemble : aucun test de comportement ne dirait « il en
 * manque une », puisque celle qui manque se comporte normalement tant que le réseau
 * tient.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ICI = dirname(fileURLToPath(import.meta.url))
const FICHIERS = ['staffRepository.ts', 'firestoreRepository.ts']

describe('les lectures Firestore ont toutes une limite de temps', () => {
  for (const nom of FICHIERS) {
    it(nom, () => {
      const source = readFileSync(resolve(ICI, nom), 'utf8')
      const nues = [...source.matchAll(/await (getDocs|getDoc)\(/g)]
      expect(
        nues.map((m) => `ligne ${source.slice(0, m.index).split('\n').length} : ${m[0]}`),
        'à envelopper dans « lire(...) », voir reseau.ts',
      ).toEqual([])
      // Et le filet est bien posé, plutôt que le fichier vidé de ses lectures.
      expect(source.match(/await lire\((getDocs|getDoc)\(|await lire\(\s*\n\s*(getDocs|getDoc)\(/g))
        .not.toBeNull()
    })
  }
})
