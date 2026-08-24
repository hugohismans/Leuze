import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { appointmentWho, isExternal } from '../../domain/appointments'
import { appointmentsOfUnit } from '../../domain/unit'
import { firstBookableDay } from '../../domain/agenda'
import { todayLocalDate } from '../../domain/time'

/**
 * Un rendez-vous avec une personne extérieure à l'hôpital.
 *
 * Certains soignants reçoivent des gens qui ne sont plus hospitalisés — d'anciens
 * patients, le plus souvent. Ces rendez-vous occupent une vraie place dans un agenda, et
 * les tenir hors de l'application, c'est proposer des créneaux déjà pris.
 *
 * Ce qui se vérifie ici : le rendez-vous existe et occupe le créneau, il n'appartient à
 * aucune unité, et **aucun patient ne le voit** — la personne concernée n'a pas de compte.
 */
describe('un rendez-vous avec une personne extérieure', () => {
  const demain = firstBookableDay(todayLocalDate())

  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = []
  })

  const admin = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  const fixerPourSarah = async (app: Awaited<ReturnType<typeof admin>>) =>
    app.repository.createAppointment({
      externalName: 'Sarah',
      kindId: 'psychiatre',
      date: demain,
      time: '10:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })

  it("s'enregistre avec un prénom, sans patient", async () => {
    const app = await admin()
    const resultat = await fixerPourSarah(app)
    expect(resultat.ok).toBe(true)
    // Le message dit ce qui reste à faire : cette personne n'a pas l'application.
    expect(resultat.message).toContain('prévenez-la')

    const rendezVous = world.appointments[0]!
    expect(rendezVous.externalName).toBe('Sarah')
    expect(rendezVous.patientUid).toBeUndefined()
    expect(isExternal(rendezVous)).toBe(true)
  })

  it("occupe réellement le créneau : c'est tout l'objet", async () => {
    const app = await admin()
    await fixerPourSarah(app)
    const vue = await app.repository.appointmentPlanning({
      practitionerId: 'docteur-lemaire',
      preference: 'peu-importe',
      durationMin: 30,
    })
    const jour = vue.week.find((j) => j.localDate === demain)
    // Le créneau de 10h00 n'est plus libre.
    expect(jour?.free.some((trou) => trou.from <= '10:00' && '10:30' <= trou.to)).toBe(false)
  })

  it("n'appartient à aucune unité, et n'est donc caché à aucune", async () => {
    // Le rendez-vous est celui de l'intervenant, pas d'une bulle : le cacher à sept
    // unités sur huit ne le rendrait à aucune.
    const app = await admin()
    await fixerPourSarah(app)
    const gardes = appointmentsOfUnit(world.appointments, () => 'le-mazurel', 'la-couturelle')
    expect(gardes).toHaveLength(1)
  })

  it('ne figure dans la liste d’aucun patient', async () => {
    const app = await admin()
    await fixerPourSarah(app)
    const repo = createMockRepository()
    expect(await repo.appointments.listMine()).toEqual([])
  })

  it('s’affiche sous le prénom donné, sans chercher un patient', () => {
    const jamais = () => {
      throw new Error('on ne doit pas chercher un patient pour une personne extérieure')
    }
    expect(appointmentWho({ externalName: 'Sarah' }, jamais)).toBe('Sarah')
    // Sans prénom, la ligne reste lisible plutôt que vide.
    expect(appointmentWho({ externalName: '  ' }, jamais)).toBe('Personne extérieure')
  })

  it('un patient d’ici garde exactement le comportement d’avant', async () => {
    const app = await admin()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: demain,
      time: '11:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })
    const rendezVous = world.appointments[0]!
    expect(rendezVous.patientUid).toBe(DEMO_PATIENT_UID)
    expect(rendezVous.externalName).toBeUndefined()
    expect(isExternal(rendezVous)).toBe(false)

    const repo = createMockRepository()
    expect(await repo.appointments.listMine()).toHaveLength(1)
  })
})
