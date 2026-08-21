/**
 * Qui est réellement connecté, d'après le jeton.
 *
 * Firebase ne tient qu'une session par navigateur, partagée entre l'écran patient et
 * l'espace soignant. « Il y a quelqu'un de connecté » ne dit donc rien : il faut lire
 * ce que porte le jeton. Un soignant connecté à son espace était pris pour un patient,
 * sans service — il voyait l'écran patient sans jamais pouvoir en sortir.
 *
 * Les droits eux-mêmes ne se jouent pas ici : ils se jouent dans les règles Firestore et
 * dans les fonctions, qui lisent le même jeton. Ceci ne fait qu'accorder l'interface.
 */

export type PatientIdentity = { patientUid: string; serviceId: string | null }

export function patientIdentityOf(uid: string | null, claims: Record<string, unknown> | null): PatientIdentity | null {
  if (uid === null || claims === null) return null
  // Posé par `exchangeCode`, et par personne d'autre.
  if (claims['patient'] !== true) return null
  const serviceId = claims['serviceId']
  return { patientUid: uid, serviceId: typeof serviceId === 'string' && serviceId !== '' ? serviceId : null }
}
