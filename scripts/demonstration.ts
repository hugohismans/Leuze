/**
 * Vider la vraie base, et la remplir d'un jeu de démonstration.
 *
 *   npm run demo:vider     — efface tout, sauf le compte administrateur
 *   npm run demo:remplir   — écrit le jeu de démonstration
 *   npm run demo:reset     — les deux, dans cet ordre
 *
 * ⚠️ Ce script écrit dans le **vrai projet**, pas dans l'émulateur. Il efface des
 * données sans retour possible. Il exige donc trois choses avant d'agir :
 *   1. l'option `--je-confirme` ;
 *   2. un projet explicite (`--projet=...` ou la variable `GCLOUD_PROJECT`) ;
 *   3. l'adresse de l'administrateur à préserver (`ADMIN_EMAIL`, ou la valeur par défaut).
 *
 * Il se lance depuis Cloud Shell, où l'identité Google est déjà présente. La machine
 * étant remise à neuf régulièrement, les deux premières lignes ne sont pas facultatives :
 *
 *   npm install
 *   gcloud config set project leuze-d23b5
 *   export CODE_PEPPER="$(gcloud secrets versions access latest --secret=CODE_PEPPER)"
 *   npm run demo:reset -- --je-confirme
 *
 * Sans `CODE_PEPPER`, les patients sont créés mais sans code d'accès : ils apparaissent
 * dans les listes du personnel, ils ne peuvent simplement pas ouvrir de session.
 */
import { randomBytes } from 'node:crypto'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { config } from '../src/lib/config'
import { firebaseOptions } from '../src/lib/data/firestore/options'
import { appointmentKindsSeed } from '../src/lib/data/seed/appointmentKinds.seed'
import { categoriesSeed } from '../src/lib/data/seed/categories.seed'
import { locationsSeed } from '../src/lib/data/seed/locations.seed'
import { servicesSeed } from '../src/lib/data/seed/services.seed'
import {
  presentationAccounts,
  presentationActivities,
  presentationPatients,
  presentationPractitioners,
  type SeedActivity,
} from '../src/lib/data/seed/presentation.seed'
import { expand } from '../src/lib/domain/recurrence'
import { addLocalDays, instantOf, startOfIsoWeek, todayLocalDate } from '../src/lib/domain/time'
import type { Activity, Occurrence } from '../src/lib/domain/types'

// --- garde-fous ------------------------------------------------------------------

const args = process.argv.slice(2)
const veut = (nom: string): boolean => args.includes(`--${nom}`)
const valeur = (nom: string): string | null =>
  args.find((a) => a.startsWith(`--${nom}=`))?.split('=').slice(1).join('=') ?? null

const PROJET = valeur('projet') ?? process.env.GCLOUD_PROJECT ?? firebaseOptions.projectId
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'hugo.hismans@gmail.com'

/*
  Le même geste peut se répéter sur l'émulateur avant d'être fait pour de bon : c'est
  la seule façon honnête de vérifier qu'un script qui efface fonctionne. `--emulateur`
  l'exige explicitement, et refuse de partir si l'émulateur n'est pas là.
*/
const surEmulateur = veut('emulateur')
const hote = process.env.FIRESTORE_EMULATOR_HOST
if (surEmulateur) {
  if (hote === undefined || !/^(127\.0\.0\.1|localhost|::1):/.test(hote)) {
    console.error('--emulateur demandé, mais FIRESTORE_EMULATOR_HOST ne pointe pas sur une machine locale.')
    process.exit(1)
  }
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
  process.env.FUNCTIONS_EMULATOR ??= 'true'
} else if (hote !== undefined) {
  console.error(
    'FIRESTORE_EMULATOR_HOST est défini alors que ce script vise le vrai projet.\n' +
      'Ajoutez « --emulateur » pour répéter sans risque, ou retirez la variable.',
  )
  process.exit(1)
}

const vider = veut('vider') || veut('reset')
const remplir = veut('remplir') || veut('reset')
if (!vider && !remplir) {
  console.error('Précisez ce qu’il faut faire : --vider, --remplir ou --reset.')
  process.exit(1)
}

if (!veut('je-confirme')) {
  console.error(
    `Ce script va ${vider ? 'EFFACER toutes les données' : 'écrire des données de démonstration'} ` +
      `du projet « ${PROJET} ».\n` +
      `Seul le compte ${ADMIN_EMAIL} sera préservé.\n\n` +
      'Relancez la commande avec « -- --je-confirme » si c’est bien ce que vous voulez.',
  )
  process.exit(1)
}

// Sur l'émulateur, aucune identité Google n'est nécessaire — et il n'y en a pas.
const app = initializeApp(
  surEmulateur ? { projectId: PROJET } : { projectId: PROJET, credential: applicationDefault() },
)
const db = getFirestore(app)
db.settings({ ignoreUndefinedProperties: true })
const auth = getAuth(app)

/** Toutes les collections de l'application. Le catalogue est réécrit ensuite. */
const COLLECTIONS = [
  'activities',
  'occurrences',
  'registrations',
  'appointments',
  'activityProposals',
  'patients',
  'patientCodes',
  'practitioners',
  'locations',
  'categories',
  'services',
  'appointmentKinds',
  'staff',
  'rateLimits',
]

// --- effacement ------------------------------------------------------------------

async function effacerCollection(database: Firestore, nom: string): Promise<number> {
  let total = 0
  // Par paquets : une collection de plusieurs milliers de documents ne s'efface pas
  // d'un seul lot, et une écriture Firestore est plafonnée à 500 opérations.
  for (;;) {
    const lot = await database.collection(nom).limit(400).get()
    if (lot.empty) break
    const batch = database.batch()
    lot.docs.forEach((document) => batch.delete(document.ref))
    await batch.commit()
    total += lot.size
    if (lot.size < 400) break
  }
  return total
}

async function effacerLesComptes(): Promise<{ supprimes: number; garde: string | null }> {
  const administrateur = await auth.getUserByEmail(ADMIN_EMAIL).catch(() => null)
  if (administrateur === null && !surEmulateur) {
    throw new Error(
      `Le compte ${ADMIN_EMAIL} n’existe pas dans ce projet. ` +
        'Refus d’effacer : on ne se coupe pas la seule porte d’entrée.',
    )
  }

  const aSupprimer: string[] = []
  let page = await auth.listUsers(1000)
  for (;;) {
    for (const utilisateur of page.users) {
      if (utilisateur.uid !== administrateur?.uid) aSupprimer.push(utilisateur.uid)
    }
    if (page.pageToken === undefined) break
    page = await auth.listUsers(1000, page.pageToken)
  }

  for (let i = 0; i < aSupprimer.length; i += 900) {
    await auth.deleteUsers(aSupprimer.slice(i, i + 900))
  }
  return { supprimes: aSupprimer.length, garde: administrateur?.uid ?? null }
}

// --- remplissage -----------------------------------------------------------------

/** Les dates du programme sont posées autour du lundi de la semaine en cours. */
function activiteComplete(seed: SeedActivity): Activity {
  const aujourdHui = todayLocalDate()
  const lundi = startOfIsoWeek(aujourdHui)
  const { weekly, single, ...reste } = seed
  return {
    ...reste,
    seriesId: `serie-${seed.id}`,
    recurrence:
      weekly === undefined
        ? null
        : {
            freq: 'weekly',
            byWeekday: weekly.byWeekday,
            startTime: weekly.startTime,
            durationMin: weekly.durationMin,
            // Deux semaines derrière : la démonstration montre aussi ce qui a eu lieu,
            // les présences déjà notées et les plannings de la semaine passée.
            from: addLocalDays(lundi, -14),
            until: null,
            skipDates: [],
          },
    singleStart:
      single === undefined
        ? undefined
        : { date: addLocalDays(aujourdHui, single.inDays), time: single.time, durationMin: single.durationMin },
  }
}

async function ecrireCollection<T extends { id: string }>(nom: string, lignes: T[]): Promise<void> {
  for (let i = 0; i < lignes.length; i += 400) {
    const batch = db.batch()
    for (const ligne of lignes.slice(i, i + 400)) {
      const { id, ...reste } = ligne
      batch.set(db.collection(nom).doc(id), reste)
    }
    await batch.commit()
  }
  console.log(`  ${nom} : ${lignes.length}`)
}

async function ecrireOccurrences(activites: Activity[]): Promise<Occurrence[]> {
  const lundi = startOfIsoWeek(todayLocalDate())
  const debut = addLocalDays(lundi, -14)
  const fin = addLocalDays(lundi, config.generationWindowWeeks * 7)
  const occurrences = activites.flatMap((activite) => expand(activite, debut, fin))

  for (let i = 0; i < occurrences.length; i += 400) {
    const batch = db.batch()
    for (const occurrence of occurrences.slice(i, i + 400)) {
      const { id, start, end, ...reste } = occurrence
      batch.set(db.collection('occurrences').doc(id), {
        ...reste,
        start: Timestamp.fromDate(start),
        end: Timestamp.fromDate(end),
      })
    }
    await batch.commit()
  }
  console.log(`  occurrences : ${occurrences.length} (du ${debut} au ${fin})`)
  return occurrences
}

type PatientCree = { uid: string; firstName: string; serviceId: string; code: string | null }

async function ecrirePatients(): Promise<PatientCree[]> {
  const { generateCode, hashCode, newPatientUid } = await import('../functions/src/lib/codes')
  const poivre = process.env.CODE_PEPPER
  const expiresAt = Timestamp.fromMillis(Date.now() + 120 * 86_400_000)
  const crees: PatientCree[] = []

  for (const personne of presentationPatients) {
    const uid = newPatientUid()
    await db.collection('patients').doc(uid).set({
      firstName: personne.firstName,
      serviceId: personne.serviceId,
      createdAt: Timestamp.now(),
      expiresAt,
    })

    let code: string | null = null
    if (poivre !== undefined && poivre.length > 0) {
      code = generateCode()
      await db.collection('patientCodes').doc(hashCode(code)).set({
        uid,
        expiresAt,
        createdAt: Timestamp.now(),
        createdBy: 'demonstration',
      })
    }
    crees.push({ uid, firstName: personne.firstName, serviceId: personne.serviceId, code })
  }
  console.log(`  patients : ${crees.length}${poivre ? ' (avec code)' : ' (sans code — CODE_PEPPER absent)'}`)
  return crees
}

async function ecrireComptes(): Promise<{ email: string; motDePasse: string }[]> {
  /*
    L'administrateur d'abord : sa fiche `staff` a disparu avec le reste, et sans elle
    l'espace soignant ne sait plus comment il s'appelle. Son rôle, lui, vit dans le
    jeton et n'a pas été touché.
  */
  const administrateur = await auth.getUserByEmail(ADMIN_EMAIL).catch(() => null)
  if (administrateur !== null) {
    await db.collection('staff').doc(administrateur.uid).set({
      firstName: administrateur.displayName ?? 'Administrateur',
      role: 'admin',
      isActive: true,
    })
  }

  const ouverts: { email: string; motDePasse: string }[] = []
  for (const compte of presentationAccounts) {
    // Un mot de passe tiré au sort, affiché une fois : rien de secret ne vit dans le dépôt.
    const motDePasse = `${randomBytes(6).toString('base64url')}-Demo1`
    const existant = await auth.getUserByEmail(compte.email).catch(() => null)
    const uid =
      existant?.uid ?? (await auth.createUser({ email: compte.email, password: motDePasse })).uid
    if (existant !== null) await auth.updateUser(uid, { password: motDePasse })

    // Le rôle qui fait autorité est le jeton, jamais le document : les deux sont posés.
    await auth.setCustomUserClaims(uid, { role: compte.role, practitionerId: compte.practitionerId })
    const intervenant = presentationPractitioners.find((p) => p.id === compte.practitionerId)
    await db.collection('staff').doc(uid).set({
      firstName: intervenant?.name ?? compte.email,
      role: compte.role,
      practitionerId: compte.practitionerId,
      isActive: true,
    })
    ouverts.push({ email: compte.email, motDePasse })
  }
  console.log(`  comptes du personnel : ${ouverts.length}`)
  return ouverts
}

/**
 * Les inscriptions.
 *
 * Écrites directement, compteurs compris : ce script court hors des transactions
 * habituelles. La règle appliquée est la même — au-delà de la capacité, on passe en
 * liste d'attente — sans quoi la démonstration montrerait des occurrences dont les
 * compteurs mentent.
 */
async function ecrireInscriptions(occurrences: Occurrence[], patients: PatientCree[]): Promise<void> {
  const lundi = startOfIsoWeek(todayLocalDate())
  const fenetre = occurrences.filter(
    (o) => o.localDate >= addLocalDays(lundi, -14) && o.localDate <= addLocalDays(lundi, 21) && o.registrationRequired,
  )

  const compteurs = new Map<string, { confirmes: number; attente: number }>()
  const inscriptions: {
    id: string
    occurrenceId: string
    patientUid: string
    status: 'confirmed' | 'waitlist'
    createdAt: Date
    queuedAt: Date
    createdBy: 'patient' | 'staff'
    attendance?: 'present' | 'absent'
  }[] = []

  const aujourdHui = todayLocalDate()
  let graine = 7
  // Tirage reproductible : deux exécutions donnent la même démonstration.
  const suivant = (max: number): number => {
    graine = (graine * 1103515245 + 12345) % 2147483648
    return graine % max
  }

  for (const occurrence of fenetre) {
    const candidats = patients.filter(
      (p) => occurrence.audienceKeys.includes('all') || occurrence.audienceKeys.includes(p.serviceId),
    )
    if (candidats.length === 0) continue
    /*
      Les petites activités se remplissent entièrement : une démonstration doit montrer
      une séance complète et une liste d'attente, sinon la moitié de ce que l'application
      sait faire reste invisible. Les grandes se remplissent au hasard.
    */
    const combien =
      occurrence.capacity !== null && occurrence.capacity <= 8
        ? // Complète, plus une ou deux personnes en attente : c'est ce qu'on voit dans un
          // vrai programme, et de quoi montrer la file sans la caricaturer.
          Math.min(candidats.length, occurrence.capacity + suivant(3))
        : Math.min(candidats.length, 2 + suivant(6))

    const melanges = [...candidats].sort(() => suivant(3) - 1)
    for (const patient of melanges.slice(0, combien)) {
      const etat = compteurs.get(occurrence.id) ?? { confirmes: 0, attente: 0 }
      const complet = occurrence.capacity !== null && etat.confirmes >= occurrence.capacity
      if (complet && !occurrence.waitlistEnabled) continue

      const quand = instantOf(addLocalDays(occurrence.localDate, -3), '09:00')
      const statut = complet ? ('waitlist' as const) : ('confirmed' as const)
      if (complet) etat.attente += 1
      else etat.confirmes += 1
      compteurs.set(occurrence.id, etat)

      inscriptions.push({
        id: `${occurrence.id}--${patient.uid}`,
        occurrenceId: occurrence.id,
        patientUid: patient.uid,
        status: statut,
        createdAt: quand,
        queuedAt: quand,
        createdBy: suivant(3) === 0 ? 'patient' : 'staff',
        // Les séances passées ont leur appel déjà fait : la démonstration peut montrer
        // une feuille de présence remplie, et pas seulement un écran vide.
        ...(occurrence.localDate < aujourdHui && statut === 'confirmed'
          ? { attendance: suivant(5) === 0 ? ('absent' as const) : ('present' as const) }
          : {}),
      })
    }
  }

  for (let i = 0; i < inscriptions.length; i += 400) {
    const batch = db.batch()
    for (const inscription of inscriptions.slice(i, i + 400)) {
      const { id, createdAt, queuedAt, ...reste } = inscription
      batch.set(db.collection('registrations').doc(id), {
        ...reste,
        createdAt: Timestamp.fromDate(createdAt),
        queuedAt: Timestamp.fromDate(queuedAt),
      })
    }
    await batch.commit()
  }

  // Les compteurs de l'occurrence, remis d'aplomb.
  const ids = [...compteurs.keys()]
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch()
    for (const id of ids.slice(i, i + 400)) {
      const etat = compteurs.get(id)!
      batch.set(
        db.collection('occurrences').doc(id),
        { confirmedCount: etat.confirmes, waitlistCount: etat.attente },
        { merge: true },
      )
    }
    await batch.commit()
  }
  console.log(`  inscriptions : ${inscriptions.length} sur ${compteurs.size} séances`)
}

/** Quelques rendez-vous : des demandes en attente, et d'autres déjà fixés. */
async function ecrireRendezVous(patients: PatientCree[]): Promise<void> {
  const lundi = startOfIsoWeek(todayLocalDate())
  const rendezVous: Record<string, unknown>[] = []
  const enAttente = [
    { patient: 0, kindId: 'psychiatre', preference: 'matin' },
    { patient: 4, kindId: 'psychologue', preference: 'apres-midi' },
    { patient: 8, kindId: 'assistant-social', preference: 'peu-importe' },
    { patient: 11, kindId: 'kinesitherapeute', preference: 'matin' },
  ]
  for (const demande of enAttente) {
    const personne = patients[demande.patient]
    if (personne === undefined) continue
    rendezVous.push({
      patientUid: personne.uid,
      kindId: demande.kindId,
      preference: demande.preference,
      status: 'requested',
      createdAt: Timestamp.fromMillis(Date.now() - (1 + demande.patient) * 86_400_000),
    })
  }

  const fixes = [
    { patient: 1, kindId: 'psychiatre', qui: 'Docteur Lemaire', id: 'dr-lemaire', jour: 1, heure: '09:30' },
    { patient: 2, kindId: 'psychologue', qui: 'Claire Dubois', id: 'claire-dubois', jour: 2, heure: '14:00' },
    { patient: 5, kindId: 'kinesitherapeute', qui: 'Julien Marchal', id: 'julien-marchal', jour: 0, heure: '09:00' },
    { patient: 9, kindId: 'psychiatre', qui: 'Docteur Nkosi', id: 'dr-nkosi', jour: 7, heure: '10:00' },
    { patient: 13, kindId: 'infirmier-referent', qui: 'Pierre Colin', id: 'pierre-colin', jour: 8, heure: '10:30' },
  ]
  for (const rendez of fixes) {
    const personne = patients[rendez.patient]
    if (personne === undefined) continue
    const jour = addLocalDays(lundi, rendez.jour + 1)
    const debut = instantOf(jour, rendez.heure)
    rendezVous.push({
      patientUid: personne.uid,
      kindId: rendez.kindId,
      preference: 'peu-importe',
      status: 'scheduled',
      createdAt: Timestamp.fromMillis(Date.now() - 5 * 86_400_000),
      localDate: jour,
      start: Timestamp.fromDate(debut),
      end: Timestamp.fromMillis(debut.getTime() + 30 * 60_000),
      withWhom: rendez.qui,
      practitionerId: rendez.id,
      locationId: 'salon-daccueil',
    })
  }

  const batch = db.batch()
  for (const rendez of rendezVous) batch.set(db.collection('appointments').doc(), rendez)
  await batch.commit()
  console.log(`  rendez-vous : ${rendezVous.length}`)
}

// --- déroulé ---------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Projet : ${PROJET}`)

  if (vider) {
    console.log('\nEffacement…')
    for (const collection of COLLECTIONS) {
      const nombre = await effacerCollection(db, collection)
      if (nombre > 0) console.log(`  ${collection} : ${nombre} document(s) effacé(s)`)
    }
    const comptes = await effacerLesComptes()
    console.log(
      `  comptes : ${comptes.supprimes} supprimé(s)` +
        (comptes.garde === null ? ' (aucun administrateur ici)' : `, ${ADMIN_EMAIL} conservé`),
    )
  }

  if (!remplir) {
    console.log('\nTerminé.')
    return
  }

  console.log('\nRemplissage…')
  await db.collection('config').doc('app').set(
    {
      retentionDays: config.retentionDays,
      codeValidityDays: 120,
      generationWindowWeeks: config.generationWindowWeeks,
      planZones: {},
    },
    { merge: true },
  )
  await ecrireCollection('services', servicesSeed)
  await ecrireCollection('locations', locationsSeed)
  await ecrireCollection('categories', categoriesSeed)
  await ecrireCollection('appointmentKinds', appointmentKindsSeed)
  await ecrireCollection('practitioners', presentationPractitioners)

  const activites = presentationActivities.map(activiteComplete)
  await ecrireCollection('activities', activites)
  const occurrences = await ecrireOccurrences(activites)

  const patients = await ecrirePatients()
  const comptes = await ecrireComptes()
  await ecrireInscriptions(occurrences, patients)
  await ecrireRendezVous(patients)

  console.log('\n--- À garder sous la main pour la présentation ---')
  console.log('\nComptes du personnel (mots de passe affichés une seule fois) :')
  for (const compte of comptes) console.log(`  ${compte.email}  ${compte.motDePasse}`)
  const avecCode = patients.filter((p) => p.code !== null)
  if (avecCode.length > 0) {
    console.log('\nCodes patients :')
    for (const personne of avecCode) {
      const lisible = personne.code!.replace(/(.{3})(?=.)/g, '$1-')
      console.log(`  ${personne.firstName.padEnd(12)} ${personne.serviceId.padEnd(18)} ${lisible}`)
    }
  } else {
    console.log(
      '\nAucun code patient : la variable CODE_PEPPER était absente.\n' +
        `  gcloud config set project ${PROJET}\n` +
        '  export CODE_PEPPER="$(gcloud secrets versions access latest --secret=CODE_PEPPER)"\n' +
        '  puis relancez « npm run demo:remplir -- --je-confirme ».\n' +
        '  (Les patients sont bien créés ; il ne leur manque qu’un code pour se connecter.)',
    )
  }
  console.log('\nTerminé.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
