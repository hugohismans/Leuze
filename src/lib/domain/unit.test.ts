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
  it('se tait quand il n’y a rien à cacher', () => {
    expect(unitFilterNotice('La Couturelle', 0)).toBeNull()
    expect(unitFilterNotice(null, 4)).toBeNull()
  })

  it('compte ce qui est écarté', () => {
    expect(unitFilterNotice('La Couturelle', 1)).toContain('une ligne')
    expect(unitFilterNotice('La Couturelle', 3)).toContain('3 lignes')
    expect(unitFilterNotice('La Couturelle', 3)).toContain('La Couturelle')
  })
})
