/**
 * Adapter Firestore. Avec `mock/`, c'est la seule partie du code qui connaît Firebase.
 *
 * Deux principes s'y appliquent, et le reste en découle :
 *  - le filtrage par service est fait dans la requête, jamais à l'affichage ; les règles
 *    de sécurité vérifient exactement la même condition ;
 *  - toute écriture touchant à la capacité passe par une fonction appelable, jamais par
 *    une écriture directe. Les règles refusent le reste.
 */
import { signInWithCustomToken, onAuthStateChanged, signOut, type User } from 'firebase/auth'
import {
  Timestamp,
  addDoc as addDocSansLimite,
  collection,
  doc,
  getDoc as getDocSansLimite,
  getDocs as getDocsSansLimite,
  orderBy,
  query,
  updateDoc as updateDocSansLimite,
  where,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { httpsCallable as httpsCallableSansLimite } from 'firebase/functions'
import { ecrire, lire } from './reseau'

/*
  Firebase ne renonce jamais de lui-même : une lecture lancée au moment où le téléphone
  change de réseau attend indéfiniment, sans erreur. On redéfinit donc ici les quelques
  fonctions qui traversent le réseau, chacune bornée dans le temps. Le reste du fichier
  les utilise sans le savoir — c'est le seul moyen de ne pas en oublier une.
*/
const getDocs: typeof getDocsSansLimite = ((...args: Parameters<typeof getDocsSansLimite>) =>
  lire(getDocsSansLimite(...args))) as typeof getDocsSansLimite
const getDoc: typeof getDocSansLimite = ((...args: Parameters<typeof getDocSansLimite>) =>
  lire(getDocSansLimite(...args))) as typeof getDocSansLimite
const addDoc: typeof addDocSansLimite = ((...args: Parameters<typeof addDocSansLimite>) =>
  ecrire(addDocSansLimite(...args))) as typeof addDocSansLimite
const updateDoc: typeof updateDocSansLimite = ((...args: Parameters<typeof updateDocSansLimite>) =>
  ecrire(updateDocSansLimite(...args))) as typeof updateDocSansLimite
const httpsCallable: typeof httpsCallableSansLimite = ((...args: Parameters<typeof httpsCallableSansLimite>) => {
  const appel = httpsCallableSansLimite(...args)
  return ((donnees?: unknown) => ecrire(appel(donnees))) as ReturnType<typeof httpsCallableSansLimite>
}) as typeof httpsCallableSansLimite
import { audienceQueryKeys } from '../../domain/audience'
import { enClair } from '../../erreurs'
import { patientIdentityOf } from '../../domain/session'
import type { ActivityProposal, ProposalDraft } from '../../domain/proposals'
import { versProposition } from './propositions'
import type {
  Appointment,
  AppointmentKind,
  AppointmentPreference,
  Category,
  LocalDate,
  Location,
  Occurrence,
  Practitioner,
  Service,
} from '../../domain/types'
import type {
  AppRepository,
  MyRegistration,
  PatientSession,
  RegisterResult,
} from '../ports'
import { firebase } from './app'
import { FIRST_NAME_KEY } from './keys'

const SIGNED_OUT: PatientSession = { patientUid: null, firstName: null, serviceId: null }

/** Le prénom n'est pas dans le jeton : il est conservé sur l'appareil, et effacé à la déconnexion. */

function toOccurrence(snapshot: DocumentSnapshot | QueryDocumentSnapshot): Occurrence {
  const data = snapshot.data() as Record<string, unknown>
  return {
    ...(data as Omit<Occurrence, 'id' | 'start' | 'end'>),
    id: snapshot.id,
    start: (data.start as Timestamp).toDate(),
    end: (data.end as Timestamp).toDate(),
  }
}

type MineLine = { occurrenceId: string; status: 'confirmed' | 'waitlist'; position: number | null }

export function createFirestoreRepository(): AppRepository {
  const { db, auth, functions } = firebase()

  let session: PatientSession = SIGNED_OUT
  let notifySessionReady: () => void = () => undefined
  // La première lecture attend que Firebase ait restauré la session : sans cela, le
  // calendrier partirait avec un service inconnu et ne renverrait rien.
  const sessionReady = new Promise<void>((resolve) => {
    notifySessionReady = resolve
  })

  const readSession = async (user: User | null): Promise<void> => {
    try {
      // Être connecté ne suffit pas : il faut l'être *en tant que patient*. Firebase ne
      // tient qu'une session par navigateur, partagée avec l'espace soignant. La règle
      // vit dans le domaine, testée : voir `patientIdentityOf`.
      const token = user === null ? null : await user.getIdTokenResult()
      const identite = patientIdentityOf(user?.uid ?? null, token?.claims ?? null)
      session =
        identite === null
          ? SIGNED_OUT
          : { ...identite, firstName: localStorage.getItem(FIRST_NAME_KEY) }
    } catch {
      // Le jeton n'a pas pu être relu — code régénéré, séjour terminé, réseau coupé.
      // On repart de la page du code plutôt que de laisser l'écran figé : c'est le seul
      // état dont la personne puisse sortir seule.
      session = SIGNED_OUT
      await signOut(auth).catch(() => undefined)
    } finally {
      // Quoi qu'il arrive, les lectures en attente doivent repartir. Sans ce `finally`,
      // une erreur ici laissait l'application sur « Un instant… » indéfiniment.
      notifySessionReady()
    }
  }

  onAuthStateChanged(auth, (user) => {
    void readSession(user)
  })

  /**
   * Filet de sécurité : si Firebase ne rend jamais la main — réseau coupé au démarrage,
   * service injoignable — on repart au bout de six secondes comme si personne n'était
   * connecté. Mieux vaut redemander le code qu'un écran qui ne bouge plus, et six
   * secondes à regarder « Un instant… » sont déjà très longues sur un téléphone.
   */
  setTimeout(() => notifySessionReady(), 6_000)

  /**
   * Les positions en liste d'attente exigent de lire les inscriptions des autres :
   * seules les Cloud Functions y ont accès. Hors ligne, on se rabat sur les siennes,
   * lues dans le cache local — sans position, plutôt qu'avec une position fausse.
   */
  let mineCache: { at: number; lines: MineLine[] } | null = null

  const loadMine = async (force = false): Promise<MineLine[]> => {
    await sessionReady
    if (session.patientUid === null) return []
    if (!force && mineCache !== null && Date.now() - mineCache.at < 5_000) return mineCache.lines

    try {
      const call = httpsCallable<unknown, { registrations: MineLine[] }>(functions, 'myRegistrations')
      const lines = (await call({})).data.registrations
      mineCache = { at: Date.now(), lines }
      return lines
    } catch {
      const snapshot = await getDocs(
        query(collection(db, 'registrations'), where('patientUid', '==', session.patientUid)),
      )
      const lines = snapshot.docs
        .map((document) => document.data() as { occurrenceId: string; status: string })
        .filter((r) => r.status === 'confirmed' || r.status === 'waitlist')
        .map((r) => ({
          occurrenceId: r.occurrenceId,
          status: r.status as 'confirmed' | 'waitlist',
          position: null,
        }))
      mineCache = { at: Date.now(), lines }
      return lines
    }
  }

  const occurrenceById = async (occurrenceId: string): Promise<Occurrence | null> => {
    try {
      const snapshot = await getDoc(doc(db, 'occurrences', occurrenceId))
      return snapshot.exists() ? toOccurrence(snapshot) : null
    } catch {
      // Refus des règles : l'activité appartient à un autre service. Même réponse que
      // « elle n'existe pas » — ne pas révéler qu'elle existe.
      return null
    }
  }

  const callAndMap = async <T>(name: string, payload: unknown, onError: string): Promise<T | { ok: false; reason: string; message: string }> => {
    try {
      const call = httpsCallable<unknown, T>(functions, name)
      return (await call(payload)).data
    } catch (error) {
      const message = error instanceof Error && 'message' in error ? String(error.message) : onError
      return { ok: false, reason: 'appel', message: message.replace(/^.*?:\s*/, '') || onError }
    }
  }

  return {
    catalog: {
      async listLocations(): Promise<Location[]> {
        const snapshot = await getDocs(query(collection(db, 'locations'), orderBy('name')))
        return snapshot.docs.map((d) => ({ ...(d.data() as Omit<Location, 'id'>), id: d.id }))
      },
      async listCategories(): Promise<Category[]> {
        const snapshot = await getDocs(collection(db, 'categories'))
        return snapshot.docs.map((d) => ({ ...(d.data() as Omit<Category, 'id'>), id: d.id }))
      },
      async listPractitioners(): Promise<Practitioner[]> {
        const snapshot = await getDocs(query(collection(db, 'practitioners'), orderBy('name')))
        return snapshot.docs.map((d) => ({ ...(d.data() as Omit<Practitioner, 'id'>), id: d.id }))
      },
      async listServices(): Promise<Service[]> {
        const snapshot = await getDocs(query(collection(db, 'services'), orderBy('name')))
        return snapshot.docs.map((d) => ({ ...(d.data() as Omit<Service, 'id'>), id: d.id }))
      },
    },

    occurrences: {
      async listBetween(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
        await sessionReady
        if (session.patientUid === null) return []
        // Une seule requête, filtrée sur le service : c'est aussi la seule que les règles
        // acceptent. Sans le filtre `audienceKeys`, Firestore refuse la requête entière.
        const snapshot = await getDocs(
          query(
            collection(db, 'occurrences'),
            where('audienceKeys', 'array-contains-any', audienceQueryKeys(session.serviceId)),
            where('localDate', '>=', from),
            where('localDate', '<=', to),
            orderBy('localDate'),
            orderBy('start'),
          ),
        )
        return snapshot.docs.map(toOccurrence)
      },

      get: occurrenceById,
    },

    registrations: {
      async listMine(): Promise<MyRegistration[]> {
        const lines = await loadMine()
        const occurrences = await Promise.all(lines.map((line) => occurrenceById(line.occurrenceId)))
        return lines
          .map((line, index) => ({ line, occurrence: occurrences[index] }))
          .filter((entry): entry is { line: MineLine; occurrence: Occurrence } => entry.occurrence != null)
          .map(({ line, occurrence }) => ({
            occurrence,
            status: line.status,
            position: line.position,
          }))
          .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime())
      },

      async statusFor(occurrenceId: string): Promise<MyRegistration | null> {
        const lines = await loadMine()
        const line = lines.find((l) => l.occurrenceId === occurrenceId)
        if (line === undefined) return null
        const occurrence = await occurrenceById(occurrenceId)
        return occurrence === null ? null : { occurrence, status: line.status, position: line.position }
      },

      async register(occurrenceId: string): Promise<RegisterResult> {
        const result = await callAndMap<RegisterResult>(
          'register',
          { occurrenceId },
          "L'inscription n'a pas pu être enregistrée. Réessayez dans un instant.",
        )
        mineCache = null
        return result as RegisterResult
      },

      async unregister(occurrenceId: string): Promise<{ ok: boolean; message: string }> {
        const result = await callAndMap<{ ok: boolean; message: string }>(
          'unregister',
          { occurrenceId },
          "La désinscription n'a pas pu être enregistrée. Réessayez dans un instant.",
        )
        mineCache = null
        return result as { ok: boolean; message: string }
      },

      async warmRegistration(): Promise<void> {
        /*
          Deux appels vides, sans conséquence : les deux fonctions se lèvent pendant qu'on
          lit la fiche. « S'inscrire » et « se désinscrire » sont deux fonctions
          distinctes, et l'on peut arriver sur la fiche pour l'une comme pour l'autre —
          ne réveiller que la première laissait la seconde payer son démarrage.
        */
        await Promise.all(
          ['register', 'unregister'].map((nom) =>
            httpsCallable(functions, nom)({ warm: true }).catch(() => undefined),
          ),
        )
      },
    },

    /**
     * Les idées d'activité. Les règles laissent chacun lire les siennes — c'est une
     * lecture directe, sans fonction, donc sans démarrage à froid. Déposer, en revanche,
     * passe par une fonction : la longueur des textes et la règle « une seule idée en
     * attente » ne peuvent pas être garanties par un navigateur.
     */
    proposals: {
      async listMine(): Promise<ActivityProposal[]> {
        await sessionReady
        if (session.patientUid === null) return []
        try {
          // `getDocs` est déjà borné dans le temps ici (voir en haut du fichier) : le
          // réenvelopper poserait deux minuteries sur la même lecture.
          const snapshot = await getDocs(
            query(collection(db, 'proposals'), where('patientUid', '==', session.patientUid)),
          )
          return snapshot.docs
            .map((d) => versProposition(d.id, d.data() as Record<string, unknown>))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        } catch {
          // Une idée qu'on n'arrive pas à relire ne doit pas condamner l'écran.
          return []
        }
      },

      async submit(draft: ProposalDraft): Promise<{ ok: boolean; message: string }> {
        const resultat = await callAndMap<{ ok: boolean; message?: string }>(
          'proposeActivity',
          { ...draft },
          "Votre idée n'a pas pu être envoyée. Réessayez dans un instant.",
        )
        return {
          ok: resultat.ok === true,
          message: resultat.message ?? 'Votre idée est envoyée. Un soignant va la lire.',
        }
      },

      async warmProposal(): Promise<void> {
        await httpsCallable(functions, 'proposeActivity')({ warm: true }).catch(() => undefined)
      },
    },

    /**
     * Rendez-vous. Contrairement aux inscriptions, il n'y a pas de capacité à défendre :
     * aucune transaction n'est nécessaire, et les règles suffisent à garantir qu'un
     * patient ne demande que pour lui-même et ne fixe jamais la date.
     */
    appointments: {
      async listKinds(): Promise<AppointmentKind[]> {
        const snapshot = await getDocs(query(collection(db, 'appointmentKinds'), orderBy('name')))
        return snapshot.docs
          .map((d) => ({ ...(d.data() as Omit<AppointmentKind, 'id'>), id: d.id }))
          .filter((k) => k.isActive)
      },

      async listMine(): Promise<Appointment[]> {
        await sessionReady
        if (session.patientUid === null) return []
        const snapshot = await getDocs(
          query(collection(db, 'appointments'), where('patientUid', '==', session.patientUid)),
        )
        return snapshot.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>
            return {
              ...(data as Omit<Appointment, 'id' | 'createdAt' | 'start' | 'end'>),
              id: d.id,
              createdAt: (data.createdAt as Timestamp).toDate(),
              ...(data.start ? { start: (data.start as Timestamp).toDate() } : {}),
              ...(data.end ? { end: (data.end as Timestamp).toDate() } : {}),
            }
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      },

      /**
       * La demande passe par le serveur, et non plus par une écriture directe.
       *
       * Savoir s'il reste une place chez quelqu'un suppose de lire son agenda, ce qu'un
       * patient ne verra jamais : c'est donc la fonction appelable qui décide, et qui
       * répond soit « c'est noté, mardi à 9 heures », soit « un soignant vous dira quand ».
       */
      async request(kindId: string, preference: AppointmentPreference) {
        await sessionReady
        if (session.patientUid === null) {
          return { ok: false, message: 'Saisissez votre code pour demander un rendez-vous.' }
        }
        try {
          const call = httpsCallable<
            { kindId: string; preference: AppointmentPreference },
            { ok: boolean; scheduled: boolean; message: string }
          >(functions, 'requestAppointment')
          const reponse = (await call({ kindId, preference })).data
          mineCache = null
          return reponse
        } catch (error) {
          return { ok: false, message: enClair(error) }
        }
      },

      async withdraw(appointmentId: string) {
        try {
          await updateDoc(doc(db, 'appointments', appointmentId), { status: 'cancelled' })
          return { ok: true, message: 'Votre demande est retirée.' }
        } catch {
          return { ok: false, message: "Cette demande n'a pas pu être retirée." }
        }
      },

      async warmRequest(): Promise<void> {
        // Voir `warmRegistration` : un appel vide pendant qu'on choisit son motif.
        await httpsCallable(functions, 'requestAppointment')({ warm: true }).catch(() => undefined)
      },
    },

    session: {
      current(): PatientSession {
        return session
      },

      async warmSignIn() {
        try {
          const call = httpsCallable<{ warm: boolean }, unknown>(functions, 'exchangeCode')
          await call({ warm: true })
        } catch {
          // Un réveil raté n'est pas un problème : il n'y avait rien à faire.
        }
      },

      async signInWithCode(code: string) {
        try {
          const call = httpsCallable<{ code: string }, { token: string; firstName: string; serviceId: string }>(
            functions,
            'exchangeCode',
          )
          const { token, firstName } = (await call({ code })).data
          localStorage.setItem(FIRST_NAME_KEY, firstName)
          const credential = await signInWithCustomToken(auth, token)
          await readSession(credential.user)
          mineCache = null
          return { ok: true as const }
        } catch (error) {
          const raw = error instanceof Error ? error.message : ''
          return {
            ok: false as const,
            message:
              raw.replace(/^.*?:\s*/, '') ||
              "Ce code n'est pas reconnu. Demandez un nouveau code à un soignant.",
          }
        }
      },

      async signOut(): Promise<void> {
        localStorage.removeItem(FIRST_NAME_KEY)
        mineCache = null
        await signOut(auth)
        session = SIGNED_OUT
      },
    },
  }
}
