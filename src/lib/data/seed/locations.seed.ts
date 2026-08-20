import type { Location } from '../../domain/types'

/**
 * TODO : à remplacer par les vrais lieux de l'hôpital.
 * Cette liste est entièrement inventée pour permettre la démonstration.
 * Elle sera remplacée par la liste réelle, puis administrée depuis l'écran
 * « Lieux » de l'espace admin — aucune modification de code ne sera nécessaire.
 *
 * `planZoneId` reste vide tant que le plan du site (SVG) n'est pas fourni.
 */
export const locationsSeed: Location[] = [
  {
    id: 'salle-polyvalente',
    name: 'La salle polyvalente',
    building: 'Bâtiment central',
    floor: 'Rez-de-chaussée',
    accessNotes: "Depuis l'accueil, prenez le couloir de gauche. C'est la grande porte au fond.",
    isActive: true,
  },
  {
    id: 'atelier-creatif',
    name: "L'atelier créatif",
    building: 'Bâtiment central',
    floor: 'Premier étage',
    accessNotes: "Prenez l'ascenseur jusqu'au premier étage, puis à droite après la fontaine à eau.",
    isActive: true,
  },
  {
    id: 'salle-de-sport',
    name: 'La salle de sport',
    building: 'Annexe sportive',
    floor: 'Rez-de-chaussée',
    accessNotes: "Sortez par la porte vitrée de la cafétéria et traversez la cour. C'est le bâtiment en face.",
    isActive: true,
  },
  {
    id: 'cafeteria',
    name: 'La cafétéria',
    building: 'Bâtiment central',
    floor: 'Rez-de-chaussée',
    accessNotes: "Juste à côté de l'accueil, à droite en entrant.",
    isActive: true,
  },
  {
    id: 'jardin-therapeutique',
    name: 'Le jardin thérapeutique',
    building: 'Extérieur',
    accessNotes: "Sortez par la porte du fond de la cafétéria. Le jardin est derrière le bâtiment.",
    isActive: true,
  },
  {
    id: 'salle-de-detente',
    name: 'La salle de détente',
    building: 'Bâtiment central',
    floor: 'Rez-de-chaussée',
    accessNotes: "Au fond du couloir, à droite après la cafétéria. La porte est bleue.",
    isActive: true,
  },
  {
    id: 'cuisine-therapeutique',
    name: 'La cuisine thérapeutique',
    building: 'Bâtiment central',
    floor: 'Premier étage',
    accessNotes: "Au premier étage, la première porte à gauche en sortant de l'ascenseur.",
    isActive: true,
  },
  {
    id: 'bibliotheque',
    name: 'La bibliothèque',
    building: 'Bâtiment central',
    floor: 'Premier étage',
    accessNotes: "Au premier étage, tout au bout du couloir. C'est une salle calme.",
    isActive: true,
  },
  {
    id: 'terrain-exterieur',
    name: 'Le terrain extérieur',
    building: 'Extérieur',
    accessNotes: "Derrière la salle de sport. Prévoyez une veste s'il fait frais.",
    isActive: true,
  },
  {
    id: 'salon-daccueil',
    name: "Le salon d'accueil",
    building: 'Bâtiment central',
    floor: 'Rez-de-chaussée',
    accessNotes: "La pièce avec les fauteuils, juste après l'entrée principale.",
    isActive: true,
  },
]
