/** Fabriques d'objets pour les tests. Pas utilisé par l'application. */
import type { Activity, Occurrence, Registration } from './types'
import { addMinutes, instantOf } from './time'

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-yoga',
    seriesId: 'serie-yoga',
    title: 'Yoga doux',
    description: 'Une heure de détente en douceur. Aucune expérience nécessaire.',
    categoryId: 'relaxation',
    locationId: 'salle-polyvalente',
    facilitator: 'Claire',
    audience: 'all',
    serviceIds: [],
    capacity: 8,
    registrationRequired: true,
    waitlistEnabled: true,
    recurrence: {
      freq: 'weekly',
      byWeekday: [2],
      startTime: '14:00',
      durationMin: 90,
      from: '2025-08-01',
      until: null,
      skipDates: [],
    },
    isActive: true,
    ...overrides,
  }
}

export function makeOccurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  const localDate = overrides.localDate ?? '2025-08-19'
  const start = overrides.start ?? instantOf(localDate, '14:00')
  return {
    id: `act-yoga_${localDate.replaceAll('-', '')}T1400`,
    activityId: 'act-yoga',
    seriesId: 'serie-yoga',
    start,
    end: overrides.end ?? addMinutes(start, 90),
    localDate,
    title: 'Yoga doux',
    description: 'Une heure de détente en douceur.',
    categoryId: 'relaxation',
    locationId: 'salle-polyvalente',
    facilitator: 'Claire',
    audienceKeys: ['all'],
    capacity: 2,
    registrationRequired: true,
    waitlistEnabled: true,
    status: 'scheduled',
    overridden: false,
    confirmedCount: 0,
    waitlistCount: 0,
    ...overrides,
  }
}

export function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  const createdAt = overrides.createdAt ?? new Date('2025-08-10T09:00:00Z')
  return {
    id: 'reg-1',
    occurrenceId: 'act-yoga_20250819T1400',
    patientUid: 'patient-1',
    status: 'confirmed',
    createdAt,
    queuedAt: overrides.queuedAt ?? createdAt,
    createdBy: 'patient',
    ...overrides,
  }
}
