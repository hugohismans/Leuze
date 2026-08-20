import type { Service } from '../../domain/types'

/**
 * Patients fictifs de la démonstration.
 *
 * TODO : ces personnes n'existent pas. En service, les patients sont créés par un
 * soignant, qui leur remet un code — voir la Cloud Function `createPatientCode`.
 * Le strict minimum est stocké : un prénom et un service. Rien d'autre, jamais.
 */
export type SeedPatient = { uid: string; firstName: string; serviceId: Service['id'] }

export const patientsSeed: SeedPatient[] = [
  { uid: 'demo-patient', firstName: 'Camille', serviceId: 'le-mazurel' },
  { uid: 'demo-p2', firstName: 'Hugo', serviceId: 'le-mazurel' },
  { uid: 'demo-p3', firstName: 'Manon', serviceId: 'le-mazurel' },
  { uid: 'demo-p4', firstName: 'Bernard', serviceId: 'le-mazurel' },
  { uid: 'demo-p5', firstName: 'Aline', serviceId: 'la-joncquerelle' },
  { uid: 'demo-p6', firstName: 'Farid', serviceId: 'la-joncquerelle' },
  { uid: 'demo-p7', firstName: 'Jeanne', serviceId: 'la-joncquerelle' },
  { uid: 'demo-p8', firstName: 'Pierre', serviceId: 'la-couturelle' },
  { uid: 'demo-p9', firstName: 'Sofia', serviceId: 'la-couturelle' },
  { uid: 'demo-p10', firstName: 'Louis', serviceId: 'l-ancrive' },
  { uid: 'demo-p11', firstName: 'Nadège', serviceId: 'l-ancrive' },
  { uid: 'demo-p12', firstName: 'Émile', serviceId: 'le-mesnil' },
  { uid: 'demo-p13', firstName: 'Rachida', serviceId: 'le-mesnil' },
  { uid: 'demo-p14', firstName: 'Yannick', serviceId: 'l-escalette' },
]
