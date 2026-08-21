/**
 * Remettre d'aplomb le nombre d'inscrits de chaque séance.
 *
 * Ce nombre est recopié sur la séance pour éviter de compter les inscriptions à chaque
 * affichage. Il est écrit dans la même transaction que l'inscription, donc il est juste —
 * sauf si une transaction s'est trompée. C'est arrivé : une désinscription annulait la
 * mauvaise ligne, écrivait le compte d'après, et laissait l'inscription en place. Le
 * défaut est corrigé, mais les comptes écrits ce jour-là sont restés trop bas.
 *
 * Ce script les recompte sur les inscriptions elles-mêmes, qui font foi. Il ne touche à
 * rien d'autre : ni aux inscriptions, ni aux séances, ni aux patients. Sans écriture, un
 * compte trop bas se corrige de toute façon à la prochaine inscription sur la séance ;
 * en attendant, il fait mentir « 8 sur 12 » à l'écran du patient.
 *
 *   npm run recompter                 — dit ce qui ne correspond pas, sans rien écrire
 *   npm run recompter -- --corriger   — écrit les valeurs recomptées
 *
 * Depuis Cloud Shell, où l'identité Google est déjà présente :
 *
 *   npm install
 *   gcloud config set project leuze-d23b5
 *   npm run recompter -- --corriger
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { firebaseOptions } from '../src/lib/data/firestore/options'

const args = process.argv.slice(2)
const corriger = args.includes('--corriger')
const PROJET = args.find((a) => a.startsWith('--projet='))?.split('=')[1]
  ?? process.env.GCLOUD_PROJECT
  ?? firebaseOptions.projectId

initializeApp({ credential: applicationDefault(), projectId: PROJET })
const db = getFirestore()

type Compte = { confirmedCount: number; waitlistCount: number }

async function main(): Promise<void> {
  console.log(`Projet : ${PROJET}`)
  console.log(corriger ? 'Mode : correction.' : 'Mode : lecture seule. Ajoutez --corriger pour écrire.')

  const [seances, inscriptions] = await Promise.all([
    db.collection('occurrences').get(),
    db.collection('registrations').get(),
  ])

  // Un seul passage sur les inscriptions : elles sont bien plus nombreuses que les séances.
  const reels = new Map<string, Compte>()
  for (const document of inscriptions.docs) {
    const data = document.data()
    const occurrenceId = data['occurrenceId'] as string | undefined
    const status = data['status'] as string | undefined
    if (typeof occurrenceId !== 'string') continue
    if (status !== 'confirmed' && status !== 'waitlist') continue
    const compte = reels.get(occurrenceId) ?? { confirmedCount: 0, waitlistCount: 0 }
    if (status === 'confirmed') compte.confirmedCount += 1
    else compte.waitlistCount += 1
    reels.set(occurrenceId, compte)
  }

  const aCorriger: Array<{ id: string; titre: string; ecrit: Compte; reel: Compte }> = []
  for (const document of seances.docs) {
    const data = document.data()
    const ecrit: Compte = {
      confirmedCount: (data['confirmedCount'] as number | undefined) ?? 0,
      waitlistCount: (data['waitlistCount'] as number | undefined) ?? 0,
    }
    const reel = reels.get(document.id) ?? { confirmedCount: 0, waitlistCount: 0 }
    if (ecrit.confirmedCount === reel.confirmedCount && ecrit.waitlistCount === reel.waitlistCount) continue
    aCorriger.push({
      id: document.id,
      titre: (data['title'] as string | undefined) ?? document.id,
      ecrit,
      reel,
    })
  }

  console.log(`${seances.size} séances lues, ${inscriptions.size} inscriptions lues.`)
  if (aCorriger.length === 0) {
    console.log('Tous les comptes correspondent. Rien à faire.')
    return
  }

  for (const ligne of aCorriger) {
    console.log(
      `  ${ligne.titre} (${ligne.id}) : ${ligne.ecrit.confirmedCount} inscrits écrits, ` +
        `${ligne.reel.confirmedCount} réels ; ${ligne.ecrit.waitlistCount} en attente écrits, ` +
        `${ligne.reel.waitlistCount} réels.`,
    )
  }

  if (!corriger) {
    console.log(`\n${aCorriger.length} séance(s) à corriger. Relancez avec --corriger pour écrire.`)
    return
  }

  // Par paquets de 400 : une écriture groupée en accepte 500, et l'on garde de la marge.
  for (let debut = 0; debut < aCorriger.length; debut += 400) {
    const paquet = db.batch()
    for (const ligne of aCorriger.slice(debut, debut + 400)) {
      paquet.update(db.collection('occurrences').doc(ligne.id), { ...ligne.reel })
    }
    await paquet.commit()
  }
  console.log(`\n${aCorriger.length} séance(s) corrigée(s).`)
}

main().catch((erreur) => {
  console.error(erreur)
  process.exit(1)
})
