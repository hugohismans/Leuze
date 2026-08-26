/**
 * Écrire le jour de la séance sur les inscriptions qui ne l'ont pas.
 *
 * Depuis peu, chaque inscription porte `localDate` — le jour de sa séance, recopié. Ce
 * champ permet de demander « qu'a cette personne ce mardi ? » sans lire **toutes** ses
 * inscriptions depuis son admission. Sans lui, chaque ouverture de l'application et
 * chaque prénom cliqué en réunion coûtaient une centaine de lectures pour en garder
 * trois : c'était, de loin, la plus grosse dépense du projet.
 *
 * Les inscriptions écrites avant ne l'ont pas. Tant qu'il en reste une seule, le serveur
 * continue de tout relire — une requête filtrée les écarterait en silence, et l'on
 * manquerait des chevauchements. Un chevauchement manqué est bien pire qu'une lecture de
 * trop.
 *
 * Ce script les complète, puis pose le drapeau qui autorise le serveur à passer aux
 * requêtes filtrées. La date ne se devine pas : elle se **lit** dans l'identifiant de la
 * séance, qui est déterministe (`{activityId}_{yyyyMMdd}T{HHmm}`). Aucune approximation,
 * donc, et rien d'autre n'est touché.
 *
 *   npm run dater:inscriptions                 — dit ce qui manque, sans rien écrire
 *   npm run dater:inscriptions -- --corriger   — écrit les dates, puis pose le drapeau
 *
 * Depuis Cloud Shell, où l'identité Google est déjà présente :
 *
 *   npm install
 *   gcloud config set project leuze-d23b5
 *   npm run dater:inscriptions -- --corriger
 *
 * Il peut être relancé sans risque : il ne touche que ce qui manque.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { firebaseOptions } from '../src/lib/data/firestore/options'
import { localDateOfOccurrenceId } from '../src/lib/domain/conflicts'

const args = process.argv.slice(2)
const corriger = args.includes('--corriger')
const PROJET =
  args.find((a) => a.startsWith('--projet='))?.split('=')[1] ??
  process.env.GCLOUD_PROJECT ??
  firebaseOptions.projectId

initializeApp({ credential: applicationDefault(), projectId: PROJET })
const db = getFirestore()

async function main(): Promise<void> {
  console.log(`Projet : ${PROJET}`)
  console.log(corriger ? 'Mode : correction.' : 'Mode : lecture seule. Ajoutez --corriger pour écrire.')

  const inscriptions = await db.collection('registrations').get()
  console.log(`${inscriptions.size} inscription(s) en tout.`)

  const aDater: { id: string; localDate: string }[] = []
  const illisibles: string[] = []

  for (const document of inscriptions.docs) {
    const data = document.data()
    if (typeof data['localDate'] === 'string' && data['localDate'] !== '') continue
    const occurrenceId = data['occurrenceId']
    const jour = typeof occurrenceId === 'string' ? localDateOfOccurrenceId(occurrenceId) : null
    if (jour === null) {
      // Un identifiant qui n'a pas la forme attendue : on le nomme plutôt que de deviner.
      illisibles.push(document.id)
      continue
    }
    aDater.push({ id: document.id, localDate: jour })
  }

  console.log(`${aDater.length} inscription(s) sans date.`)
  if (illisibles.length > 0) {
    console.log(`⚠️  ${illisibles.length} inscription(s) dont la séance n'a pas la forme attendue :`)
    for (const id of illisibles.slice(0, 10)) console.log(`   ${id}`)
    console.log("   Elles ne seront pas datées. Le drapeau ne sera pas posé tant qu'il en reste.")
  }

  if (!corriger) {
    console.log('\nRien n’a été écrit. Relancez avec --corriger pour appliquer.')
    return
  }

  // Par paquets : une écriture groupée accepte cinq cents opérations.
  let ecrites = 0
  for (let i = 0; i < aDater.length; i += 400) {
    const lot = db.batch()
    for (const { id, localDate } of aDater.slice(i, i + 400)) {
      lot.update(db.collection('registrations').doc(id), { localDate })
    }
    await lot.commit()
    ecrites += Math.min(400, aDater.length - i)
    console.log(`  ${ecrites} / ${aDater.length}`)
  }

  if (illisibles.length > 0) {
    console.log(
      '\nLe drapeau n’est pas posé : certaines inscriptions n’ont pas pu être datées.\n' +
        'Corrigez-les d’abord — sinon le serveur les perdrait de vue.',
    )
    return
  }

  await db.collection('config').doc('app').set({ registrationsDated: true }, { merge: true })
  console.log('\nDrapeau posé : le serveur peut désormais lire au jour le jour.')
  console.log('Il le verra dans la demi-minute qui vient (le réglage est gardé en mémoire).')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
