/**
 * Injecte le jeu de démonstration dans les émulateurs.
 *
 *   npm run emulators   (dans un terminal)
 *   npm run seed        (dans un autre)
 *
 * Le script est idempotent : les identifiants d'occurrence sont déterministes,
 * le relancer ne crée pas de doublon.
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { config } from '../src/lib/config'
import { activitiesSeed } from '../src/lib/data/seed/activities.seed'
import { categoriesSeed } from '../src/lib/data/seed/categories.seed'
import { locationsSeed } from '../src/lib/data/seed/locations.seed'
import { servicesSeed } from '../src/lib/data/seed/services.seed'
import { GENERATION_WINDOW_WEEKS, expand } from '../src/lib/domain/recurrence'
import { addLocalDays, todayLocalDate } from '../src/lib/domain/time'

// Le préfixe « demo- » dispense l'émulateur de toute authentification Google.
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-leuze'
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
// Les fonctions émulées dérivent les codes avec le poivre de développement.
process.env.FUNCTIONS_EMULATOR ??= 'true'

const app = initializeApp({ projectId: PROJECT_ID })
const db = getFirestore(app)
db.settings({ ignoreUndefinedProperties: true })
const auth = getAuth(app)

/** Comptes de démonstration. Mots de passe volontairement triviaux : émulateur seulement. */
const STAFF = [
  { email: 'admin@exemple.test', password: 'demonstration', role: 'admin' as const, firstName: 'Sophie' },
  { email: 'soignant@exemple.test', password: 'demonstration', role: 'staff' as const, firstName: 'Marc' },
]

/** Code patient fixe, pour pouvoir se connecter à la démonstration sans le chercher. */
const DEMO_PATIENT = { code: '4KT9RM', firstName: 'Camille', serviceId: 'le-mazurel' }

async function seedCollection<T extends { id: string }>(name: string, rows: T[]): Promise<void> {
  const batch = db.batch()
  for (const row of rows) {
    const { id, ...rest } = row
    batch.set(db.collection(name).doc(id), rest, { merge: true })
  }
  await batch.commit()
  console.log(`  ${name} : ${rows.length}`)
}

async function seedOccurrences(): Promise<void> {
  const from = todayLocalDate()
  const to = addLocalDays(from, GENERATION_WINDOW_WEEKS * 7)
  const drafts = activitiesSeed.flatMap((activity) => expand(activity, from, to))

  for (let i = 0; i < drafts.length; i += 400) {
    const batch = db.batch()
    for (const occurrence of drafts.slice(i, i + 400)) {
      const { id, start, end, ...rest } = occurrence
      // `merge` préserve les compteurs d'un éventuel passage précédent.
      batch.set(
        db.collection('occurrences').doc(id),
        { ...rest, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) },
        { merge: true },
      )
    }
    await batch.commit()
  }
  console.log(`  occurrences : ${drafts.length} (du ${from} au ${to})`)
}

async function seedStaff(): Promise<void> {
  for (const member of STAFF) {
    const user = await auth.getUserByEmail(member.email).catch(() => null)
    const uid = user?.uid ?? (await auth.createUser({ email: member.email, password: member.password })).uid
    await auth.setCustomUserClaims(uid, { role: member.role })
    await db.collection('staff').doc(uid).set({ firstName: member.firstName, role: member.role, isActive: true })
    console.log(`  ${member.email} (${member.role}) — mot de passe : ${member.password}`)
  }
}

async function seedPatient(): Promise<void> {
  const { hashCode, newPatientUid } = await import('../functions/src/lib/codes')
  const uid = newPatientUid()
  const expiresAt = Timestamp.fromMillis(Date.now() + 60 * 86_400_000)

  // Un seul patient de démonstration : on efface les codes précédents pour éviter
  // d'accumuler des identités à chaque exécution.
  const previous = await db.collection('patients').where('firstName', '==', DEMO_PATIENT.firstName).get()
  const cleanup = db.batch()
  previous.docs.forEach((document) => cleanup.delete(document.ref))
  const oldCodes = await db.collection('patientCodes').get()
  oldCodes.docs.forEach((document) => cleanup.delete(document.ref))
  await cleanup.commit()

  await db.collection('patients').doc(uid).set({
    firstName: DEMO_PATIENT.firstName,
    serviceId: DEMO_PATIENT.serviceId,
    createdAt: Timestamp.now(),
    expiresAt,
  })
  await db.collection('patientCodes').doc(hashCode(DEMO_PATIENT.code)).set({
    uid,
    expiresAt,
    createdAt: Timestamp.now(),
    createdBy: 'seed',
  })
  console.log(`  patient ${DEMO_PATIENT.firstName} (${DEMO_PATIENT.serviceId}) — code : ${DEMO_PATIENT.code}`)
}

async function main(): Promise<void> {
  console.log(`Injection dans l'émulateur (projet ${PROJECT_ID})`)
  await db.collection('config').doc('app').set({
    retentionDays: config.retentionDays,
    codeValidityDays: 60,
    generationWindowWeeks: config.generationWindowWeeks,
    planZones: {},
  })
  await seedCollection('services', servicesSeed)
  await seedCollection('locations', locationsSeed)
  await seedCollection('categories', categoriesSeed)
  await seedCollection('activities', activitiesSeed)
  await seedOccurrences()
  await seedStaff()
  await seedPatient()
  console.log('Terminé.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
