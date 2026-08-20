import type { Activity, Occurrence, Service } from './types'

/** Clé signifiant « ouvert à tous les services ». */
export const ALL_SERVICES = 'all'

type AudienceSource = Pick<Activity, 'audience' | 'serviceIds'>

/**
 * Clés dénormalisées écrites sur chaque occurrence.
 * Une seule requête suffit ensuite pour bâtir le calendrier d'un patient,
 * et les règles Firestore vérifient exactement la même condition.
 */
export function audienceKeysOf(source: AudienceSource): string[] {
  if (source.audience === 'all') return [ALL_SERVICES]
  return [...new Set(source.serviceIds)].sort()
}

/**
 * Une activité réservée à zéro service n'est visible par personne.
 * Ce n'est presque jamais volontaire : l'interface soignant doit le signaler.
 */
export function isPublished(source: AudienceSource): boolean {
  return source.audience === 'all' || source.serviceIds.length > 0
}

/** Le patient voit-il cette occurrence ? `null` = patient sans service connu. */
export function isVisibleToService(occurrence: Pick<Occurrence, 'audienceKeys'>, serviceId: string | null): boolean {
  if (occurrence.audienceKeys.includes(ALL_SERVICES)) return true
  if (serviceId === null) return false
  return occurrence.audienceKeys.includes(serviceId)
}

/** Valeurs à passer à `array-contains-any` pour le calendrier d'un patient. */
export function audienceQueryKeys(serviceId: string | null): string[] {
  return serviceId === null ? [ALL_SERVICES] : [ALL_SERVICES, serviceId]
}

/** Libellé pour le soignant : il voit la liste réelle des services concernés. */
export function audienceLabelForStaff(source: AudienceSource, services: Service[]): string {
  if (source.audience === 'all') return 'Tous les services'
  if (source.serviceIds.length === 0) return "Aucun service — cette activité n'est visible par personne"
  const names = source.serviceIds.map((id) => services.find((s) => s.id === id)?.name ?? id)
  if (names.length === 1) return `Réservée à ${names[0]}`
  return `Réservée à ${names.slice(0, -1).join(', ')} et ${names.at(-1)}`
}

/**
 * Libellé pour le patient. On ne lui montre jamais la liste des autres services :
 * elle ne lui apprend rien d'utile et révèle l'organisation interne.
 */
export function audienceLabelForPatient(occurrence: Pick<Occurrence, 'audienceKeys'>): string | null {
  return occurrence.audienceKeys.includes(ALL_SERVICES) ? null : 'Réservée à votre service'
}
