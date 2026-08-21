/**
 * Espace soignant, branché sur Firestore.
 *
 * Particularité assumée : c'est ce code qui matérialise les occurrences, parce que le
 * plan gratuit de Firebase n'autorise pas les Cloud Functions. Il applique les mêmes
 * fonctions pures du domaine que la fonction `onActivityWritten`, et les règles Firestore
 * l'encadrent — il ne peut ni toucher aux compteurs de places, ni supprimer une
 * occurrence portant des inscriptions.
 *
 * Le jour où le projet passe en plan Blaze, la Cloud Function reprend ce travail sans
 * qu'il y ait rien à changer ici : les identifiants d'occurrence étant déterministes,
 * les deux chemins produisent exactement le même résultat.
 */
import {
  signInWithCustomToken,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth'
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import type { CatalogRemoval } from '../../domain/catalog'
import type { Account } from '../../domain/impersonation'
import { addMinutes, instantOf } from '../../domain/time'
import type { Activity, Appointment, LocalDate, LocalTime, Occurrence } from '../../domain/types'
import { generationWindow, planGeneration } from '../generation'
import type {
  NewPatientCode,
  StaffPatient,
  ActivityDraft,
  CatalogAdminService,
  GenerationReport,
  PatientPlanning,
  RosterLine,
  StaffApp,
  StaffIdentity,
  StaffRole,
  SuperAdminService,
} from '../staffPorts'
import { firebase } from './app'
import { FIRST_NAME_KEY } from './keys'

const SIGNED_OUT: StaffIdentity = {
  uid: null,
  email: null,
  firstName: null,
  role: null,
  practitionerId: null,
}

/** Les fonctions appelables renvoient leur message en français : on le laisse passer. */
function messageDErreur(error: unknown): string {
  const brut = error instanceof Error ? error.message : ''
  return brut.replace(/^.*?:\s*/, '') || "L'opération n'a pas abouti. Réessayez dans un instant."
}

function toOccurrence(snapshot: DocumentSnapshot | QueryDocumentSnapshot): Occurrence {
  const data = snapshot.data() as Record<string, unknown>
  return {
    ...(data as Omit<Occurrence, 'id' | 'start' | 'end'>),
    id: snapshot.id,
    start: (data.start as Timestamp).toDate(),
    end: (data.end as Timestamp).toDate(),
  }
}

const toDoc = (occurrence: Occurrence): Record<string, unknown> => {
  const { id: _id, start, end, ...rest } = occurrence
  return { ...rest, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
}

const toActivity = (snapshot: DocumentSnapshot | QueryDocumentSnapshot): Activity => ({
  ...(snapshot.data() as Omit<Activity, 'id'>),
  id: snapshot.id,
})

export function createFirestoreStaffApp(): StaffApp {
  const { db, auth, functions } = firebase()

  let identity: StaffIdentity = SIGNED_OUT
  let notifyReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    notifyReady = resolve
  })

  const readIdentity = async (user: User | null): Promise<void> => {
    try {
      await lireIdentite(user)
    } catch {
      identity = SIGNED_OUT
    } finally {
      // Même précaution que côté patient : une erreur ne doit pas figer l'écran.
      notifyReady()
    }
  }

  const lireIdentite = async (user: User | null): Promise<void> => {
    if (user === null) {
      identity = SIGNED_OUT
    } else {
      // Le rôle qui fait autorité est le « custom claim » du jeton, pas le document
      // `staff/` — un document ne décide jamais d'un droit.
      const token = await user.getIdTokenResult()
      const claim = token.claims['role']
      const role: StaffRole | null = claim === 'admin' || claim === 'staff' ? claim : null
      let firstName: string | null = null
      try {
        const fiche = await getDoc(doc(db, 'staff', user.uid))
        firstName = (fiche.data()?.['firstName'] as string | undefined) ?? null
      } catch {
        firstName = null
      }
      const lien = token.claims['practitionerId']
      identity = {
        uid: user.uid,
        email: user.email,
        firstName,
        role,
        practitionerId: typeof lien === 'string' && lien !== '' ? lien : null,
      }
    }
  }

  onAuthStateChanged(auth, (user) => {
    void readIdentity(user)
  })

  setTimeout(() => notifyReady(), 10_000)

  /** Relit les occurrences d'une activité sur la fenêtre, applique le plan, renvoie le compte rendu. */
  const regenerate = async (
    activityId: string,
    activity: Activity | null,
    options: { overrideFrom?: LocalDate } = {},
  ): Promise<GenerationReport> => {
    const window = generationWindow()
    const existing = await getDocs(
      query(
        collection(db, 'occurrences'),
        where('activityId', '==', activityId),
        where('localDate', '>=', window.from),
        where('localDate', '<=', window.to),
      ),
    )
    const plan = planGeneration(activity, existing.docs.map(toOccurrence), window, options)

    // Firestore refuse au-delà de 500 opérations par lot.
    let batch = writeBatch(db)
    let compte = 0
    const commit = async (): Promise<void> => {
      if (compte > 0) await batch.commit()
      batch = writeBatch(db)
      compte = 0
    }
    for (const occurrence of plan.write) {
      batch.set(doc(db, 'occurrences', occurrence.id), toDoc(occurrence))
      if (++compte >= 400) await commit()
    }
    for (const id of plan.remove) {
      batch.delete(doc(db, 'occurrences', id))
      if (++compte >= 400) await commit()
    }
    await commit()
    return plan.report
  }

  return {
    session: {
      current: () => identity,

      async signIn(email: string, password: string) {
        try {
          const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
          await readIdentity(credential.user)
          if (identity.role === null) {
            await signOut(auth)
            identity = SIGNED_OUT
            return {
              ok: false as const,
              message: "Ce compte n'a pas encore de rôle. Demandez à l'administrateur de vous l'attribuer.",
            }
          }
          return { ok: true as const }
        } catch {
          // Message unique : ne pas indiquer si c'est l'adresse ou le mot de passe.
          return { ok: false as const, message: "L'adresse ou le mot de passe ne correspond pas." }
        }
      },

      async signOut() {
        await signOut(auth)
        identity = SIGNED_OUT
      },
    },

    repository: {
      async listActivities(): Promise<Activity[]> {
        await ready
        const snapshot = await getDocs(query(collection(db, 'activities'), orderBy('title')))
        return snapshot.docs.map(toActivity)
      },

      async getActivity(activityId: string): Promise<Activity | null> {
        const snapshot = await getDoc(doc(db, 'activities', activityId))
        return snapshot.exists() ? toActivity(snapshot) : null
      },

      async saveActivity(draft: ActivityDraft) {
        const activityId = draft.id ?? doc(collection(db, 'activities')).id
        const seriesId = draft.seriesId ?? `serie-${activityId}`
        const { id: _ignored, ...fields } = draft
        const activity: Activity = { ...(fields as Omit<Activity, 'id'>), id: activityId, seriesId }

        const { id: _dropped, ...stored } = activity
        await setDoc(doc(db, 'activities', activityId), stored, { merge: false })
        const report = await regenerate(activityId, activity)
        return { activityId, report }
      },

      async setActivityActive(activityId: string, isActive: boolean): Promise<GenerationReport> {
        await updateDoc(doc(db, 'activities', activityId), { isActive })
        const activity = await getDoc(doc(db, 'activities', activityId))
        return regenerate(activityId, activity.exists() ? toActivity(activity) : null)
      },

      async duplicateActivity(activityId: string): Promise<string> {
        const source = await getDoc(doc(db, 'activities', activityId))
        if (!source.exists()) throw new Error("Cette activité n'existe plus.")
        const copie = toActivity(source)
        const nouvelId = doc(collection(db, 'activities')).id
        const { id: _id, seriesId: _serie, ...reste } = copie
        // La copie est créée inactive : elle ne part pas au calendrier avant relecture.
        await setDoc(doc(db, 'activities', nouvelId), {
          ...reste,
          title: `${copie.title} (copie)`,
          seriesId: `serie-${nouvelId}`,
          isActive: false,
        })
        return nouvelId
      },

      async deleteActivity(activityId: string): Promise<CatalogRemoval> {
        // Les inscriptions ne sont pas lisibles côté client : le serveur seul peut dire
        // si l'activité a déjà réuni quelqu'un.
        const call = httpsCallable<{ activityId: string }, CatalogRemoval>(functions, 'deleteActivity')
        return (await call({ activityId })).data
      },

      async listOccurrences(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
        await ready
        // Le personnel voit tout le programme : pas de filtre de service ici.
        const snapshot = await getDocs(
          query(
            collection(db, 'occurrences'),
            where('localDate', '>=', from),
            where('localDate', '<=', to),
            orderBy('localDate'),
            orderBy('start'),
          ),
        )
        return snapshot.docs.map(toOccurrence)
      },

      async cancelOccurrence(occurrenceId: string, reason: string): Promise<void> {
        // Jamais de suppression : l'occurrence reste visible, barrée, avec son motif.
        await updateDoc(doc(db, 'occurrences', occurrenceId), {
          status: 'cancelled',
          cancellationReason: reason,
          overridden: true,
        })
      },

      async weekPlannings(from: LocalDate, to: LocalDate, serviceId?: string): Promise<PatientPlanning[]> {
        const call = httpsCallable<
          { from: string; to: string; serviceId?: string },
          { plannings: PatientPlanning[] }
        >(functions, 'staffWeekPlannings')
        return (await call({ from, to, ...(serviceId === undefined ? {} : { serviceId }) })).data.plannings
      },

      async restoreOccurrence(occurrenceId: string): Promise<void> {
        await updateDoc(doc(db, 'occurrences', occurrenceId), {
          status: 'scheduled',
          cancellationReason: '',
          overridden: true,
        })
      },

      async roster(occurrenceId: string) {
        try {
          const call = httpsCallable<
            { occurrenceId: string },
            { lines: RosterLine[]; canMarkAttendance: boolean }
          >(functions, 'staffRoster')
          return (await call({ occurrenceId })).data
        } catch {
          // Sans Cloud Functions (plan gratuit), les prénoms ne sont pas servis :
          // il n'y a de toute façon pas encore d'inscriptions.
          return { lines: [], canMarkAttendance: false }
        }
      },

      async markAttendance(occurrenceId, patientUid, attendance) {
        try {
          const call = httpsCallable<
            { occurrenceId: string; patientUid: string; attendance: 'present' | 'absent' | null },
            { ok: boolean; message: string }
          >(functions, 'markAttendance')
          return (await call({ occurrenceId, patientUid, attendance })).data
        } catch (error) {
          return { ok: false, message: messageDErreur(error) }
        }
      },

      /**
       * Les trois appels de la réunion du lundi. Ils passent tous par des fonctions
       * appelables : l'inscription touche à la capacité, elle ne se fait donc jamais
       * par une écriture directe depuis un navigateur, fût-il celui d'un soignant.
       */
      async listPatients(): Promise<StaffPatient[]> {
        try {
          const call = httpsCallable<unknown, { patients: (Omit<StaffPatient, 'expiresAt'> & { expiresAt?: string })[] }>(
            functions,
            'staffPatients',
          )
          return (await call({})).data.patients.map(({ expiresAt, ...patient }) => ({
            ...patient,
            ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
          }))
        } catch {
          return []
        }
      },

      /**
       * Création d'un patient et de son code. Le code en clair ne transite qu'ici, une
       * seule fois : la base n'en garde que l'empreinte, dérivée avec un poivre secret.
       */
      async createPatient(firstName: string, serviceId: string): Promise<NewPatientCode> {
        const call = httpsCallable<
          { firstName: string; serviceId: string },
          { uid: string; code: string; printableCode: string; expiresAt: string }
        >(functions, 'createPatientCode')
        const data = (await call({ firstName, serviceId })).data
        return { ...data, firstName, expiresAt: new Date(data.expiresAt) }
      },

      async regenerateCode(patientUid: string): Promise<NewPatientCode> {
        const call = httpsCallable<
          { patientUid: string },
          { uid: string; firstName: string; code: string; printableCode: string; expiresAt: string }
        >(functions, 'regeneratePatientCode')
        const data = (await call({ patientUid })).data
        return { ...data, expiresAt: new Date(data.expiresAt) }
      },

      async endStay(patientUid: string) {
        try {
          const call = httpsCallable<{ patientUid: string }, { ok: boolean; message: string }>(
            functions,
            'endPatientStay',
          )
          return (await call({ patientUid })).data
        } catch (error) {
          return { ok: false, message: messageDErreur(error) }
        }
      },

      async registerPatient(occurrenceId: string, patientUid: string) {
        try {
          const call = httpsCallable<
            { occurrenceId: string; patientUid: string },
            { ok: boolean; status?: 'confirmed' | 'waitlist'; message?: string }
          >(functions, 'staffRegister')
          const resultat = (await call({ occurrenceId, patientUid })).data
          return {
            ok: resultat.ok,
            ...(resultat.status ? { status: resultat.status } : {}),
            message:
              resultat.message ?? (resultat.status === 'waitlist' ? "Sur la liste d'attente" : 'Inscrit'),
          }
        } catch (error) {
          return { ok: false, message: messageDErreur(error) }
        }
      },

      /**
       * Rendez-vous : écritures directes, encadrées par les règles. Pas de capacité
       * à défendre, donc pas de fonction appelable — cela fonctionne sur le plan gratuit.
       */
      async listAppointments(): Promise<Appointment[]> {
        // Un intervenant n'a le droit de lire que son agenda : la requête doit porter la
        // contrainte, sinon les règles la rejettent en bloc plutôt que de la restreindre.
        // Un compte relié à personne n'a pas d'agenda du tout, et ne demande donc rien.
        const lien = identity.practitionerId
        const requete =
          identity.role === 'admin'
            ? collection(db, 'appointments')
            : lien === null || lien === ''
              ? null
              : query(collection(db, 'appointments'), where('practitionerId', '==', lien))
        if (requete === null) return []
        const snapshot = await getDocs(requete)
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
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      },

      async scheduleAppointment(
        appointmentId: string,
        rendezVous: {
          date: LocalDate
          time: LocalTime
          durationMin: number
          withWhom: string
          practitionerId?: string
          locationId?: string
        },
      ) {
        const start = instantOf(rendezVous.date, rendezVous.time)
        try {
          await updateDoc(doc(db, 'appointments', appointmentId), {
            status: 'scheduled',
            localDate: rendezVous.date,
            start: Timestamp.fromDate(start),
            end: Timestamp.fromDate(addMinutes(start, rendezVous.durationMin)),
            withWhom: rendezVous.withWhom,
            ...(rendezVous.practitionerId ? { practitionerId: rendezVous.practitionerId } : {}),
            ...(rendezVous.locationId ? { locationId: rendezVous.locationId } : {}),
          })
          return { ok: true, message: 'Rendez-vous fixé. Le patient le voit dans son calendrier.' }
        } catch {
          return { ok: false, message: "Le rendez-vous n'a pas pu être enregistré." }
        }
      },

      async createAppointment(rendezVous: {
        patientUid: string
        kindId: string
        date: LocalDate
        time: LocalTime
        durationMin: number
        withWhom: string
        practitionerId?: string
        locationId?: string
      }) {
        const start = instantOf(rendezVous.date, rendezVous.time)
        try {
          // Créé déjà fixé : il n'y a jamais eu de demande à transformer.
          await addDoc(collection(db, 'appointments'), {
            patientUid: rendezVous.patientUid,
            kindId: rendezVous.kindId,
            // Le moment souhaité n'a pas de sens ici : le rendez-vous est déjà posé.
            preference: 'peu-importe',
            status: 'scheduled',
            createdAt: Timestamp.now(),
            localDate: rendezVous.date,
            start: Timestamp.fromDate(start),
            end: Timestamp.fromDate(addMinutes(start, rendezVous.durationMin)),
            withWhom: rendezVous.withWhom,
            ...(rendezVous.practitionerId ? { practitionerId: rendezVous.practitionerId } : {}),
            ...(rendezVous.locationId ? { locationId: rendezVous.locationId } : {}),
          })
          return { ok: true, message: 'Rendez-vous fixé. Le patient le voit dans son calendrier.' }
        } catch {
          return { ok: false, message: "Le rendez-vous n'a pas pu être enregistré." }
        }
      },

      async cancelAppointment(appointmentId: string, reason: string) {
        try {
          await updateDoc(doc(db, 'appointments', appointmentId), {
            status: 'cancelled',
            cancellationReason: reason,
          })
          return { ok: true, message: 'Rendez-vous annulé.' }
        } catch {
          return { ok: false, message: "L'annulation n'a pas pu être enregistrée." }
        }
      },

      async unregisterPatient(occurrenceId: string, patientUid: string) {
        try {
          const call = httpsCallable<{ occurrenceId: string; patientUid: string }, { ok: boolean; message: string }>(
            functions,
            'staffUnregister',
          )
          return (await call({ occurrenceId, patientUid })).data
        } catch (error) {
          return { ok: false, message: messageDErreur(error) }
        }
      },
    },

    catalogAdmin: {
      async saveLocation(location) {
        const { id, ...reste } = location
        await setDoc(doc(db, 'locations', id), reste, { merge: true })
      },
      async saveService(service) {
        const { id, ...reste } = service
        await setDoc(doc(db, 'services', id), reste, { merge: true })
      },
      async saveCategory(category) {
        const { id, ...reste } = category
        await setDoc(doc(db, 'categories', id), reste, { merge: true })
      },
      async createStaffAccount(email, practitionerId) {
        try {
          const call = httpsCallable<
            { email: string; practitionerId: string },
            { password: string | null }
          >(functions, 'createStaffAccount')
          const { password } = (await call({ email, practitionerId })).data
          return {
            ok: true,
            message:
              password === null
                ? 'Compte existant relié. La personne doit se reconnecter.'
                : 'Accès créé. Notez le mot de passe : il ne sera plus affiché.',
            ...(password === null ? {} : { password }),
          }
        } catch (error) {
          return { ok: false, message: messageDErreur(error) }
        }
      },

      async savePractitioner(practitioner) {
        const { id, ...reste } = practitioner
        await setDoc(doc(db, 'practitioners', id), reste, { merge: true })
      },
      async removeEntry(kind, id) {
        // Le comptage des usages n'est pas faisable ici : les personnes ne sont pas
        // lisibles côté client. C'est le serveur qui décide entre supprimer et retirer.
        const call = httpsCallable<{ kind: string; id: string }, CatalogRemoval>(functions, 'removeCatalogEntry')
        return (await call({ kind, id })).data
      },
    },

    superAdmin: superAdmin(),
  }

  /**
   * Firebase ne tient qu'une session par navigateur : prendre la place de quelqu'un
   * remplace donc la sienne, pour de bon. C'est voulu — c'est la seule façon de voir
   * exactement ce que cette personne voit, règles Firestore comprises.
   */
  function superAdmin(): SuperAdminService {
    return {
      async listAccounts(): Promise<Account[]> {
        const call = httpsCallable<Record<string, never>, { accounts: Account[] }>(
          functions,
          'listAccounts',
        )
        return (await call({})).data.accounts
      },

      async impersonate(uid: string) {
        try {
          const call = httpsCallable<
            { uid: string },
            { token: string; back: string; label: string; kind: 'patient' | 'staff'; firstName: string }
          >(functions, 'impersonate')
          const { token, back, label, kind, firstName } = (await call({ uid })).data
          // Le prénom du patient est lu au même endroit que par `signInWithCode` :
          // sans lui, l'écran patient dirait « Bonjour » à personne.
          if (kind === 'patient') localStorage.setItem(FIRST_NAME_KEY, firstName)
          else localStorage.removeItem(FIRST_NAME_KEY)
          const credential = await signInWithCustomToken(auth, token)
          await readIdentity(credential.user)
          return { ok: true as const, label, kind, back }
        } catch (error) {
          return { ok: false as const, message: messageDErreur(error) }
        }
      },

      async resume(back: string) {
        try {
          localStorage.removeItem(FIRST_NAME_KEY)
          const credential = await signInWithCustomToken(auth, back)
          await readIdentity(credential.user)
          return { ok: true, message: 'Vous êtes revenu à votre compte.' }
        } catch {
          // Le jeton de retour ne vit qu'une heure. Passé ce délai, il faut se
          // reconnecter — on le dit, plutôt que de laisser l'écran sans réponse.
          await signOut(auth).catch(() => undefined)
          return {
            ok: false,
            message: 'Le retour a expiré. Connectez-vous à nouveau avec votre adresse.',
          }
        }
      },
    }
  }
}
