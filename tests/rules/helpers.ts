import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { Firestore } from 'firebase/firestore'

export const PROJECT_ID = 'demo-leuze'

/** Services utilisés par les tests : deux suffisent à prouver l'isolement. */
export const MAZUREL = 'le-mazurel'
export const JONCQUERELLE = 'la-joncquerelle'

export async function createEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
}

export const asPatient = (env: RulesTestEnvironment, uid: string, serviceId: string): Firestore =>
  env.authenticatedContext(uid, { patient: true, serviceId }).firestore() as unknown as Firestore

export const asStaff = (env: RulesTestEnvironment, uid = 'soignant-1'): Firestore =>
  env.authenticatedContext(uid, { role: 'staff' }).firestore() as unknown as Firestore

/**
 * Un soignant relié à un intervenant : c'est ce lien, porté par le jeton, qui ouvre son
 * agenda et l'appel de ses activités. Sans lui, un compte du personnel n'a ni l'un ni
 * l'autre.
 */
export const asPractitioner = (
  env: RulesTestEnvironment,
  practitionerId: string,
  uid = `soignant-${practitionerId}`,
): Firestore =>
  env.authenticatedContext(uid, { role: 'staff', practitionerId }).firestore() as unknown as Firestore

export const asAdmin = (env: RulesTestEnvironment, uid = 'admin-1'): Firestore =>
  env.authenticatedContext(uid, { role: 'admin' }).firestore() as unknown as Firestore

export const asVisitor = (env: RulesTestEnvironment): Firestore =>
  env.unauthenticatedContext().firestore() as unknown as Firestore

/** Une occurrence minimale, avec seulement ce que les règles regardent. */
export function occurrenceDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activityId: 'activite-1',
    seriesId: 'serie-1',
    title: 'Atelier créatif',
    description: 'Peinture et collage.',
    categoryId: 'creatif',
    locationId: 'atelier',
    localDate: '2026-09-01',
    /*
      Une séance porte le nom de qui l'anime, dénormalisé depuis l'activité.

      Il est dans le jeu d'essai par défaut parce qu'il décide d'un droit : écrire une
      séance, c'est modifier l'activité de quelqu'un. Une séance sans animateur
      n'appartient à personne en particulier, et relève alors de l'administrateur.
    */
    facilitatorId: 'marc',
    start: new Date('2026-09-01T12:00:00Z'),
    end: new Date('2026-09-01T13:30:00Z'),
    audienceKeys: ['all'],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    status: 'scheduled',
    overridden: false,
    confirmedCount: 0,
    waitlistCount: 0,
    ...overrides,
  }
}

export function activityDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seriesId: 'serie-1',
    title: 'Atelier créatif',
    description: 'Peinture et collage.',
    categoryId: 'creatif',
    locationId: 'atelier',
    audience: 'all',
    serviceIds: [],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    recurrence: null,
    isActive: true,
    ...overrides,
  }
}
