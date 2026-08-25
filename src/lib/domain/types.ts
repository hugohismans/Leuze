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

/** Une plage de disponibilité, en semaine type. Voir `domain/availability.ts`. */
export type AvailabilityWindow = {
  weekday: IsoWeekday
  from: LocalTime
  to: LocalTime
}

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
  /** Absent vaut « oui » : les catégories créées avant ce drapeau restent proposées. */
  isActive?: boolean
}

/**
 * Une personne qui anime ou reçoit : psychiatre, kinésithérapeute, ergothérapeute,
 * animateur. Elle existe en tant que telle pour deux raisons.
 *
 * D'abord, « avec Marc » tapé à la main dans deux écrans différents ne se relie à rien :
 * impossible de dire de qui il s'agit, ni de rassembler ce qu'il fait dans la semaine.
 * Ensuite, un intervenant a un planning — activités animées et rendez-vous — qu'on veut
 * pouvoir consulter et imprimer.
 *
 * ⚠️ Ce n'est pas un compte : personne ne se connecte avec ceci. Les comptes du personnel
 * vivent dans `staff/`, et le rôle qui fait autorité reste le « custom claim ».
 */
export type Practitioner = {
  id: string
  /** Ce que les patients liront : « Docteur Lemaire », « Marc ». */
  name: string
  /** « Psychiatre », « Kinésithérapeute », « Animateur ». */
  role: string
  /** Motif de rendez-vous correspondant, quand il y en a un. */
  kindId?: string
  /**
   * À quelles unités cette personne intervient.
   *
   * Même forme que le public d'une activité, et pour la même raison : c'est la même
   * question (« à qui cela s'adresse-t-il ? ») et deux formes différentes finiraient par
   * diverger. Absent vaut `'all'` — un intervenant qui n'a jamais été rattaché à rien
   * continue de couvrir tout l'hôpital, comme avant que ce champ existe.
   *
   * Certains couvrent réellement tout : l'animateur sportif passe dans toutes les unités.
   * D'autres tiennent à une seule.
   */
  audience?: 'all' | 'services'
  serviceIds?: string[]
  /**
   * Les plages où cette personne reçoit, en semaine type. Elles n'interdisent rien :
   * elles répondent à « est-il là ? » au moment où l'on fixe un rendez-vous.
   */
  availability?: AvailabilityWindow[]
  /**
   * Les demandes de rendez-vous qui la concernent se placent toutes seules dans ses
   * plages, sans attendre qu'on ouvre la file. C'est un choix personnel : sans plage
   * déclarée, il ne peut rien donner, et il reste faux par défaut.
   */
  autoAccept?: boolean
  isActive: boolean
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
  /** Le nom, dénormalisé : c'est lui que le patient lit. */
  facilitator?: string
  /** L'intervenant, quand il vient du catalogue : c'est lui qui relie à son planning. */
  facilitatorId?: string
  /**
   * L'activité est animée par un patient, seul.
   *
   * Ce n'est pas la même chose qu'une activité sans personne désignée. Ici quelqu'un
   * anime — son prénom est dans `facilitator` — mais ce n'est pas un membre du
   * personnel, et il n'y a pas d'appel : personne ne note les présences, et c'est voulu.
   * Coché, ce champ vaut donc décision, pas oubli. Les écrans le disent en toutes lettres
   * plutôt que d'afficher « personne n'anime cette activité », qui serait faux.
   */
  ledByPatient?: boolean
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
  facilitatorId?: string
  /** Animée par un patient, seul : pas d'appel. Voir `Activity.ledByPatient`. */
  ledByPatient?: boolean
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
  /**
   * Vrai quand c'est la régénération, et non un soignant, qui a barré cette séance.
   *
   * La différence est celle entre « cette séance n'aura pas lieu, voici pourquoi » et
   * « cette séance est sortie de la série ». Sans elle, retirer une activité du programme
   * puis l'y remettre laissait annulées à jamais **exactement** les séances qui portaient
   * des inscriptions — les séances vides, elles, revenaient. Le retrait détruisait donc
   * ce qui comptait et épargnait le reste, sans que rien ne le dise.
   *
   * Une séance ainsi barrée redevient normale dès qu'elle rentre dans la série. Une
   * séance qu'un soignant a annulée avec un motif ne bouge jamais.
   */
  autoCancelled?: boolean
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
  /**
   * UID Firebase Auth du patient — absent quand le rendez-vous concerne une personne
   * extérieure à l'hôpital.
   *
   * Certains soignants reçoivent des gens qui ne sont plus hospitalisés : d'anciens
   * patients, le plus souvent. Ces rendez-vous occupent une vraie place dans un agenda,
   * et les tenir hors de l'application, c'est proposer des créneaux déjà pris.
   *
   * L'un ou l'autre, jamais les deux, jamais aucun : c'est un patient d'ici, ou une
   * personne extérieure nommée par `externalName`. Les règles Firestore vérifient
   * exactement cette alternative.
   */
  patientUid?: string
  /**
   * Le prénom d'une personne extérieure, quand le rendez-vous n'est pas celui d'un
   * patient de l'hôpital.
   *
   * Un prénom, et rien d'autre : ni nom de famille, ni adresse, ni motif. C'est la même
   * discipline qu'ici — un patient de l'hôpital n'est enregistré qu'avec son prénom, et
   * il n'y a aucune raison d'en demander davantage à quelqu'un qui n'y est même plus.
   */
  externalName?: string
  kindId: string
  preference: AppointmentPreference
  status: AppointmentStatus
  createdAt: Date
  // --- renseigné par le soignant au moment de fixer le rendez-vous ---
  start?: Date
  end?: Date
  localDate?: LocalDate
  /** Le nom du professionnel, tel que le patient le lira. */
  withWhom?: string
  /** L'intervenant du catalogue, quand le rendez-vous a été fixé depuis sa fiche. */
  practitionerId?: string
  locationId?: string
  /** Motif d'annulation, en français simple. */
  cancellationReason?: string
  /** Fixé sans intervention humaine, dans les plages de l'intervenant. */
  autoAccepted?: boolean
  /**
   * La date a sauté parce que la personne s'est déclarée en congé.
   *
   * La demande est retournée dans la file — elle tient toujours, c'est la date qui ne
   * tient plus. Sans ce drapeau, le patient verrait son rendez-vous redevenir une simple
   * demande sans la moindre explication, ce qui est la façon la plus sûre de faire croire
   * à une panne. Il ne dit pas pourquoi la personne s'absente, et ne le dira jamais.
   */
  reopenedForLeave?: boolean
}

/** Le strict minimum. Le code d'accès n'est jamais stocké en clair (l'id du doc est son hash). */
export type Patient = {
  id: string
  firstName: string
  serviceId: string
  createdAt: Date
  expiresAt: Date
}
