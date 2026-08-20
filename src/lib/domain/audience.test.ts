import { describe, expect, it } from 'vitest'
import {
  ALL_SERVICES,
  audienceKeysOf,
  audienceLabelForPatient,
  audienceLabelForStaff,
  audienceQueryKeys,
  isPublished,
  isVisibleToService,
} from './audience'
import { makeActivity, makeOccurrence } from './fixtures'
import { expand } from './recurrence'
import type { Service } from './types'

const services: Service[] = [
  { id: 'le-mazurel', name: 'Le Mazurel', isActive: true },
  { id: 'la-joncquerelle', name: 'La Joncquerelle', isActive: true },
  { id: 'le-mesnil', name: 'Le Mesnil', isActive: true },
]

describe('audience — clés dénormalisées', () => {
  it('marque « tous les services » d’une seule clé', () => {
    expect(audienceKeysOf({ audience: 'all', serviceIds: [] })).toEqual([ALL_SERVICES])
    // Les services listés sont ignorés si l'activité est ouverte à tous.
    expect(audienceKeysOf({ audience: 'all', serviceIds: ['le-mazurel'] })).toEqual([ALL_SERVICES])
  })

  it('déduplique et trie les services, pour un identifiant stable', () => {
    expect(
      audienceKeysOf({ audience: 'services', serviceIds: ['le-mesnil', 'le-mazurel', 'le-mesnil'] }),
    ).toEqual(['le-mazurel', 'le-mesnil'])
  })

  it('reporte les clés sur chaque occurrence engendrée', () => {
    const activity = makeActivity({ audience: 'services', serviceIds: ['la-joncquerelle'] })
    const occurrences = expand(activity, '2025-08-01', '2025-08-31')
    expect(occurrences).not.toHaveLength(0)
    expect(occurrences.every((o) => o.audienceKeys.join() === 'la-joncquerelle')).toBe(true)
  })
})

describe('audience — qui voit quoi', () => {
  const ouverte = makeOccurrence({ audienceKeys: [ALL_SERVICES] })
  const reservee = makeOccurrence({ audienceKeys: ['le-mazurel', 'le-mesnil'] })

  it('montre les activités ouvertes à tout le monde', () => {
    expect(isVisibleToService(ouverte, 'le-mazurel')).toBe(true)
    expect(isVisibleToService(ouverte, 'la-joncquerelle')).toBe(true)
    expect(isVisibleToService(ouverte, null)).toBe(true)
  })

  it('réserve une activité aux seuls services autorisés', () => {
    expect(isVisibleToService(reservee, 'le-mazurel')).toBe(true)
    expect(isVisibleToService(reservee, 'le-mesnil')).toBe(true)
    expect(isVisibleToService(reservee, 'la-joncquerelle')).toBe(false)
  })

  it('ne montre rien de réservé à un patient sans service', () => {
    expect(isVisibleToService(reservee, null)).toBe(false)
  })

  it('fournit les clés de la requête du calendrier', () => {
    expect(audienceQueryKeys('le-mazurel')).toEqual([ALL_SERVICES, 'le-mazurel'])
    expect(audienceQueryKeys(null)).toEqual([ALL_SERVICES])
  })
})

describe('audience — activité réservée à aucun service', () => {
  it('est considérée comme non publiée', () => {
    expect(isPublished({ audience: 'services', serviceIds: [] })).toBe(false)
    expect(isPublished({ audience: 'services', serviceIds: ['le-mazurel'] })).toBe(true)
    expect(isPublished({ audience: 'all', serviceIds: [] })).toBe(true)
  })

  it('n’est visible par personne', () => {
    const orpheline = makeOccurrence({ audienceKeys: [] })
    expect(isVisibleToService(orpheline, 'le-mazurel')).toBe(false)
    expect(isVisibleToService(orpheline, null)).toBe(false)
  })
})

describe('audience — libellés', () => {
  it('donne au soignant la liste exacte des services', () => {
    expect(audienceLabelForStaff({ audience: 'all', serviceIds: [] }, services)).toBe('Tous les services')
    expect(audienceLabelForStaff({ audience: 'services', serviceIds: ['le-mazurel'] }, services)).toBe(
      'Réservée à Le Mazurel',
    )
    expect(
      audienceLabelForStaff({ audience: 'services', serviceIds: ['le-mazurel', 'le-mesnil'] }, services),
    ).toBe('Réservée à Le Mazurel et Le Mesnil')
    expect(
      audienceLabelForStaff(
        { audience: 'services', serviceIds: ['le-mazurel', 'la-joncquerelle', 'le-mesnil'] },
        services,
      ),
    ).toBe('Réservée à Le Mazurel, La Joncquerelle et Le Mesnil')
  })

  it('avertit le soignant quand personne ne verra l’activité', () => {
    expect(audienceLabelForStaff({ audience: 'services', serviceIds: [] }, services)).toBe(
      "Aucun service — cette activité n'est visible par personne",
    )
  })

  it('ne révèle jamais les autres services au patient', () => {
    expect(audienceLabelForPatient({ audienceKeys: [ALL_SERVICES] })).toBeNull()
    expect(audienceLabelForPatient({ audienceKeys: ['le-mazurel', 'le-mesnil'] })).toBe(
      'Réservée à votre service',
    )
  })
})
