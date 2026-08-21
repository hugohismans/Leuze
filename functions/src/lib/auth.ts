import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

/**
 * Gardes des fonctions appelables. Les messages sont en français simple : ils peuvent
 * remonter jusqu'à l'écran d'un patient.
 */

export type StaffIdentity = { uid: string; role: 'staff' | 'admin' }
export type PatientIdentity = { uid: string; serviceId: string }

export function requireStaff(request: CallableRequest): StaffIdentity {
  const auth = request.auth
  const role = auth?.token['role']
  if (!auth || (role !== 'staff' && role !== 'admin')) {
    throw new HttpsError('permission-denied', 'Cette action est réservée au personnel soignant.')
  }
  return { uid: auth.uid, role }
}

export function requireAdmin(request: CallableRequest): StaffIdentity {
  const identity = requireStaff(request)
  if (identity.role !== 'admin') {
    throw new HttpsError('permission-denied', "Cette action est réservée à l'administrateur.")
  }
  return identity
}

export function requirePatient(request: CallableRequest): PatientIdentity {
  const auth = request.auth
  if (!auth || auth.token['patient'] !== true) {
    throw new HttpsError('unauthenticated', 'Saisissez votre code pour vous inscrire.')
  }
  const serviceId = auth.token['serviceId']
  if (typeof serviceId !== 'string' || serviceId.length === 0) {
    throw new HttpsError('failed-precondition', "Votre code n'est rattaché à aucun service. Demandez un nouveau code à un soignant.")
  }
  return { uid: auth.uid, serviceId }
}

export function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new HttpsError('invalid-argument', `Le champ « ${field} » est absent ou incorrect.`)
  }
  return value.trim()
}
