import type { AppointmentKind } from '../../domain/types'

/**
 * Avec qui un patient peut demander un rendez-vous.
 *
 * Administrable depuis le catalogue de l'espace soignant, comme les lieux et les
 * catégories : aucune modification de code n'est nécessaire pour en ajouter un. Ceci
 * n'est que le point de départ d'une installation neuve.
 *
 * Ces intitulés sont ceux que verra le patient : ils disent une fonction, jamais une
 * spécialité clinique fine, et surtout jamais une raison.
 */
export const appointmentKindsSeed: AppointmentKind[] = [
  { id: 'psychiatre', name: 'Le psychiatre', icon: '🩺', isActive: true },
  { id: 'psychologue', name: 'Le psychologue', icon: '💬', isActive: true },
  { id: 'kinesitherapeute', name: 'Le kinésithérapeute', icon: '🤸', isActive: true },
  { id: 'assistant-social', name: "L'assistant social", icon: '📋', isActive: true },
  { id: 'infirmier-referent', name: "L'infirmier référent", icon: '🧑‍⚕️', isActive: true },
  // Le fourre-tout assumé : tout ce qui ne rentre dans aucune case. Placé en dernier,
  // pour qu'on lise d'abord les autres.
  { id: 'autre', name: 'Autre', icon: '👤', isActive: true },
]
