/**
 * Qui intervient où, et qui un patient peut demander à voir.
 *
 * Deux questions se sont posées ensemble. L'hôpital compte plusieurs unités, et tout le
 * monde n'y passe pas : l'assistante sociale de La Couturelle ne reçoit pas les patients
 * de L'Ancrive, tandis que l'animateur sportif passe dans toutes. Et un patient qui
 * demande un rendez-vous ne veut pas seulement « un psychiatre » — souvent il veut
 * celui qu'il connaît, et le lui refuser, c'est le renvoyer au bouche-à-oreille.
 *
 * Ce module ne lit rien et n'accorde rien : il dit qui est proposable, et le serveur
 * revérifie la même chose avant d'enregistrer une demande. Un écran peut être contourné.
 */
import { ALL_SERVICES } from './audience'
import type { Practitioner } from './types'
import { enumeration } from './francais'

/** Le public d'un intervenant, sous la forme du public d'une activité. */
export function practitionerAudience(
  practitioner: Pick<Practitioner, 'audience' | 'serviceIds'>,
): { audience: 'all' | 'services'; serviceIds: string[] } {
  // Absent vaut « tous les services » : c'est ce que faisaient tous les intervenants
  // avant que ce champ existe, et une migration silencieuse ne doit rien restreindre.
  if (practitioner.audience !== 'services') return { audience: 'all', serviceIds: [] }
  return { audience: 'services', serviceIds: [...new Set(practitioner.serviceIds ?? [])].sort() }
}

/**
 * Où cette personne intervient, en une ligne lisible sur sa fiche.
 *
 * La fiche ne le disait nulle part : un intervenant rattaché à aucune unité paraissait
 * normal, et aucun patient ne pouvait demander à le voir sans que rien ne l'explique.
 * Les mots ne sont pas ceux d'une activité — on parle d'une personne, pas d'une séance.
 */
export function practitionerAudienceLabel(
  practitioner: Pick<Practitioner, 'audience' | 'serviceIds'>,
  services: { id: string; name: string }[],
): string {
  const public_ = practitionerAudience(practitioner)
  if (public_.audience === 'all') return 'Intervient dans toutes les unités'
  if (public_.serviceIds.length === 0) return 'Aucune unité choisie'
  const noms = public_.serviceIds.map((id) => services.find((s) => s.id === id)?.name ?? id)
  return `Intervient dans ${enumeration(noms)}`
}

/** Cette personne intervient-elle dans ce service ? `null` = service inconnu. */
export function servesService(
  practitioner: Pick<Practitioner, 'audience' | 'serviceIds'>,
  serviceId: string | null,
): boolean {
  const public_ = practitionerAudience(practitioner)
  if (public_.audience === 'all') return true
  if (serviceId === null) return false
  return public_.serviceIds.includes(serviceId)
}

/** Les clés du public, comme pour une occurrence — même vocabulaire, même sens. */
export function practitionerAudienceKeys(
  practitioner: Pick<Practitioner, 'audience' | 'serviceIds'>,
): string[] {
  const public_ = practitionerAudience(practitioner)
  return public_.audience === 'all' ? [ALL_SERVICES] : public_.serviceIds
}

/**
 * Les personnes qu'un patient peut demander à voir pour ce motif.
 *
 * Trois conditions, et pas une de plus : la personne est en poste, ce motif est le sien,
 * et elle intervient dans l'unité du patient. Proposer quelqu'un qui ne passe jamais
 * dans son unité, c'est promettre un rendez-vous qui n'aura pas lieu.
 *
 * L'ordre est alphabétique : aucune raison d'en préférer un, et un ordre stable évite
 * qu'on appuie sur le mauvais nom parce que la liste a bougé.
 */
export function requestablePractitioners(
  practitioners: Practitioner[],
  kindId: string,
  serviceId: string | null,
): Practitioner[] {
  if (kindId === '') return []
  return practitioners
    .filter((p) => p.isActive && p.kindId === kindId && servesService(p, serviceId))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/**
 * Ce que l'écran du patient dit du choix, en une phrase.
 *
 * Personne à proposer n'est pas une erreur : le motif existe, mais aucune personne de
 * cette fonction ne passe dans cette unité — ou aucune n'a encore été enregistrée. La
 * demande part quand même, et c'est l'équipe qui trouvera qui la prend.
 */
export function practitionerChoiceNotice(count: number): string | null {
  if (count === 0) return null
  if (count === 1) return 'Vous pouvez demander cette personne, ou laisser l’équipe choisir.'
  return 'Vous pouvez demander une personne en particulier, ou laisser l’équipe choisir.'
}
