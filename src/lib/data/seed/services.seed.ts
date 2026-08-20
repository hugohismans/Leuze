import type { Service } from '../../domain/types'

/**
 * Les services de l'hôpital.
 *
 * Les six premiers sont les unités de soins publiées sur le site de l'établissement
 * (acis-asbl.be). Les deux derniers ont été cités de vive voix et restent à confirmer.
 * TODO : faire valider cette liste sur place, y compris l'orthographe exacte.
 *
 * Un service décide **qui voit quoi** : une activité est ouverte à tous les services,
 * ou réservée à un, deux, trois d'entre eux. Voir `src/lib/domain/audience.ts`.
 * Ces services seront administrables depuis l'espace soignant (ajout, renommage,
 * désactivation), sans modification de code.
 */
export const servicesSeed: Service[] = [
  { id: 'la-couturelle', name: 'La Couturelle', isActive: true },
  { id: 'la-joncquerelle', name: 'La Joncquerelle', isActive: true },
  { id: 'le-mazurel', name: 'Le Mazurel', isActive: true },
  { id: 'l-ancrive', name: "L'Ancrive", isActive: true },
  { id: 'le-mesnil', name: 'Le Mesnil', isActive: true },
  { id: 'l-escalette', name: "L'Escalette", isActive: true },
  // TODO : cités oralement, à confirmer (nom exact, et s'il s'agit bien de services
  // auxquels des patients sont rattachés).
  { id: 'l-echeveau', name: "L'Écheveau", isActive: true },
  { id: 'service-culturel', name: 'Service culturel', isActive: true },
  { id: 'jean-crelle', name: 'Jean Crelle', isActive: true },
]
