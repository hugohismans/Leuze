/**
 * Donne le rôle « admin » à un compte existant.
 *
 * Le rôle vit dans un « custom claim » du jeton : il ne peut donc pas être posé
 * depuis la console Firebase, seulement par le SDK d'administration. Ce script sert
 * à créer le tout premier administrateur ; ensuite, l'administration se fait dans
 * l'application (fonction `setStaffRole`).
 *
 *   Sur l'émulateur :  npx vite-node scripts/promote-admin.ts soignant@exemple.test
 *   Dans Cloud Shell : GCLOUD_PROJECT=leuze-d23b5 npm run promote:admin -- adresse@exemple.be
 */
import { execFileSync } from 'node:child_process'
import { initializeApp, type Credential } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const email = process.argv[2]
if (!email) {
  console.error('Indiquez l’adresse électronique du compte à promouvoir.')
  process.exit(1)
}

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-leuze'
const surEmulateur = process.env.FIRESTORE_EMULATOR_HOST !== undefined
// « demo-leuze » est le projet de l'émulateur. Sans émulateur en face, la commande
// irait interroger un projet inexistant et renverrait une erreur incompréhensible.
if (projectId === 'demo-leuze' && !surEmulateur) {
  console.error('Aucun projet indiqué. Sur le vrai projet, lancez :')
  console.error(`  GCLOUD_PROJECT=leuze-d23b5 npm run promote:admin -- ${email}`)
  process.exit(1)
}

/**
 * Dans Cloud Shell, les identifiants « par défaut » ne portent pas toujours les droits
 * nécessaires sur l'authentification : le jeton du serveur de métadonnées est limité.
 * Celui de `gcloud`, lui, est bien celui de la personne connectée à la console.
 * On le préfère dès qu'il est disponible, et on retombe sinon sur le comportement
 * habituel du SDK.
 */
function identifiantsGcloud(): Credential | undefined {
  let jeton: string
  try {
    jeton = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
  if (jeton === '') return undefined
  // Le jeton dure une heure ; le script, quelques secondes.
  return { getAccessToken: async () => ({ access_token: jeton, expires_in: 3000 }) }
}

const credential = surEmulateur ? undefined : identifiantsGcloud()
const app = initializeApp(credential === undefined ? { projectId } : { projectId, credential })

function explique(error: unknown): string {
  const e = error as { code?: string; message?: string }
  return `${e.code ?? 'erreur'} — ${e.message ?? String(error)}`
}

async function main(): Promise<void> {
  const auth = getAuth(app)

  const user = await auth.getUserByEmail(email).catch((error: unknown) => {
    const code = (error as { code?: string }).code ?? ''
    if (code !== 'auth/user-not-found') {
      // Ne jamais présenter une panne d'accès comme un compte manquant : c'est ce qui
      // a fait chercher au mauvais endroit la première fois.
      console.error(`La consultation du compte a échoué : ${explique(error)}`)
      console.error(`Projet visé : ${projectId}`)
      console.error("Si c'est un refus d'accès, vérifiez que le compte connecté à Cloud Shell")
      console.error('est bien propriétaire de ce projet Firebase.')
      process.exit(1)
    }
    return null
  })

  if (user === null) {
    console.error(`Aucun compte pour ${email} dans le projet ${projectId}.`)
    const autres = await auth
      .listUsers(10)
      .then((r) => r.users.map((u) => u.email ?? u.uid))
      .catch(() => [])
    if (autres.length > 0) {
      console.error('Comptes présents dans ce projet :')
      for (const a of autres) console.error(`  ${a}`)
      console.error("Vérifiez l'adresse, ou le projet ouvert dans la console Firebase.")
    } else {
      console.error("Ce projet n'a aucun compte. La console était peut-être ouverte sur un autre projet.")
    }
    process.exit(1)
  }

  await auth.setCustomUserClaims(user.uid, { role: 'admin' })
  await getFirestore(app).collection('staff').doc(user.uid).set({ role: 'admin', isActive: true }, { merge: true })
  // Le jeton en cours porte encore l'ancien rôle : il faut le révoquer.
  await auth.revokeRefreshTokens(user.uid)
  console.log(`${email} est administrateur. La personne doit se reconnecter.`)
}

main().catch((error: unknown) => {
  console.error(explique(error))
  process.exit(1)
})
