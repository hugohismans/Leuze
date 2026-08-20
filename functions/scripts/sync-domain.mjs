/**
 * Recopie `src/lib/domain/` dans `functions/src/domain/`.
 *
 * Pourquoi une copie : Firebase ne téléverse que le dossier `functions/`. Le code du
 * domaine — récurrence, capacité, liste d'attente, audience — doit donc y être
 * physiquement présent, alors qu'il fait autorité dans `src/lib/domain/`.
 * La copie est régénérée à chaque build ; `--check` échoue si elle a divergé.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const lib = join(here, '..', '..', 'src', 'lib')
const source = join(lib, 'domain')
const target = join(here, '..', 'src', 'domain')
// `capacity.ts` lit les réglages produit : ils suivent, à la même place relative.
const configSource = join(lib, 'config.ts')
const configTarget = join(here, '..', 'src', 'config.ts')
const check = process.argv.includes('--check')

const banner = (path) =>
  `// ⚠️ Fichier copié depuis src/lib/${path} — ne pas modifier ici.\n` +
  `// Régénéré par « npm run sync:domain » dans functions/.\n\n`

const files = readdirSync(source)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fixtures.ts')
  .sort()

if (!check) {
  if (existsSync(target)) rmSync(target, { recursive: true })
  mkdirSync(target, { recursive: true })
}

const stale = []
const copies = [
  ...files.map((name) => ({ from: join(source, name), to: join(target, name), label: `domain/${name}` })),
  { from: configSource, to: configTarget, label: 'config.ts' },
]

for (const { from, to, label } of copies) {
  const content = banner(label) + readFileSync(from, 'utf8')
  const name = label
  const destination = to
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, 'utf8') !== content) stale.push(name)
  } else {
    writeFileSync(destination, content)
  }
}

if (check && stale.length > 0) {
  console.error(
    `Le domaine copié dans functions/src/domain a divergé : ${stale.join(', ')}.\n` +
      `Lancez « npm --prefix functions run sync:domain ».`,
  )
  process.exit(1)
}

console.log(check ? 'Domaine à jour.' : `Domaine copié : ${copies.length} fichiers.`)
