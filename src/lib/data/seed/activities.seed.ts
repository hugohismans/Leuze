import type { Activity, IsoWeekday, LocalTime } from '../../domain/types'

/**
 * TODO : activités d'exemple, à remplacer par le programme réel.
 * Semaine type complète, pensée pour démontrer tous les cas d'affichage :
 * places limitées, places illimitées, sans inscription, liste d'attente,
 * et les trois formes d'audience — ouverte à tous les services, réservée à un
 * seul service, réservée à plusieurs.
 * Les descriptions sont volontairement en français simple et au vouvoiement.
 */

function weekly(
  id: string,
  weekday: IsoWeekday,
  startTime: LocalTime,
  durationMin: number,
  rest: Omit<Activity, 'id' | 'seriesId' | 'recurrence' | 'isActive' | 'audience' | 'serviceIds'> &
    Partial<Pick<Activity, 'audience' | 'serviceIds'>>,
): Activity {
  return {
    id,
    seriesId: `serie-${id}`,
    audience: 'all',
    serviceIds: [],
    ...rest,
    recurrence: {
      freq: 'weekly',
      byWeekday: [weekday],
      startTime,
      durationMin,
      from: '2024-01-01',
      until: null,
      skipDates: [],
    },
    isActive: true,
  }
}

export const activitiesSeed: Activity[] = [
  weekly('gymnastique-douce', 1, '10:00', 60, {
    title: 'Gymnastique douce',
    description:
      "Des mouvements lents pour se réveiller en douceur. Vous pouvez rester assis si vous le préférez. Aucune tenue particulière n'est nécessaire.",
    categoryId: 'sport',
    locationId: 'salle-de-sport',
    facilitator: 'Marc',
    capacity: 12,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('atelier-creatif', 1, '14:00', 120, {
    title: 'Atelier créatif',
    description:
      'Peinture, dessin, collage : vous choisissez ce que vous avez envie de faire. Tout le matériel est fourni.',
    categoryId: 'creatif',
    locationId: 'atelier-creatif',
    facilitator: 'Sophie',
    capacity: 10,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('marche-matinale', 2, '09:30', 60, {
    title: 'Marche du matin',
    description:
      "Une promenade tranquille dans le parc, à votre rythme. Le groupe attend tout le monde. Prévoyez de bonnes chaussures.",
    categoryId: 'nature',
    locationId: 'terrain-exterieur',
    facilitator: 'Julien',
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
  }),
  weekly('relaxation', 2, '14:00', 90, {
    title: 'Relaxation',
    description:
      'Un moment de calme, allongé ou assis, guidé par la voix. Il n’y a rien à réussir, seulement à se reposer.',
    categoryId: 'relaxation',
    locationId: 'salle-de-detente',
    facilitator: 'Claire',
    audience: 'services',
    serviceIds: ['le-mazurel', 'la-joncquerelle'],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('atelier-cuisine', 3, '10:00', 150, {
    title: 'Atelier cuisine',
    description:
      'On prépare un plat ensemble, puis on le partage à midi. Vous n’avez pas besoin de savoir cuisiner.',
    categoryId: 'cuisine',
    locationId: 'cuisine-therapeutique',
    facilitator: 'Nadia',
    audience: 'services',
    serviceIds: ['la-couturelle'],
    capacity: 6,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('groupe-de-parole', 3, '14:30', 90, {
    title: 'Groupe de parole',
    description:
      'Un temps pour parler, ou simplement pour écouter. Ce qui se dit dans le groupe reste dans le groupe.',
    categoryId: 'parole',
    locationId: 'salon-daccueil',
    facilitator: 'Docteur Lemaire',
    audience: 'services',
    serviceIds: ['le-mazurel'],
    capacity: 10,
    registrationRequired: true,
    waitlistEnabled: false,
  }),
  weekly('ergotherapie', 4, '10:00', 120, {
    title: 'Ergothérapie',
    description:
      "Des activités manuelles pour retrouver ses gestes et sa concentration. L'ergothérapeute vous accompagne pas à pas.",
    categoryId: 'creatif',
    locationId: 'atelier-creatif',
    facilitator: 'Élodie',
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('musicotherapie', 4, '14:00', 90, {
    title: 'Musicothérapie',
    description:
      'On écoute, on chante, on joue avec des instruments simples. Aucune connaissance en musique n’est demandée.',
    categoryId: 'musique',
    locationId: 'salle-polyvalente',
    facilitator: 'Thomas',
    capacity: 10,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('sport-collectif', 5, '10:00', 90, {
    title: 'Sport collectif',
    description:
      'Ballon, badminton ou jeux d’équipe, selon l’envie du groupe. On joue pour le plaisir, pas pour la compétition.',
    categoryId: 'sport',
    locationId: 'salle-de-sport',
    facilitator: 'Marc',
    capacity: 14,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('cafe-rencontre', 5, '14:00', 90, {
    title: 'Café-rencontre',
    description:
      'Un café, des jeux de cartes et de la discussion. Vous pouvez venir et repartir quand vous voulez.',
    categoryId: 'culturel',
    locationId: 'cafeteria',
    facilitator: 'Fatima',
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
  }),
  weekly('jeux-de-societe', 6, '14:00', 120, {
    title: 'Jeux de société',
    description:
      'Cartes, dominos, jeux de plateau. Venez avec l’envie de jouer, on vous explique les règles.',
    categoryId: 'culturel',
    locationId: 'cafeteria',
    facilitator: 'Fatima',
    capacity: null,
    registrationRequired: false,
    waitlistEnabled: false,
  }),
  weekly('jardinage', 7, '10:30', 90, {
    title: 'Jardinage',
    description:
      'On s’occupe du potager et des fleurs. Les outils et les gants sont fournis. On travaille assis ou debout, comme vous voulez.',
    categoryId: 'nature',
    locationId: 'jardin-therapeutique',
    facilitator: 'Julien',
    audience: 'services',
    serviceIds: ['le-mesnil', 'l-ancrive', 'l-escalette'],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('ping-pong', 2, '16:00', 60, {
    title: 'Ping-pong',
    description:
      'Des parties courtes, seul ou en double. Les raquettes sont prêtées. Venez comme vous êtes.',
    categoryId: 'sport',
    locationId: 'salle-de-sport',
    facilitator: 'Marc',
    audience: 'services',
    serviceIds: ['la-joncquerelle'],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
  weekly('lecture-partagee', 3, '16:00', 60, {
    title: 'Lecture partagée',
    description:
      'On lit un texte court à voix haute, puis on en parle. Vous pouvez venir seulement pour écouter.',
    categoryId: 'culturel',
    locationId: 'bibliotheque',
    facilitator: 'Sophie',
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
  }),
]
