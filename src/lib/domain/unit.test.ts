import { describe, expect, it } from 'vitest'
import {
  appointmentsOfUnit,
  patientsOfUnit,
  resolveUnit,
  unitFilterNotice,
  unitName,
} from './unit'

const services = [
  { id: 'la-couturelle', name: 'La Couturelle', isActive: true },
  { id: 'la-joncquerelle', name: 'La Joncquerelle', isActive: true },
  { id: 'le-mesnil', name: 'Le Mesnil', isActive: false },
]

describe("l'unité d'un compte", () => {
  it('se garde quand le service existe encore', () => {
    expect(resolveUnit(services, 'la-couturelle')).toBe('la-couturelle')
  })

  it("retombe sur l'hôpital entier quand le service a été retiré", () => {
    // Sans cela, tous les écrans seraient vides sans que rien ne dise pourquoi.
    expect(resolveUnit(services, 'l-ancrive')).toBeNull()
    expect(resolveUnit(services, 'le-mesnil')).toBeNull()
  })

  it('accepte l’absence d’unité', () => {
    expect(resolveUnit(services, null)).toBeNull()
    expect(resolveUnit(services, '')).toBeNull()
  })

  it('se nomme en toutes lettres', () => {
    expect(unitName(services, 'la-couturelle')).toBe('La Couturelle')
    expect(unitName(services, 'inconnue')).toBeNull()
    expect(unitName(services, null)).toBeNull()
  })
})

describe('les patients d’une unité', () => {
  const patients = [
    { uid: 'a', serviceId: 'la-couturelle' },
    { uid: 'b', serviceId: 'la-joncquerelle' },
    { uid: 'c', serviceId: 'la-couturelle' },
  ]

  it('ne garde que les siens', () => {
    expect(patientsOfUnit(patients, 'la-couturelle').map((p) => p.uid)).toEqual(['a', 'c'])
  })

  it('les rend tous sans unité', () => {
    expect(patientsOfUnit(patients, null)).toEqual(patients)
  })
})

describe('les rendez-vous d’une unité', () => {
  const rendezVous = [
    { id: '1', patientUid: 'a' },
    { id: '2', patientUid: 'b' },
    { id: '3', patientUid: 'disparu' },
  ]
  const serviceDe = (uid: string): string | null =>
    uid === 'a' ? 'la-couturelle' : uid === 'b' ? 'la-joncquerelle' : null

  it('suit le service du patient', () => {
    const gardes = appointmentsOfUnit(rendezVous, serviceDe, 'la-couturelle').map((r) => r.id)
    expect(gardes).toContain('1')
    expect(gardes).not.toContain('2')
  })

  it('garde une demande dont le patient est introuvable', () => {
    // Elle disparaîtrait de tous les écrans à la fois, et personne n'y répondrait.
    expect(appointmentsOfUnit(rendezVous, serviceDe, 'la-couturelle').map((r) => r.id)).toContain('3')
    expect(appointmentsOfUnit(rendezVous, serviceDe, 'la-joncquerelle').map((r) => r.id)).toContain('3')
  })

  it('les rend tous sans unité', () => {
    expect(appointmentsOfUnit(rendezVous, serviceDe, null)).toEqual(rendezVous)
  })
})

describe('ce que l’écran dit du filtre', () => {
  const avis = (cache: number) => unitFilterNotice('La Couturelle', cache, 'demande', 'demandes')

  it('se tait quand il n’y a rien à cacher', () => {
    expect(avis(0)).toBeNull()
    expect(unitFilterNotice(null, 4, 'demande', 'demandes')).toBeNull()
  })

  it('compte ce qui est écarté, sans parler de « lignes »', () => {
    // « lignes » est un mot de tableur : on compte des personnes, des rendez-vous,
    // des activités — jamais des lignes.
    expect(avis(1)).toContain('a une demande')
    expect(avis(3)).toContain('ont 3 demandes')
    expect(avis(3)).toContain('La Couturelle')
    expect(avis(3)).not.toContain('ligne')
  })

  it('nomme ce qui est caché, et ne le remplace jamais par « en »', () => {
    /*
      La phrase disait « D'autres unités que La Couturelle en ont 10 ». Le pronom ne
      renvoyait à rien : la seule autre phrase de l'encadré est « Voir toutes les
      unités ». Dix quoi, personne ne pouvait le dire.
    */
    expect(unitFilterNotice('Le Mazurel', 10, 'personne', 'personnes')).toBe(
      "D'autres unités que Le Mazurel ont 10 personnes, qui ne sont pas affichées.",
    )
    expect(avis(10)).not.toContain(' en ont')
  })
})
