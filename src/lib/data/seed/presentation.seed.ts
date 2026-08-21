/**
 * Le jeu de démonstration de la présentation.
 *
 * Il ne sert qu'à une chose : montrer l'application pleine, telle qu'elle serait après
 * quelques semaines d'usage — plusieurs services, plusieurs personnes par métier, un
 * programme qui court sur plusieurs semaines, des inscriptions, des rendez-vous et un
 * appel déjà fait. Une application vide ne se présente pas.
 *
 * ⚠️ **Personne ici n'existe.** Les prénoms sont inventés, les activités aussi. C'est de
 * la donnée jetable, écrite par `scripts/demonstration.ts`, et effacée par le même
 * script. Rien de ce fichier ne doit survivre à la mise en service : le jour où de vrais
 * patients entrent dans la base, on vide et l'on repart de zéro.
 */
import type { Activity, AvailabilityWindow, Practitioner } from '../../domain/types'

/** Un patient de démonstration : un prénom, un service. Le strict minimum, ici aussi. */
export type SeedPatient = { firstName: string; serviceId: string }

/** Un compte du personnel à créer, relié à un intervenant. Le mot de passe est tiré au sort. */
export type SeedAccount = { practitionerId: string; email: string; role: 'staff' | 'admin' }

const matin = (weekday: 1 | 2 | 3 | 4 | 5): AvailabilityWindow => ({ weekday, from: '09:00', to: '12:00' })
const apresMidi = (weekday: 1 | 2 | 3 | 4 | 5): AvailabilityWindow => ({ weekday, from: '14:00', to: '17:00' })

/**
 * Les intervenants : plusieurs par métier, comme dans une vraie maison.
 *
 * Ceux qui reçoivent en rendez-vous ont des plages ; les autres n'en ont pas, et c'est
 * normal — un professeur de sport ne reçoit pas, il anime.
 */
export const presentationPractitioners: Practitioner[] = [
  // --- psychiatres ---
  {
    id: 'dr-lemaire',
    name: 'Docteur Lemaire',
    role: 'Psychiatre',
    kindId: 'psychiatre',
    availability: [matin(2), apresMidi(4)],
    isActive: true,
  },
  {
    id: 'dr-nkosi',
    name: 'Docteur Nkosi',
    role: 'Psychiatre',
    kindId: 'psychiatre',
    availability: [matin(1), matin(3)],
    // Celle-ci accepte automatiquement : la démonstration doit pouvoir le montrer.
    autoAccept: true,
    isActive: true,
  },
  // --- psychologues ---
  {
    id: 'claire-dubois',
    name: 'Claire Dubois',
    role: 'Psychologue',
    kindId: 'psychologue',
    availability: [{ weekday: 3, from: '13:30', to: '17:30' }],
    isActive: true,
  },
  {
    id: 'antoine-rey',
    name: 'Antoine Rey',
    role: 'Psychologue',
    kindId: 'psychologue',
    availability: [matin(5)],
    isActive: true,
  },
  // --- kinésithérapeutes ---
  {
    id: 'julien-marchal',
    name: 'Julien Marchal',
    role: 'Kinésithérapeute',
    kindId: 'kinesitherapeute',
    availability: [
      { weekday: 1, from: '08:30', to: '12:00' },
      { weekday: 3, from: '08:30', to: '12:00' },
      { weekday: 5, from: '08:30', to: '12:00' },
    ],
    isActive: true,
  },
  {
    id: 'sarah-belhadj',
    name: 'Sarah Belhadj',
    role: 'Kinésithérapeute',
    kindId: 'kinesitherapeute',
    availability: [apresMidi(2), apresMidi(4)],
    isActive: true,
  },
  // --- ergothérapeutes ---
  { id: 'elodie-vasseur', name: 'Élodie Vasseur', role: 'Ergothérapeute', isActive: true },
  { id: 'nadia-benali', name: 'Nadia Ben Ali', role: 'Ergothérapeute', isActive: true },
  { id: 'thomas-leroy', name: 'Thomas Leroy', role: 'Ergothérapeute', isActive: true },
  // --- éducateurs sportifs ---
  { id: 'marc-dupont', name: 'Marc Dupont', role: 'Professeur de sport', isActive: true },
  { id: 'fatima-zahiri', name: 'Fatima Zahiri', role: 'Professeur de sport', isActive: true },
  { id: 'kevin-wauters', name: 'Kevin Wauters', role: 'Professeur de sport', isActive: true },
  // --- animation, social, soins ---
  { id: 'sophie-renard', name: 'Sophie Renard', role: 'Animatrice', isActive: true },
  { id: 'lucie-martin', name: 'Lucie Martin', role: 'Animatrice', isActive: true },
  {
    id: 'isabelle-gerard',
    name: 'Isabelle Gérard',
    role: 'Assistante sociale',
    kindId: 'assistant-social',
    availability: [matin(1), matin(4)],
    isActive: true,
  },
  {
    id: 'pierre-colin',
    name: 'Pierre Colin',
    role: 'Infirmier référent',
    kindId: 'infirmier-referent',
    availability: [{ weekday: 2, from: '10:00', to: '12:00' }],
    isActive: true,
  },
]

/**
 * Les comptes à ouvrir, pour montrer que chacun voit son propre périmètre. Quatre
 * suffisent : un qui anime, une ergothérapeute, un psychiatre, une animatrice.
 */
export const presentationAccounts: SeedAccount[] = [
  { practitionerId: 'marc-dupont', email: 'marc.dupont@demonstration.test', role: 'staff' },
  { practitionerId: 'elodie-vasseur', email: 'elodie.vasseur@demonstration.test', role: 'staff' },
  { practitionerId: 'dr-lemaire', email: 'docteur.lemaire@demonstration.test', role: 'staff' },
  { practitionerId: 'sophie-renard', email: 'sophie.renard@demonstration.test', role: 'staff' },
]

/** Une vingtaine de personnes, réparties sur six unités. Des prénoms, et rien d'autre. */
export const presentationPatients: SeedPatient[] = [
  { firstName: 'Camille', serviceId: 'la-couturelle' },
  { firstName: 'Hugo', serviceId: 'la-couturelle' },
  { firstName: 'Amandine', serviceId: 'la-couturelle' },
  { firstName: 'Bernard', serviceId: 'la-couturelle' },
  { firstName: 'Lucien', serviceId: 'le-mazurel' },
  { firstName: 'Farida', serviceId: 'le-mazurel' },
  { firstName: 'Jean-Marc', serviceId: 'le-mazurel' },
  { firstName: 'Sylvie', serviceId: 'le-mazurel' },
  { firstName: 'Ahmed', serviceId: 'la-joncquerelle' },
  { firstName: 'Nathalie', serviceId: 'la-joncquerelle' },
  { firstName: 'Vincent', serviceId: 'la-joncquerelle' },
  { firstName: 'Josiane', serviceId: "l-ancrive" },
  { firstName: 'Patrick', serviceId: "l-ancrive" },
  { firstName: 'Mélanie', serviceId: 'le-mesnil' },
  { firstName: 'Serge', serviceId: 'le-mesnil' },
  { firstName: 'Karine', serviceId: "l-escalette" },
  { firstName: 'Dimitri', serviceId: "l-escalette" },
  { firstName: 'Colette', serviceId: 'jean-crelle' },
]

/**
 * Le programme.
 *
 * Il mélange délibérément tous les cas que l'application sait traiter : des séries
 * hebdomadaires et des séances uniques, des activités ouvertes à tous et d'autres
 * réservées à une ou deux unités, avec et sans inscription, avec et sans liste d'attente,
 * animées par des personnes différentes. C'est ce mélange qui rend la démonstration
 * crédible — un programme trop propre ne ressemble à rien de réel.
 *
 * Les dates sont posées par le script : `from` est calculé à partir du lundi de la
 * semaine en cours, pour que la démonstration soit toujours « cette semaine ».
 */
export type SeedActivity = Omit<Activity, 'id' | 'seriesId' | 'recurrence' | 'singleStart'> & {
  id: string
  /** Récurrence sans dates : le script les pose autour d'aujourd'hui. */
  weekly?: { byWeekday: (1 | 2 | 3 | 4 | 5 | 6 | 7)[]; startTime: string; durationMin: number }
  /** Séance unique, en nombre de jours à partir d'aujourd'hui (négatif = passé). */
  single?: { inDays: number; time: string; durationMin: number }
}

export const presentationActivities: SeedActivity[] = [
  {
    id: 'gymnastique-douce',
    title: 'Gymnastique douce',
    description: 'Des mouvements lents, assis ou debout. Venez comme vous êtes.',
    categoryId: 'sport',
    locationId: 'salle-de-sport',
    facilitator: 'Marc Dupont',
    facilitatorId: 'marc-dupont',
    audience: 'all',
    serviceIds: [],
    capacity: 12,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [1, 4], startTime: '10:00', durationMin: 60 },
    isActive: true,
  },
  {
    id: 'marche-du-matin',
    title: 'Marche du matin',
    description: 'Une heure de marche dans le parc, à un rythme tranquille.',
    categoryId: 'nature',
    locationId: 'terrain-exterieur',
    facilitator: 'Kevin Wauters',
    facilitatorId: 'kevin-wauters',
    audience: 'all',
    serviceIds: [],
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
    weekly: { byWeekday: [2, 5], startTime: '09:30', durationMin: 60 },
    isActive: true,
  },
  {
    id: 'atelier-cuisine',
    title: 'Atelier cuisine',
    description: 'On prépare un plat ensemble, et on le mange ensemble.',
    categoryId: 'cuisine',
    locationId: 'cuisine-therapeutique',
    facilitator: 'Nadia Ben Ali',
    facilitatorId: 'nadia-benali',
    audience: 'services',
    serviceIds: ['la-couturelle', 'le-mazurel'],
    capacity: 6,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [3], startTime: '10:00', durationMin: 150 },
    isActive: true,
  },
  {
    id: 'ergotherapie',
    title: 'Ergothérapie',
    description: 'Travail du geste et de l’autonomie, en petit groupe.',
    categoryId: 'creatif',
    locationId: 'atelier-creatif',
    facilitator: 'Élodie Vasseur',
    facilitatorId: 'elodie-vasseur',
    audience: 'services',
    serviceIds: ['la-joncquerelle', "l-ancrive"],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [4], startTime: '10:00', durationMin: 120 },
    isActive: true,
  },
  {
    id: 'sport-collectif',
    title: 'Sport collectif',
    description: 'Ballon, badminton, ping-pong. On choisit sur place.',
    categoryId: 'sport',
    locationId: 'salle-de-sport',
    facilitator: 'Fatima Zahiri',
    facilitatorId: 'fatima-zahiri',
    audience: 'all',
    serviceIds: [],
    capacity: 14,
    registrationRequired: true,
    waitlistEnabled: false,
    weekly: { byWeekday: [5], startTime: '10:00', durationMin: 90 },
    isActive: true,
  },
  {
    id: 'jeux-de-societe',
    title: 'Jeux de société',
    description: 'Cartes, dames, Scrabble. Autour d’un café.',
    categoryId: 'culturel',
    locationId: 'cafeteria',
    facilitator: 'Lucie Martin',
    facilitatorId: 'lucie-martin',
    audience: 'all',
    serviceIds: [],
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
    weekly: { byWeekday: [6], startTime: '14:00', durationMin: 120 },
    isActive: true,
  },
  {
    id: 'jardinage',
    title: 'Jardinage',
    description: 'On s’occupe du potager. Gants fournis.',
    categoryId: 'nature',
    locationId: 'jardin-therapeutique',
    facilitator: 'Thomas Leroy',
    facilitatorId: 'thomas-leroy',
    audience: 'all',
    serviceIds: [],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [7], startTime: '10:30', durationMin: 90 },
    isActive: true,
  },
  {
    id: 'relaxation',
    title: 'Relaxation',
    description: 'Respiration et détente, allongé ou assis. Salle calme.',
    categoryId: 'relaxation',
    locationId: 'salle-de-detente',
    facilitator: 'Claire Dubois',
    facilitatorId: 'claire-dubois',
    audience: 'all',
    serviceIds: [],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [2], startTime: '14:00', durationMin: 60 },
    isActive: true,
  },
  {
    id: 'groupe-de-parole',
    title: 'Groupe de parole',
    description: 'On parle, ou on écoute. Rien n’est obligatoire.',
    categoryId: 'parole',
    locationId: 'salon-daccueil',
    facilitator: 'Antoine Rey',
    facilitatorId: 'antoine-rey',
    audience: 'services',
    serviceIds: ['le-mesnil', "l-escalette", 'jean-crelle'],
    capacity: 10,
    registrationRequired: true,
    waitlistEnabled: false,
    weekly: { byWeekday: [3], startTime: '14:30', durationMin: 90 },
    isActive: true,
  },
  {
    id: 'musicotherapie',
    title: 'Musicothérapie',
    description: 'Écoute et pratique, avec les instruments de la salle.',
    categoryId: 'musique',
    locationId: 'salle-polyvalente',
    facilitator: 'Sophie Renard',
    facilitatorId: 'sophie-renard',
    audience: 'all',
    serviceIds: [],
    capacity: 10,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [4], startTime: '14:00', durationMin: 90 },
    isActive: true,
  },
  {
    id: 'kine-en-groupe',
    title: 'Kinésithérapie en groupe',
    description: 'Exercices d’entretien, adaptés à chacun.',
    categoryId: 'sport',
    locationId: 'salle-de-sport',
    facilitator: 'Julien Marchal',
    facilitatorId: 'julien-marchal',
    audience: 'services',
    serviceIds: ["l-ancrive", 'le-mesnil'],
    capacity: 6,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [1], startTime: '11:00', durationMin: 45 },
    isActive: true,
  },
  {
    id: 'atelier-lecture',
    title: 'Atelier lecture',
    description: 'On lit à voix haute, chacun son tour, et on en parle.',
    categoryId: 'culturel',
    locationId: 'bibliotheque',
    facilitator: 'Lucie Martin',
    facilitatorId: 'lucie-martin',
    audience: 'all',
    serviceIds: [],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    weekly: { byWeekday: [5], startTime: '14:00', durationMin: 60 },
    isActive: true,
  },
  {
    id: 'cafe-rencontre',
    title: 'Café-rencontre',
    description: 'Un café, des gaufres, et le temps de discuter.',
    categoryId: 'culturel',
    locationId: 'cafeteria',
    facilitator: 'Sophie Renard',
    facilitatorId: 'sophie-renard',
    audience: 'all',
    serviceIds: [],
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
    weekly: { byWeekday: [2], startTime: '15:30', durationMin: 90 },
    isActive: true,
  },
  // --- séances uniques : une sortie à venir, une fête, une séance déjà passée ---
  {
    id: 'sortie-musee',
    title: 'Sortie au musée',
    description: 'Départ en car à 13 heures. Prévoyez une veste.',
    categoryId: 'culturel',
    locationId: 'salon-daccueil',
    facilitator: 'Sophie Renard',
    facilitatorId: 'sophie-renard',
    audience: 'all',
    serviceIds: [],
    capacity: 15,
    registrationRequired: true,
    waitlistEnabled: true,
    single: { inDays: 9, time: '13:00', durationMin: 240 },
    isActive: true,
  },
  {
    id: 'fete-de-l-ete',
    title: 'Fête de l’été',
    description: 'Musique, barbecue et jeux dans le parc. Ouvert à tout le monde.',
    categoryId: 'musique',
    locationId: 'terrain-exterieur',
    facilitator: 'Marc Dupont',
    facilitatorId: 'marc-dupont',
    audience: 'all',
    serviceIds: [],
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
    single: { inDays: 16, time: '14:00', durationMin: 240 },
    isActive: true,
  },
  {
    id: 'tournoi-de-cartes',
    title: 'Tournoi de cartes',
    description: 'Belote et whist. Les équipes se font sur place.',
    categoryId: 'culturel',
    locationId: 'cafeteria',
    facilitator: 'Lucie Martin',
    facilitatorId: 'lucie-martin',
    audience: 'all',
    serviceIds: [],
    capacity: 16,
    registrationRequired: true,
    waitlistEnabled: false,
    single: { inDays: -4, time: '14:00', durationMin: 120 },
    isActive: true,
  },
]
