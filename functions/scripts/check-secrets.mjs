/**
 * Un secret n'est pas lisible d'office : il faut le déclarer sur chaque fonction qui
 * en a besoin. L'oubli ne se voit ni à la compilation, ni sur l'émulateur — qui se
 * rabat sur un poivre de développement — mais seulement en production, sous la forme
 * d'un « INTERNAL » sans explication. D'où cette vérification.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const racine = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(racine, 'src/index.ts'), 'utf8')

// Ce qui rend une fonction dépendante du poivre, et la déclaration qui doit l'accompagner.
const USAGE = /\bhashCode\s*\(/
const DECLARATION = 'secrets: [CODE_PEPPER]'

const blocs = source.split(/^export const /m).slice(1)
const manquants = blocs
  .filter((bloc) => USAGE.test(bloc) && !bloc.includes(DECLARATION))
  .map((bloc) => bloc.slice(0, bloc.indexOf(' ')))

if (manquants.length > 0) {
  console.error('Ces fonctions dérivent un code patient sans déclarer le secret CODE_PEPPER :')
  for (const nom of manquants) console.error(`  ${nom}`)
  console.error(`Ajoutez « onCall({ ${DECLARATION} }, … ) ».`)
  process.exit(1)
}

console.log(`Secrets déclarés : ${blocs.filter((b) => b.includes(DECLARATION)).length} fonction(s).`)
