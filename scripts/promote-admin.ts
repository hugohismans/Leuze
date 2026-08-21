/**
 * Donne le rôle « admin » à un compte existant.
 *
 * Le rôle vit dans un « custom claim » du jeton : il ne peut donc pas être posé
 * depuis la console Firebase, seulement par le SDK d'administration. Ce script sert
 * à créer le tout premier administrateur ; ensuite, l'administration se fait dans
 * l'application (fonction `setStaffRole`).
 *
 *   Sur l'émulateur :  npx vite-node scripts/promote-admin.ts soignant@exemple.test
 *   En production   :  GOOGLE_APPLICATION_CREDENTIALS=cle.json GCLOUD_PROJECT=... \
 *                      npx vite-node scripts/promote-admin.ts prenom.nom@acis-asbl.be
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const email = process.argv[2]
if (!email) {
  console.error('Indiquez l’adresse électronique du compte à promouvoir.')
  process.exit(1)
}

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-leuze'
// « demo-leuze » est le projet de l'émulateur. Sans émulateur en face, la commande
// irait interroger un projet inexistant et renverrait une erreur incompréhensible.
if (projectId === 'demo-leuze' && process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  console.error("Aucun projet indiqué. Sur le vrai projet, lancez :")
  console.error(`  GCLOUD_PROJECT=leuze-d23b5 npm run promote:admin -- ${email}`)
  process.exit(1)
}
const app = initializeApp({ projectId })

async function main(): Promise<void> {
  const auth = getAuth(app)
  const user = await auth.getUserByEmail(email).catch(() => null)
  if (user === null) {
    console.error(`Aucun compte pour ${email}. Créez-le d'abord dans Firebase Auth.`)
    process.exit(1)
  }

  await auth.setCustomUserClaims(user.uid, { role: 'admin' })
  await getFirestore(app).collection('staff').doc(user.uid).set({ role: 'admin', isActive: true }, { merge: true })
  // Le jeton en cours porte encore l'ancien rôle : il faut le révoquer.
  await auth.revokeRefreshTokens(user.uid)
  console.log(`${email} est administrateur. La personne doit se reconnecter.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
