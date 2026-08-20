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

export type Unit = {
  id: string
  name: string
}

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

/** Le strict minimum. Le code d'accès n'est jamais stocké en clair (l'id du doc est son hash). */
export type Patient = {
  id: string
  firstName: string
  unitId?: string
  createdAt: Date
  expiresAt: Date
}
