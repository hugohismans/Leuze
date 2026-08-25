import type { Firestore } from 'firebase-admin/firestore'
import { isVisibleToService } from '../domain/audience'
import { registrationBlockMessage } from '../domain/capacity'
import type { Occurrence, Registration } from '../domain/types'
import {
  register as domainRegister,
  promote as domainPromote,
  unregister as domainUnregister,
  rosterOf,
  type Board,
} from '../domain/waitlist'
import { conflictsWith, localDateOfOccurrenceId, type BusyEntry } from '../domain/conflicts'
import { kindName } from '../domain/appointments'
import { COLLECTIONS, docToOccurrence, docToRegistration, registrationToDoc } from './firestore'

/**
 * Inscriptions : tout passe par une transaction, jamais par une lecture suivie d'une écriture.
 *
 * Deux patients qui touchent la dernière place au même instant, cela arrivera : sur une
 * borne en salle commune, c'est même le cas courant. La transaction relit les compteurs,
 * la fonction pure `register()` tranche, et l'écriture n'aboutit que si rien n'a bougé
 * entre-temps. Sinon Firestore rejoue la transaction.
 */

export type RegisterOutput =
  | {
      ok: true
      status: 'confirmed' | 'waitlist'
      position: number | null
      /**
       * L'inscription créée. Rendue pour que l'appel puisse noter la présence sans
       * repartir la chercher : il venait d'écrire ce document, et le relisait aussitôt.
       */
      registrationId: string
    }
  | { ok: false; reason: string; message: string }

export type UnregisterOutput = { ok: boolean; message: string }

async function readBoard(
  database: Firestore,
  transaction: FirebaseFirestore.Transaction,
  occurrenceId: string,
): Promise<Board | null> {
  const occurrenceReference = database.collection(COLLECTIONS.occurrences).doc(occurrenceId)
  const occurrenceSnapshot = await transaction.get(occurrenceReference)
  if (!occurrenceSnapshot.exists) return null

  const registrationsSnapshot = await transaction.get(
    database.collection(COLLECTIONS.registrations).where('occurrenceId', '==', occurrenceId),
  )
  return {
    occurrence: docToOccurrence(occurrenceSnapshot),
    registrations: registrationsSnapshot.docs.map(docToRegistration),
  }
}

function writeCounters(
  database: Firestore,
  transaction: FirebaseFirestore.Transaction,
  occurrence: Occurrence,
): void {
  transaction.update(database.collection(COLLECTIONS.occurrences).doc(occurrence.id), {
    confirmedCount: occurrence.confirmedCount,
    waitlistCount: occurrence.waitlistCount,
  })
}

/**
 * Ce qui occupe déjà quelqu'un, le jour d'une séance donnée.
 *
 * Trois lectures, et pas une de plus. Les inscriptions d'une personne tiennent en
 * quelques dizaines de lignes, et le jour se lit dans l'identifiant de l'occurrence —
 * inutile d'aller chercher les séances d'un autre jour. Les rendez-vous sont filtrés sur
 * la date, qui est stockée telle quelle.
 *
 * Les motifs de rendez-vous sont lus pour nommer ce qui bloque : « Rendez-vous avec le
 * psychiatre » se comprend, « rdv kind-3 » ne se comprend pas.
 */
export async function busyOn(
  database: Firestore,
  patientUid: string,
  localDate: string,
  ignoreOccurrenceId?: string,
  /*
    Le service qui lira ces libellés, quand c'est le patient qui les lit.

    `label` porte le titre de l'activité, et cet agenda ressort tel quel dans
    l'avertissement de chevauchement : « Vous avez déjà Groupe des sortants à cette
    heure-là ». Le titre franchissait la cloison par ce chemin, alors que le calendrier
    et « Mes inscriptions » venaient d'apprendre à le retenir. Le cas se produit sans que
    personne s'y trompe : quelqu'un change d'unité, ou l'audience d'une activité est
    resserrée après son inscription.

    Absent — c'est le cas du soignant —, rien n'est filtré : il voit déjà tout le
    programme, et lui cacher un titre ne protégerait personne.
  */
  visiblePour?: { serviceId: string | null },
): Promise<BusyEntry[]> {
  const [inscriptions, rendezVous] = await Promise.all([
    database.collection(COLLECTIONS.registrations).where('patientUid', '==', patientUid).get(),
    database
      .collection(COLLECTIONS.appointments)
      .where('patientUid', '==', patientUid)
      .where('localDate', '==', localDate)
      .get(),
  ])

  const memeJour = inscriptions.docs
    .map(docToRegistration)
    .filter((r) => r.status !== 'cancelled' && r.occurrenceId !== ignoreOccurrenceId)
    .filter((r) => localDateOfOccurrenceId(r.occurrenceId) === localDate)

  /*
    Les séances du jour et les motifs de rendez-vous se lisent en même temps.

    Ils ne dépendent pas l'un de l'autre, et pourtant on les attendait l'un après l'autre :
    deux allers-retours là où un suffit. Sur un téléphone en 4G, cela se compte en dixièmes
    de seconde, et cela tombe juste avant que le bouton ne réponde.

    Les motifs ne sont lus que si un rendez-vous du jour n'a personne d'attitré : un
    rendez-vous fixé porte le nom de la personne, et « Rendez-vous avec Docteur Lemaire »
    n'a besoin d'aucune lecture de plus.
  */
  const aNommer = rendezVous.docs.some(
    (d) => d.data()['status'] === 'scheduled' && typeof d.data()['withWhom'] !== 'string',
  )
  const [seances, motifsBruts] = await Promise.all([
    memeJour.length === 0
      ? Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[])
      : database.getAll(
          ...memeJour.map((r) => database.collection(COLLECTIONS.occurrences).doc(r.occurrenceId)),
        ),
    aNommer
      ? database.collection(COLLECTIONS.appointmentKinds).get()
      : Promise.resolve(null),
  ])

  const occupe: BusyEntry[] = []
  for (const document of seances) {
    if (!document.exists) continue
    const occurrence = docToOccurrence(document)
    // Une séance annulée n'occupe plus personne.
    if (occurrence.status === 'cancelled') continue
    if (visiblePour !== undefined && !isVisibleToService(occurrence, visiblePour.serviceId)) continue
    occupe.push({
      start: occurrence.start,
      end: occurrence.end,
      label: occurrence.title,
      kind: 'activity',
    })
  }

  const motifs = (motifsBruts?.docs ?? []).map((d) => ({
    id: d.id,
    name: (d.data()['name'] as string) ?? '',
    icon: '',
    isActive: true,
  }))

  for (const document of rendezVous.docs) {
    const data = document.data()
    if (data['status'] !== 'scheduled') continue
    const debut = data['start'] as FirebaseFirestore.Timestamp | undefined
    const fin = data['end'] as FirebaseFirestore.Timestamp | undefined
    if (debut === undefined || fin === undefined) continue
    const qui = (data['withWhom'] as string | undefined) ?? kindName(motifs, data['kindId'] as string)
    occupe.push({
      start: debut.toDate(),
      end: fin.toDate(),
      label: `Rendez-vous avec ${qui}`,
      kind: 'appointment',
    })
  }
  return occupe
}

/**
 * Ce qui occupe une personne sur une période, en trois lectures.
 *
 * `busyOn` répond pour un jour ; l'appeler vingt-deux fois d'affilée ferait quarante-quatre
 * requêtes pour une seule question. Ici, les inscriptions et les rendez-vous sont lus une
 * fois, puis répartis.
 */
export async function busyBetween(
  database: Firestore,
  patientUid: string,
  from: string,
  to: string,
): Promise<BusyEntry[]> {
  const [inscriptions, rendezVous] = await Promise.all([
    database.collection(COLLECTIONS.registrations).where('patientUid', '==', patientUid).get(),
    database
      .collection(COLLECTIONS.appointments)
      .where('patientUid', '==', patientUid)
      .where('localDate', '>=', from)
      .where('localDate', '<=', to)
      .get(),
  ])

  const dansLaPeriode = inscriptions.docs
    .map(docToRegistration)
    .filter((r) => r.status !== 'cancelled')
    .filter((r) => {
      const jour = localDateOfOccurrenceId(r.occurrenceId)
      return jour !== null && jour >= from && jour <= to
    })

  const seances =
    dansLaPeriode.length === 0
      ? []
      : await database.getAll(
          ...dansLaPeriode.map((r) => database.collection(COLLECTIONS.occurrences).doc(r.occurrenceId)),
        )

  const occupe: BusyEntry[] = []
  for (const document of seances) {
    if (!document.exists) continue
    const occurrence = docToOccurrence(document)
    if (occurrence.status === 'cancelled') continue
    occupe.push({ start: occurrence.start, end: occurrence.end, label: occurrence.title, kind: 'activity' })
  }

  const motifs = rendezVous.empty
    ? []
    : (await database.collection(COLLECTIONS.appointmentKinds).get()).docs.map((d) => ({
        id: d.id,
        name: (d.data()['name'] as string) ?? '',
        icon: '',
        isActive: true,
      }))

  for (const document of rendezVous.docs) {
    const data = document.data()
    if (data['status'] !== 'scheduled') continue
    const debut = data['start'] as FirebaseFirestore.Timestamp | undefined
    const fin = data['end'] as FirebaseFirestore.Timestamp | undefined
    if (debut === undefined || fin === undefined) continue
    const qui = (data['withWhom'] as string | undefined) ?? kindName(motifs, data['kindId'] as string)
    occupe.push({
      start: debut.toDate(),
      end: fin.toDate(),
      label: `Rendez-vous avec ${qui}`,
      kind: 'appointment',
    })
  }
  return occupe
}

/**
 * Ce qui tombe en même temps qu'une séance, pour la personne visée. Liste vide quand la
 * séance est introuvable : c'est la transaction qui le dira, pas ce contrôle-ci.
 */
export async function conflictsFor(
  database: Firestore,
  patientUid: string,
  occurrenceId: string,
  /** Le service du patient : ce qu'il lira ne doit pas franchir la cloison. */
  serviceId?: string | null,
): Promise<BusyEntry[]> {
  /*
    On lisait la séance, puis on regardait la journée de la personne — deux temps, alors
    qu'il n'y a rien à attendre : le jour se lit dans l'identifiant de la séance, qui est
    déterministe. Les deux partent donc ensemble.

    C'est le contrôle que paie le bouton « Je m'inscris » du patient, avant même que
    l'inscription ne commence. Chaque aller-retour économisé ici se voit à l'écran.
  */
  const jour = localDateOfOccurrenceId(occurrenceId)
  // Forme d'identifiant inattendue : on n'invente pas d'avertissement. La transaction
  // dira, elle, si la séance existe.
  if (jour === null) return []

  const [snapshot, occupe] = await Promise.all([
    database.collection(COLLECTIONS.occurrences).doc(occurrenceId).get(),
    busyOn(
      database,
      patientUid,
      jour,
      occurrenceId,
      serviceId === undefined ? undefined : { serviceId },
    ),
  ])
  if (!snapshot.exists) return []
  const occurrence = docToOccurrence(snapshot)
  return conflictsWith({ start: occurrence.start, end: occurrence.end }, occupe)
}

/**
 * Les seuls chevauchements qui arrêtent une inscription prise en réunion : les rendez-vous.
 *
 * Deux lectures, menées de front, et pas une de plus. C'est la question posée à chaque
 * prénom cliqué pendant la réunion du lundi — dix fois de suite, sur une tablette, en
 * salle commune. Elle doit coûter le moins possible : le jour de la séance se lit dans
 * son identifiant, qui est déterministe, donc la requête sur les rendez-vous part sans
 * attendre la séance elle-même.
 *
 * Les autres activités ne sont pas regardées. Deux activités qui se chevauchent, on le
 * dit sans l'interdire (voir `domain/conflicts.ts`) : les chercher revenait à lire toutes
 * les inscriptions de la personne, puis toutes les séances correspondantes, avant chaque
 * clic — trois allers-retours pour une information qui n'empêchait rien.
 *
 * Le motif du rendez-vous n'est lu que si l'on s'apprête à refuser : nommer ce qui bloque
 * vaut une lecture, l'immense majorité des clics n'a pas à la payer.
 */
export async function appointmentConflictsFor(
  database: Firestore,
  patientUid: string,
  occurrenceId: string,
): Promise<BusyEntry[]> {
  const jour = localDateOfOccurrenceId(occurrenceId)
  // Forme d'identifiant inattendue : on ne sait pas quel jour regarder. On n'invente pas
  // un refus, la transaction fera foi.
  if (jour === null) return []

  const [snapshot, rendezVous] = await Promise.all([
    database.collection(COLLECTIONS.occurrences).doc(occurrenceId).get(),
    database
      .collection(COLLECTIONS.appointments)
      .where('patientUid', '==', patientUid)
      .where('localDate', '==', jour)
      .get(),
  ])
  if (!snapshot.exists || rendezVous.empty) return []
  const occurrence = docToOccurrence(snapshot)

  const poses: Array<{ entry: BusyEntry; kindId: string }> = []
  for (const document of rendezVous.docs) {
    const data = document.data()
    if (data['status'] !== 'scheduled') continue
    const debut = data['start'] as FirebaseFirestore.Timestamp | undefined
    const fin = data['end'] as FirebaseFirestore.Timestamp | undefined
    if (debut === undefined || fin === undefined) continue
    poses.push({
      entry: {
        start: debut.toDate(),
        end: fin.toDate(),
        label: (data['withWhom'] as string | undefined) ?? '',
        kind: 'appointment',
      },
      kindId: (data['kindId'] as string | undefined) ?? '',
    })
  }

  const heurtes = poses.filter(({ entry }) =>
    conflictsWith({ start: occurrence.start, end: occurrence.end }, [entry]).length > 0,
  )
  if (heurtes.length === 0) return []

  // Un rendez-vous fixé porte le nom de la personne ; s'il ne l'a pas, on va chercher son
  // motif — mais seulement maintenant, et seulement s'il en manque un.
  const motifs = heurtes.every(({ entry }) => entry.label !== '')
    ? []
    : (await database.collection(COLLECTIONS.appointmentKinds).get()).docs.map((d) => ({
        id: d.id,
        name: (d.data()['name'] as string) ?? '',
        icon: '',
        isActive: true,
      }))

  return heurtes
    .map(({ entry, kindId }) => ({
      ...entry,
      label: `Rendez-vous avec ${entry.label === '' ? kindName(motifs, kindId) : entry.label}`,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

export async function registerTx(
  database: Firestore,
  options: {
    occurrenceId: string
    patientUid: string
    by: 'patient' | 'staff'
    /** Service du patient : vérifié ici aussi, car l'admin SDK ignore les règles. */
    serviceId?: string | null
    /** L'animateur accepte quelqu'un qui s'est présenté : voir `register` dans le domaine. */
    walkIn?: boolean
    /**
     * Le personnel assume un dépassement du nombre de places, en réunion. Le domaine
     * l'ignore pour une inscription faite par un patient : c'est là que la garantie vit,
     * pas dans l'appel.
     */
    overCapacity?: boolean
    now?: Date
  },
): Promise<RegisterOutput> {
  const now = options.now ?? new Date()
  return database.runTransaction(async (transaction) => {
    const board = await readBoard(database, transaction, options.occurrenceId)
    if (board === null) {
      return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
    }
    if (options.by === 'patient' && !isVisibleToService(board.occurrence, options.serviceId ?? null)) {
      // Même message que pour une activité inexistante : ne pas révéler qu'elle existe.
      return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
    }

    const registrationId = database.collection(COLLECTIONS.registrations).doc().id
    const outcome = domainRegister(board, options.patientUid, {
      now,
      registrationId,
      by: options.by,
      ...(options.walkIn === true ? { walkIn: true } : {}),
      ...(options.overCapacity === true ? { overCapacity: true } : {}),
    })
    if (!outcome.ok) {
      return {
        ok: false,
        reason: outcome.reason,
        message:
          outcome.reason === 'already-registered'
            ? options.by === 'staff'
              ? 'Cette personne est déjà inscrite.'
              : 'Vous êtes déjà inscrit à cette activité.'
            : // Le soignant lisait « Adressez-vous à un soignant ». Il l'est.
              registrationBlockMessage(outcome.reason, options.by),
      }
    }

    const created = outcome.board.registrations.find((r) => r.id === registrationId) as Registration
    transaction.set(
      database.collection(COLLECTIONS.registrations).doc(registrationId),
      registrationToDoc(created),
    )
    writeCounters(database, transaction, outcome.board.occurrence)
    return { ok: true, status: outcome.status, position: outcome.position, registrationId }
  })
}

export async function unregisterTx(
  database: Firestore,
  /*
    `by` dit à qui la réponse s'adresse.

    Le serveur répondait au soignant avec des phrases écrites pour le patient : « Vous
    n'êtes plus inscrit. » affiché à quelqu'un qui vient de retirer le prénom d'un autre.
    La démonstration disait « Retiré de la liste. » — l'écran montré la veille et l'écran
    du jour ne diraient donc pas la même chose. La transaction est partagée ; les phrases
    ne le sont plus.
  */
  options: { occurrenceId: string; patientUid: string; by?: 'patient' | 'staff' },
): Promise<UnregisterOutput> {
  const pourLeSoignant = options.by === 'staff'
  return database.runTransaction(async (transaction) => {
    const board = await readBoard(database, transaction, options.occurrenceId)
    if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }

    const outcome = domainUnregister(board, options.patientUid)
    if (!outcome.ok) {
      return {
        ok: false,
        message: pourLeSoignant
          ? "Cette personne n'était pas inscrite."
          : "Vous n'êtes pas inscrit à cette activité.",
      }
    }

    /*
      On annule le document que le domaine a désigné, et pas « une ligne annulée au nom de
      cette personne ».

      C'est la nuance qui manquait, et elle se voyait à l'écran : quelqu'un qui s'inscrit,
      se désinscrit, puis se réinscrit laisse derrière lui une ligne déjà annulée. En la
      cherchant par prénom et par statut, on retrouvait celle-là — on la réannulait, sans
      effet, et l'inscription en cours restait active. Le prénom se décochait le temps de
      l'aller-retour, puis se recochait tout seul à la relecture.
    */
    transaction.update(database.collection(COLLECTIONS.registrations).doc(outcome.cancelled.id), {
      status: 'cancelled',
    })
    // La place libérée revient au premier de la liste d'attente, dans la même transaction :
    // cela ne dépend pas du navigateur du patient qui se désinscrit.
    if (outcome.promoted) {
      transaction.update(database.collection(COLLECTIONS.registrations).doc(outcome.promoted.id), {
        status: 'confirmed',
      })
    }
    writeCounters(database, transaction, outcome.board.occurrence)
    return { ok: true, message: pourLeSoignant ? 'Retiré de la liste.' : 'Vous n’êtes plus inscrit.' }
  })
}

/** Promotion manuelle par un soignant (désistement annoncé de vive voix). */
export async function promoteTx(
  database: Firestore,
  options: { occurrenceId: string; patientUid: string },
): Promise<{ ok: boolean; message: string }> {
  return database.runTransaction(async (transaction) => {
    const board = await readBoard(database, transaction, options.occurrenceId)
    if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }

    const outcome = domainPromote(board, options.patientUid)
    if (!outcome.ok) return { ok: false, message: "Cette personne n'est pas sur la liste d'attente." }

    // Même précaution qu'à la désinscription : l'identifiant vient du domaine.
    transaction.update(database.collection(COLLECTIONS.registrations).doc(outcome.promoted.id), {
      status: 'confirmed',
    })
    writeCounters(database, transaction, outcome.board.occurrence)
    return { ok: true, message: 'La personne est inscrite.' }
  })
}

/**
 * Les inscriptions d'un patient, avec sa position dans les listes d'attente.
 *
 * La position ne peut pas être calculée côté navigateur : elle demande de lire les
 * inscriptions des autres, ce que les règles interdisent. D'où cette fonction.
 */
export async function myRegistrationsFor(
  database: Firestore,
  patientUid: string,
): Promise<Array<{ occurrenceId: string; status: 'confirmed' | 'waitlist'; position: number | null }>> {
  const mine = await database
    .collection(COLLECTIONS.registrations)
    .where('patientUid', '==', patientUid)
    .get()

  const active = mine.docs.map(docToRegistration).filter((r) => r.status !== 'cancelled')
  const lignes = await Promise.all(
    active.map(async (registration) => {
      if (registration.status === 'confirmed') {
        return { occurrenceId: registration.occurrenceId, status: 'confirmed' as const, position: null }
      }
      const queue = await database
        .collection(COLLECTIONS.registrations)
        .where('occurrenceId', '==', registration.occurrenceId)
        .where('status', '==', 'waitlist')
        .orderBy('queuedAt')
        .get()
      const index = queue.docs.findIndex((document) => document.id === registration.id)
      return {
        occurrenceId: registration.occurrenceId,
        status: 'waitlist' as const,
        position: index === -1 ? null : index + 1,
      }
    }),
  )
  return lignes
}

export type RosterLine = {
  patientUid: string
  firstName: string
  serviceId: string | null
  status: 'confirmed' | 'waitlist'
  position: number | null
  /** Renseignée seulement pour qui a le droit de faire l'appel. */
  attendance?: 'present' | 'absent'
}

/**
 * Liste des inscrits, réservée au personnel. Elle joint les prénoms, qui vivent dans
 * `patients` — collection qu'aucun client ne peut lire directement.
 */
export async function rosterFor(
  database: Firestore,
  occurrenceId: string,
  withAttendance = false,
  /**
   * La séance, quand celui qui appelle vient déjà de la lire — c'est le cas de la
   * fonction `staffRoster`, qui doit d'abord savoir si la personne a le droit de faire
   * l'appel. Sans cela le même document était lu deux fois de suite, pour rien.
   */
  occurrenceDejaLue?: FirebaseFirestore.DocumentSnapshot,
): Promise<RosterLine[]> {
  // La séance et ses inscriptions ne dépendent pas l'une de l'autre : elles partent
  // ensemble plutôt que l'une après l'autre.
  const [occurrenceSnapshot, registrationsSnapshot] = await Promise.all([
    occurrenceDejaLue ?? database.collection(COLLECTIONS.occurrences).doc(occurrenceId).get(),
    database.collection(COLLECTIONS.registrations).where('occurrenceId', '==', occurrenceId).get(),
  ])
  if (!occurrenceSnapshot.exists) return []

  const board: Board = {
    occurrence: docToOccurrence(occurrenceSnapshot),
    registrations: registrationsSnapshot.docs.map(docToRegistration),
  }
  const { confirmed, waitlist } = rosterOf(board)

  const uids = [...new Set([...confirmed, ...waitlist].map((r) => r.patientUid))]
  const patients = new Map<string, { firstName: string; serviceId: string }>()
  await Promise.all(
    uids.map(async (uid) => {
      const snapshot = await database.collection(COLLECTIONS.patients).doc(uid).get()
      if (snapshot.exists) patients.set(uid, snapshot.data() as { firstName: string; serviceId: string })
    }),
  )

  const presences = new Map<string, 'present' | 'absent'>()
  if (withAttendance) {
    for (const document of registrationsSnapshot.docs) {
      const valeur = document.data()['attendance']
      const uid = document.data()['patientUid']
      if ((valeur === 'present' || valeur === 'absent') && typeof uid === 'string') presences.set(uid, valeur)
    }
  }

  const line = (r: Registration, status: 'confirmed' | 'waitlist', position: number | null): RosterLine => ({
    patientUid: r.patientUid,
    firstName: patients.get(r.patientUid)?.firstName ?? 'Prénom inconnu',
    serviceId: patients.get(r.patientUid)?.serviceId ?? null,
    status,
    position,
    // Absente pour qui n'anime pas l'activité : l'appel ne regarde que lui.
    ...(presences.has(r.patientUid) ? { attendance: presences.get(r.patientUid) } : {}),
  })

  return [
    ...confirmed.map((r) => line(r, 'confirmed', null)),
    ...waitlist.map((r, index) => line(r, 'waitlist', index + 1)),
  ]
}
