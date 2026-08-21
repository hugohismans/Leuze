/**
 * Prépare un **vrai** projet Firebase : services, lieux, catégories, motifs de
 * rendez-vous et réglages. Rien d'autre.
 *
 * Ce script n'écrit **aucune** donnée de démonstration : ni activité fictive, ni
 * patient, ni compte. C'est ce qui le distingue de `npm run seed`, réservé à
 * l'émulateur. Les valeurs posées ici sont ensuite modifiables dans l'écran
 * « Le catalogue », sans repasser par le code.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=cle.json npm run init:catalogue -- --confirmer
 *
 * Sans `--confirmer`, il affiche ce qu'il ferait et s'arrête.
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { config } from '../src/lib/config'
import { firebaseOptions } from '../src/lib/data/firestore/options'
import { appointmentKindsSeed } from '../src/lib/data/seed/appointmentKinds.seed'
import { categoriesSeed } from '../src/lib/data/seed/categories.seed'
import { locationsSeed } from '../src/lib/data/seed/locations.seed'
import { servicesSeed } from '../src/lib/data/seed/services.seed'

const projectId = process.env.GCLOUD_PROJECT ?? firebaseOptions.projectId
const confirme = process.argv.includes('--confirmer')
const surEmulateur = process.env.FIRESTORE_EMULATOR_HOST !== undefined

const tables = [
  { nom: 'services', lignes: servicesSeed },
  { nom: 'locations', lignes: locationsSeed },
  { nom: 'categories', lignes: categoriesSeed },
  { nom: 'appointmentKinds', lignes: appointmentKindsSeed },
]

async function main(): Promise<void> {
  console.log(`Projet : ${projectId}${surEmulateur ? ' (émulateur)' : ''}`)
  for (const { nom, lignes } of tables) console.log(`  ${nom} : ${lignes.length} entrées`)
  console.log('  config/app : durée de conservation, validité des codes')

  if (!confirme) {
    console.log('\nRien n’a été écrit. Relancez avec « -- --confirmer » pour appliquer.')
    return
  }

  const db = getFirestore(initializeApp({ projectId }))
  db.settings({ ignoreUndefinedProperties: true })

  for (const { nom, lignes } of tables) {
    const batch = db.batch()
    // `merge` : relancer le script ne réécrit pas ce qu'un soignant a modifié depuis,
    // sauf pour les champs présents dans le seed.
    for (const { id, ...reste } of lignes) batch.set(db.collection(nom).doc(id), reste, { merge: true })
    await batch.commit()
    console.log(`  ${nom} : écrit`)
  }

  await db.collection('config').doc('app').set(
    {
      retentionDays: config.retentionDays,
      codeValidityDays: 60,
      generationWindowWeeks: config.generationWindowWeeks,
      planZones: {},
    },
    { merge: true },
  )
  console.log('  config/app : écrit')
  console.log('\nTerminé. Créez ensuite le premier administrateur : npm run promote:admin -- <adresse>')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
