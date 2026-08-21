/**
 * Donne le rôle « admin » à un compte existant.
 *
 * Le rôle vit dans un « custom claim » du jeton : il ne peut donc pas être posé
 * depuis la console Firebase, seulement par l'administration du projet. Ce script sert
 * à créer le tout premier administrateur ; ensuite, l'administration se fait dans
 * l'application (fonction `setStaffRole`).
 *
 *   Sur l'émulateur :  npx vite-node scripts/promote-admin.ts soignant@exemple.test
 *   Dans Cloud Shell : GCLOUD_PROJECT=leuze-d23b5 npm run promote:admin -- adresse@exemple.be
 *
 * Sur le vrai projet, on n'utilise pas le SDK d'administration : l'API d'authentification
 * de Google refuse les identifiants d'une personne (« adc-troubleshooting/user-creds ») et
 * n'accepte qu'un compte de service — qu'il faudrait télécharger, donc garder quelque part.
 * On appelle l'API directement avec le jeton de `gcloud`, en nommant le projet qui paie
 * l'appel : c'est exactement ce qui manquait, et cela évite toute clé sur le disque.
 */
import { execFileSync } from 'node:child_process'

const email = process.argv[2]
if (email === undefined || email === '') {
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

const CLAIMS_ADMIN = JSON.stringify({ role: 'admin' })

type Compte = { localId: string; email?: string }

function gcloud(args: string[]): string | undefined {
  try {
    const sortie = execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return sortie === '' ? undefined : sortie
  } catch {
    return undefined
  }
}

/**
 * Le compte de service à emprunter si Google refuse les identifiants de la personne.
 * Celui du SDK d'administration d'abord, sinon celui du projet : tous deux ont le droit
 * de modifier les comptes.
 */
function compteDeService(): string | undefined {
  const liste = gcloud(['iam', 'service-accounts', 'list', `--project=${projectId}`, '--format=value(email)'])
  if (liste === undefined) return undefined
  const adresses = liste.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  return (
    adresses.find((a) => a.startsWith('firebase-adminsdk')) ??
    adresses.find((a) => a.endsWith('@appspot.gserviceaccount.com')) ??
    adresses[0]
  )
}

function entetes(jeton: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jeton}`,
    // Sans cet en-tête, l'API rejette le jeton d'une personne physique.
    'X-Goog-User-Project': projectId,
    'Content-Type': 'application/json',
  }
}

/**
 * L'API d'authentification n'accepte pas toujours le jeton d'une personne, même en
 * nommant le projet. On le vérifie par un appel à vide avant d'agir, et on emprunte au
 * besoin l'identité d'un compte de service — sans jamais télécharger de clé.
 */
async function choisitJeton(urlAuth: string): Promise<string> {
  const direct = gcloud(['auth', 'print-access-token'])
  if (direct === undefined) {
    console.error("Impossible d'obtenir un jeton d'accès. Dans Cloud Shell, lancez :")
    console.error('  gcloud auth login')
    process.exit(1)
  }

  const sonde = await fetch(`${urlAuth}/accounts:batchGet?maxResults=1`, { headers: entetes(direct) })
  if (sonde.ok) return direct

  const refus = await sonde.text()
  const sa = compteDeService()
  const emprunte =
    sa === undefined ? undefined : gcloud(['auth', 'print-access-token', `--impersonate-service-account=${sa}`])
  if (emprunte === undefined) {
    console.error(`Google refuse ces identifiants : ${sonde.status} — ${refus}`)
    console.error(`Projet visé : ${projectId}`)
    console.error('Vérifiez que le compte connecté à Cloud Shell est propriétaire de ce projet.')
    process.exit(1)
  }
  console.log(`Identifiants personnels refusés par Google — passage par le compte de service ${sa}.`)
  return emprunte
}

async function appel(url: string, jeton: string, corps?: unknown): Promise<unknown> {
  const reponse = await fetch(url, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: entetes(jeton),
    body: corps === undefined ? undefined : JSON.stringify(corps),
  })
  const texte = await reponse.text()
  if (!reponse.ok) throw new Error(`${reponse.status} ${reponse.statusText} — ${texte}`)
  return texte === '' ? {} : (JSON.parse(texte) as unknown)
}

function comptes(reponse: unknown): Compte[] {
  const users = (reponse as { users?: unknown }).users
  return Array.isArray(users) ? (users as Compte[]) : []
}

async function surLeVraiProjet(): Promise<void> {
  const auth = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}`
  const jeton = await choisitJeton(auth)

  const trouves = comptes(await appel(`${auth}/accounts:lookup`, jeton, { email: [email] }))
  const compte = trouves[0]
  if (compte === undefined) {
    console.error(`Aucun compte pour ${email} dans le projet ${projectId}.`)
    const presents = comptes(await appel(`${auth}/accounts:batchGet?maxResults=10`, jeton).catch(() => ({})))
    if (presents.length > 0) {
      console.error('Comptes présents dans ce projet :')
      for (const c of presents) console.error(`  ${c.email ?? c.localId}`)
    }
    process.exit(1)
  }

  await appel(`${auth}/accounts:update`, jeton, {
    localId: compte.localId,
    customAttributes: CLAIMS_ADMIN,
  })

  // Le jeton en cours porte encore l'ancien rôle : il faut le périmer.
  await appel(`${auth}/accounts:update`, jeton, {
    localId: compte.localId,
    validSince: String(Math.floor(Date.now() / 1000)),
  }).catch(() => undefined)

  // Le document « staff » ne décide d'aucun droit — il sert à afficher l'équipe.
  const doc = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/staff/${compte.localId}`
  const masque = 'updateMask.fieldPaths=role&updateMask.fieldPaths=isActive'
  const reponse = await fetch(`${doc}?${masque}`, {
    method: 'PATCH',
    headers: entetes(jeton),
    body: JSON.stringify({ fields: { role: { stringValue: 'admin' }, isActive: { booleanValue: true } } }),
  })
  if (!reponse.ok) {
    console.error(`Le rôle est posé, mais la fiche d'équipe n'a pas pu être écrite : ${reponse.status}`)
  }
}

async function surLEmulateur(): Promise<void> {
  const { initializeApp } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  const { getFirestore } = await import('firebase-admin/firestore')
  const app = initializeApp({ projectId })
  const auth = getAuth(app)
  const user = await auth.getUserByEmail(email).catch(() => null)
  if (user === null) {
    console.error(`Aucun compte pour ${email}. Créez-le d'abord dans Firebase Auth.`)
    process.exit(1)
  }
  await auth.setCustomUserClaims(user.uid, { role: 'admin' })
  await getFirestore(app).collection('staff').doc(user.uid).set({ role: 'admin', isActive: true }, { merge: true })
  await auth.revokeRefreshTokens(user.uid)
}

async function main(): Promise<void> {
  if (surEmulateur) await surLEmulateur()
  else await surLeVraiProjet()
  console.log(`${email} est administrateur. La personne doit se déconnecter puis se reconnecter.`)
}

main().catch((error: unknown) => {
  const e = error as { code?: string; message?: string }
  console.error(`La promotion a échoué : ${e.code ?? 'erreur'} — ${e.message ?? String(error)}`)
  console.error(`Projet visé : ${projectId}`)
  process.exit(1)
})
