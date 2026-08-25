import { describe, expect, it } from 'vitest'
import {
  FIRST_NAME_MAX,
  groupByService,
  sameNameWarning,
  sharedFirstNames,
  sharesFirstName,
} from './patientList'

const services = [
  { id: 'la-couturelle', name: 'La Couturelle', isActive: true },
  { id: 'le-mazurel', name: 'Le Mazurel', isActive: true },
  { id: 'lescalette', name: "L'Escalette", isActive: false },
]

const gens = [
  { uid: 'a', firstName: 'Camille', serviceId: 'le-mazurel' },
  { uid: 'b', firstName: 'Yannick', serviceId: 'lescalette' },
  { uid: 'c', firstName: 'Pierre', serviceId: 'la-couturelle' },
  { uid: 'd', firstName: 'camille', serviceId: 'le-mazurel' },
  { uid: 'e', firstName: 'Zoé', serviceId: 'disparu' },
]

describe('ranger les personnes par service', () => {
  it("ne perd personne, même quand le service a été retiré des listes", () => {
    const groupes = groupByService(gens, services)
    const tous = groupes.flatMap((g) => g.patients.map((p) => p.uid))
    expect(tous.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('dit qu’un service n’est plus proposé, et le range en dernier', () => {
    const groupes = groupByService(gens, services)
    expect(groupes.map((g) => g.serviceId)).toEqual([
      'la-couturelle',
      'le-mazurel',
      'lescalette',
      'disparu',
    ])
    expect(groupes.find((g) => g.serviceId === 'lescalette')?.retired).toBe(true)
    expect(groupes.find((g) => g.serviceId === 'la-couturelle')?.retired).toBe(false)
  })

  it('garde un intitulé lisible pour un service effacé du catalogue', () => {
    const groupes = groupByService(gens, services)
    const inconnu = groupes.find((g) => g.serviceId === 'disparu')
    expect(inconnu?.name).toBe('Service inconnu')
    expect(inconnu?.retired).toBe(true)
  })

  it('ne fabrique pas de groupe vide', () => {
    const groupes = groupByService([], services)
    expect(groupes).toEqual([])
  })
})

describe('deux personnes du même prénom', () => {
  it('se repèrent, sans tenir compte de la casse', () => {
    const partages = sharedFirstNames(gens)
    expect(sharesFirstName(partages, gens[0]!)).toBe(true)
    expect(sharesFirstName(partages, gens[3]!)).toBe(true)
    expect(sharesFirstName(partages, gens[2]!)).toBe(false)
  })

  it('ne se confondent pas d’une unité à l’autre', () => {
    const ailleurs = [
      { firstName: 'Camille', serviceId: 'le-mazurel' },
      { firstName: 'Camille', serviceId: 'la-couturelle' },
    ]
    const partages = sharedFirstNames(ailleurs)
    expect(partages.size).toBe(0)
  })

  it('donne un avertissement qui n’empêche rien', () => {
    const texte = sameNameWarning(gens, 'Camille', 'le-mazurel', 'Le Mazurel')
    expect(texte).toContain('2 personnes')
    expect(texte).toContain('Le Mazurel')
    expect(texte).toContain('créer quand même')
  })

  it('se tait quand le prénom est libre, ou quand le champ est vide', () => {
    expect(sameNameWarning(gens, 'Sofia', 'le-mazurel', 'Le Mazurel')).toBeNull()
    expect(sameNameWarning(gens, '   ', 'le-mazurel', 'Le Mazurel')).toBeNull()
  })

  it('accorde au singulier pour une seule personne', () => {
    const texte = sameNameWarning(gens, 'Pierre', 'la-couturelle', 'La Couturelle')
    expect(texte).toContain("Une personne s'appelle déjà Pierre")
  })
})

describe('la longueur d’un prénom', () => {
  it('est bornée : sans quoi la liste déborde de l’écran', () => {
    expect(FIRST_NAME_MAX).toBeGreaterThanOrEqual(20)
    expect(FIRST_NAME_MAX).toBeLessThanOrEqual(40)
  })
})
