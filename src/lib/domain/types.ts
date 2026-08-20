/**
 * Types du domaine. Aucun import Firebase ici : ces types décrivent le métier,
 * pas le stockage. L'adapter Firestore convertit `Timestamp` <-> `Date` à la frontière.
 */

/** Date locale (fuseau Europe/Brussels) au format `yyyy-MM-dd`. */
export type LocalDate = string
/** Heure locale au format `HH:mm`. */
export type LocalTime = string
/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Un « service » au sens de l'hôpital : unité de soins (Le Mazurel, La Joncquerelle…)
 * ou service transversal (service culturel…). C'est le vocabulaire des soignants,
 * et c'est aussi ce qui décide *qui voit quoi* — voir `audience.ts`.
 */
export type Service = {
  id: string
  name: string
  isActive: boolean
}

/**
 * À qui s'adresse une activité.
 *  - `'all'`      : tous les services.
 *  - `'services'` : uniquement les services listés dans `serviceIds` (un, deux, trois…).
 * Une activité `'services'` avec une liste vide n'est visible par personne :
 * elle est traitée comme non publiée et signalée comme telle au soignant.
 */
export type AudienceKind = 'all' | 'services'

export type Location = {
  id: string
  name: string
  building?: string
  floor?: string
  description?: string
  /** Identifiant de la zone dans le SVG du plan (lot 5). */
  planZoneId?: string
  /** Indications pour s'y rendre, en français simple. */
  accessNotes?: string
  isActive: boolean
}

export type Category = {
  id: string
  name: string
  /** Emoji ou nom d'icône : l'information n'est jamais portée par la couleur seule. */
  icon: string
  /** Clé de token de couleur, pas une valeur hexadécimale (voir tokens.css). */
  colorToken: string
}

export type RecurrenceRule = {
  freq: 'weekly'
  /** Jours ISO concernés. « Yoga le mardi » => [2]. */
  byWeekday: IsoWeekday[]
  startTime: LocalTime
  durationMin: number
  /** Première date possible (incluse). */
  from: LocalDate
  /** Dernière date possible (incluse), ou `null` si la série n'a pas de fin. */
  until: LocalDate | null
  /** Dates sautées (congés, jours fériés). */
  skipDates: LocalDate[]
}

export type Activity = {
  id: string
  /** Toutes les activités issues d'une même série d'origine partagent ce `seriesId`. */
  seriesId: string
  title: string
  description: string
  categoryId: string
  locationId: string
  facilitator?: string
  audience: AudienceKind
  /** Vide quand `audience === 'all'`. */
  serviceIds: string[]
  /** `null` = places illimitées. */
  capacity: number | null
  registrationRequired: boolean
  /** Liste d'attente proposée quand l'activité est complète. */
  waitlistEnabled: boolean
  recurrence: RecurrenceRule | null
  /** Activité ponctuelle : date et heure uniques (recurrence === null). */
  singleStart?: { date: LocalDate; time: LocalTime; durationMin: number }
  isActive: boolean
}

export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'moved'

export type Occurrence = {
  /** Déterministe : `{activityId}_{yyyyMMdd}T{HHmm}`. Voir `occurrenceId()`. */
  id: string
  activityId: string
  seriesId: string
  start: Date
  end: Date
  /** Jour local, source de vérité pour le regroupement par jour dans le calendrier. */
  localDate: LocalDate
  // --- champs dénormalisés depuis l'activité, pour un calendrier en une requête ---
  title: string
  description: string
  categoryId: string
  locationId: string
  facilitator?: string
  /**
   * Clés d'audience dénormalisées : `['all']`, ou la liste des services autorisés.
   * Permet au calendrier de ne demander que ce que le patient a le droit de voir,
   * en une seule requête (`array-contains-any ['all', serviceDuPatient]`),
   * et aux règles de sécurité de vérifier la même chose.
   */
  audienceKeys: string[]
  capacity: number | null
  registrationRequired: boolean
  waitlistEnabled: boolean
  // --- état propre à l'occurrence ---
  status: OccurrenceStatus
  cancellationReason?: string
  /** Vrai dès qu'un soignant a modifié cette occurrence seule : la régénération l'épargne. */
  overridden: boolean
  confirmedCount: number
  waitlistCount: number
}

export type RegistrationStatus = 'confirmed' | 'waitlist' | 'cancelled'

export type Registration = {
  id: string
  occurrenceId: string
  /** UID Firebase Auth du patient. Aucun nom, aucune donnée de santé ici. */
  patientUid: string
  status: RegistrationStatus
  createdAt: Date
  /** Horodatage d'entrée en liste d'attente : fixe l'ordre de promotion. */
  queuedAt: Date
  createdBy: 'patient' | 'staff'
}

/**
 * Un motif de rendez-vous, au sens de « avec qui » : psychiatre, kinésithérapeute…
 * Administrable par les soignants, comme les lieux et les catégories.
 */
export type AppointmentKind = {
  id: string
  name: string
  /** Doublure de la couleur : l'information n'est jamais portée par la couleur seule. */
  icon: string
  isActive: boolean
}

export type AppointmentStatus = 'requested' | 'scheduled' | 'cancelled'

/** Moment souhaité par le patient. Volontairement grossier : ce n'est qu'une préférence. */
export type AppointmentPreference = 'matin' | 'apres-midi' | 'peu-importe'

/**
 * Un rendez-vous individuel, demandé par un patient puis fixé par un soignant.
 *
 * ⚠️ Aucun champ libre, ni côté patient ni côté soignant. Un motif de rendez-vous est
 * déjà une information sensible ; un texte libre à côté deviendrait immanquablement le
 * réceptacle de contenu clinique, ce que ce projet s'interdit. Le patient dit **qui** il
 * veut voir, jamais **pourquoi**.
 */
export type Appointment = {
  id: string
  /** UID Firebase Auth du patient. Aucun nom de famille, aucune donnée de santé. */
  patientUid: string
  kindId: string
  preference: AppointmentPreference
  status: AppointmentStatus
  createdAt: Date
  // --- renseigné par le soignant au moment de fixer le rendez-vous ---
  start?: Date
  end?: Date
  localDate?: LocalDate
  /** Prénom du professionnel, ou son rôle. Jamais un nom de famille. */
  withWhom?: string
  locationId?: string
  /** Motif d'annulation, en français simple. */
  cancellationReason?: string
}

/** Le strict minimum. Le code d'accès n'est jamais stocké en clair (l'id du doc est son hash). */
export type Patient = {
  id: string
  firstName: string
  serviceId: string
  createdAt: Date
  expiresAt: Date
}
