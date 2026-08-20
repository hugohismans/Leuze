import type { AppointmentKind } from '../../domain/types'

/**
 * Avec qui un patient peut demander un rendez-vous.
 *
 * TODO : liste à confirmer avec l'équipe. Elle est administrable depuis l'espace
 * soignant, comme les lieux et les catégories : aucune modification de code n'est
 * nécessaire pour en ajouter un.
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
]
