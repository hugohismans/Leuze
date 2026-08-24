import type { Practitioner } from '../../domain/types'

/**
 * Intervenants fictifs de la démonstration.
 *
 * TODO : ces personnes n'existent pas. En service, elles sont créées depuis le catalogue.
 * Ce ne sont pas des comptes : personne ne se connecte avec ceci.
 *
 * Les rattachements aux unités montrent les deux cas de figure : l'éducateur sportif et
 * l'animatrice passent partout, la psychologue tient deux unités. Un patient ne peut
 * demander à voir que quelqu'un qui passe dans la sienne.
 */
export const practitionersSeed: Practitioner[] = [
  // Les plages sont renseignées pour les deux personnes qui reçoivent en rendez-vous :
  // sans elles, l'avertissement de disponibilité n'aurait rien à montrer.
  {
    id: 'docteur-lemaire',
    name: 'Docteur Lemaire',
    role: 'Psychiatre',
    kindId: 'psychiatre',
    availability: [
      { weekday: 2, from: '09:00', to: '12:00' },
      { weekday: 4, from: '14:00', to: '17:00' },
    ],
    isActive: true,
  },
  {
    id: 'claire',
    name: 'Claire',
    role: 'Psychologue',
    kindId: 'psychologue',
    // Deux unités seulement : c'est le cas courant, et celui qu'il faut voir marcher.
    audience: 'services',
    serviceIds: ['le-mazurel', 'la-couturelle'],
    availability: [{ weekday: 3, from: '13:30', to: '17:30' }],
    isActive: true,
  },
  {
    id: 'julien',
    name: 'Julien',
    role: 'Kinésithérapeute',
    kindId: 'kinesitherapeute',
    audience: 'services',
    serviceIds: ['le-mazurel'],
    isActive: true,
  },
  // L'éducateur sportif passe dans toutes les unités : c'est un choix, pas un oubli.
  { id: 'marc', name: 'Marc', role: 'Éducateur sportif', audience: 'all', serviceIds: [], isActive: true },
  { id: 'sophie', name: 'Sophie', role: 'Ergothérapeute', audience: 'all', serviceIds: [], isActive: true },
  { id: 'nadia', name: 'Nadia', role: 'Animatrice', audience: 'all', serviceIds: [], isActive: true },
]
