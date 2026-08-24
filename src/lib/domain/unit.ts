/**
 * L'unité de rattachement d'un compte du personnel.
 *
 * L'hôpital n'a pas un poste d'administration mais plusieurs : une bulle par unité de
 * soins — La Couturelle, La Joncquerelle, Le Mazurel… Chacune fixe les rendez-vous de
 * ses patients, tient sa réunion du lundi, inscrit les siens. Jusqu'ici l'application
 * ignorait cette réalité : chaque écran s'ouvrait sur l'hôpital entier, et il fallait
 * re-choisir son unité partout, à chaque fois, sur chaque poste.
 *
 * Rattacher un compte à une unité ne lui retire aucun droit — c'est un **réglage de
 * confort**, pas une cloison. La case « Voir toutes les unités » rend l'ensemble d'un
 * geste : quelqu'un remplace un collègue, un patient change d'unité, et rien ne doit
 * devenir impossible pour autant. Une cloison véritable se poserait dans le jeton et
 * dans les règles Firestore, jamais ici.
 *
 * Ce module ne lit rien, n'écrit rien et n'accorde rien : il ne fait que trier.
 */

/** L'unité d'un compte, ou `null` quand il n'en a aucune — il voit alors tout l'hôpital. */
export type Unit = string | null

/**
 * L'unité, une fois vérifié qu'elle existe toujours.
 *
 * Un service retiré du catalogue ne doit pas continuer à filtrer en silence : le compte
 * y resterait rattaché, tous les écrans seraient vides, et rien ne dirait pourquoi.
 * Mieux vaut revenir à l'hôpital entier — un écran trop plein se comprend, un écran
 * vide ne se comprend pas.
 */
export function resolveUnit(services: { id: string; isActive: boolean }[], unit: Unit): Unit {
  if (unit === null || unit === '') return null
  return services.some((service) => service.id === unit && service.isActive) ? unit : null
}

/** Le nom de l'unité, tel qu'on l'écrit à l'écran. `null` quand il n'y a rien à nommer. */
export function unitName(services: { id: string; name: string }[], unit: Unit): string | null {
  if (unit === null || unit === '') return null
  return services.find((service) => service.id === unit)?.name ?? null
}

/** Les patients d'une unité. Sans unité, tout le monde. */
export function patientsOfUnit<T extends { serviceId: string }>(patients: T[], unit: Unit): T[] {
  if (unit === null || unit === '') return patients
  return patients.filter((patient) => patient.serviceId === unit)
}

/**
 * Les rendez-vous d'une unité, d'après le service du patient.
 *
 * Un rendez-vous ne porte pas de service : il porte un patient, et c'est le patient qui
 * appartient à une unité. Dupliquer le service sur le rendez-vous ferait deux vérités
 * pour une seule question, et l'une des deux finirait par mentir — un patient qui change
 * d'unité laisserait derrière lui des rendez-vous rattachés à l'ancienne.
 *
 * Un rendez-vous dont on ne retrouve pas le patient est **gardé**. Le séjour est
 * peut-être clos, ou la liste pas encore chargée : dans les deux cas, une demande qu'on
 * ne peut rattacher à personne disparaîtrait de tous les écrans à la fois, et plus
 * personne n'y répondrait. Une ligne de trop se voit ; une demande perdue, non.
 */
export function appointmentsOfUnit<T extends { patientUid?: string }>(
  appointments: T[],
  serviceOf: (patientUid: string) => string | null,
  unit: Unit,
): T[] {
  if (unit === null || unit === '') return appointments
  return appointments.filter((appointment) => {
    // Sans patient, il n'y a pas d'unité : c'est un rendez-vous avec une personne
    // extérieure à l'hôpital. Il appartient à l'agenda de l'intervenant, pas à une
    // unité, et le cacher à sept bulles sur huit ne le rendrait à aucune.
    if (appointment.patientUid === undefined || appointment.patientUid === '') return true
    const service = serviceOf(appointment.patientUid)
    return service === null || service === unit
  })
}

/**
 * Ce que l'écran dit du filtre, en toutes lettres.
 *
 * Un écran filtré qui ne dit pas qu'il l'est est un écran qui ment : on cherche une
 * demande, elle n'y est pas, et l'on conclut qu'elle n'existe plus. Le nombre de lignes
 * écartées est donc écrit, et jamais remplacé par une nuance de couleur.
 */
export function unitFilterNotice(name: string | null, hidden: number): string | null {
  if (name === null || hidden <= 0) return null
  if (hidden === 1) return `Une autre unité que ${name} a une ligne ici. Elle n'est pas affichée.`
  return `D'autres unités que ${name} ont ${hidden} lignes ici. Elles ne sont pas affichées.`
}
