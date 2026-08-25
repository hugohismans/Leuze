import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { appointmentKindsSeed } from '../seed/appointmentKinds.seed'
import { DEMO_PATIENT_UID, resetWorld, world } from './state'
import { cancelledToShow, patientStatusLabel } from '../../domain/appointments'
import { firstBookableDay } from '../../domain/agenda'
import { todayLocalDate } from '../../domain/time'

/**
 * Ce qu'un patient lit quand son rendez-vous n'aura pas lieu.
 *
 * Le cas s'est présenté à l'envers pendant longtemps : le soignant annulait, la ligne
 * disparaissait de l'écran du patient, et plus rien ne disait qu'il y avait eu un
 * rendez-vous. La personne se souvenait de mardi et venait quand même.
 *
 * On vérifie ici les deux sens : l'annulation d'un soignant se lit avec son motif, et le
 * retrait que le patient a fait lui-même s'en va sans rien laisser — il sait ce qu'il a
 * fait, le lui répéter n'apprend rien.
 */
describe('un rendez-vous annulé', () => {
  const demain = firstBookableDay(todayLocalDate())
  const aujourdhui = todayLocalDate()

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

  const lueParLePatient = async () => {
    const repo = createMockRepository()
    return cancelledToShow(await repo.appointments.listMine(), aujourdhui)
  }

  it("reste lisible, avec son motif, quand c'est un soignant qui annule", async () => {
    const app = await admin()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: demain,
      time: '10:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })
    const rendezVous = world.appointments[0]!
    await app.repository.cancelAppointment(rendezVous.id, 'Le rendez-vous a été déplacé')

    const annules = await lueParLePatient()
    expect(annules).toHaveLength(1)
    // La longueur vient d'être vérifiée : la case existe.
    const texte = patientStatusLabel(annules[0]!, appointmentKindsSeed)
    expect(texte).toContain('annulé')
    expect(texte).toContain('Le rendez-vous a été déplacé')
  })

  it("s'en va sans un mot quand c'est le patient qui retire sa demande", async () => {
    /*
      Le retrait se pose sur une demande en attente, et le test l'exige.

      Il enfermait tout son corps dans un « if » : le jour où l'acceptation automatique
      trouvait une place, le test ne vérifiait plus rien et passait quand même. Un test
      qui ne peut pas échouer est pire que pas de test.
    */
    const repo = createMockRepository()
    world.appointments = [
      {
        id: 'rdv-en-attente',
        patientUid: DEMO_PATIENT_UID,
        kindId: 'psychiatre',
        preference: 'peu-importe',
        status: 'requested',
        createdAt: new Date(),
      },
    ]
    const retrait = await repo.appointments.withdraw('rdv-en-attente')
    expect(retrait.ok).toBe(true)
    // Retiré par le patient lui-même : aucun motif, donc rien à lui remontrer.
    expect(world.appointments[0]!.status).toBe('cancelled')
    expect(await lueParLePatient()).toEqual([])
  })

  it("ne montre pas le rendez-vous d'un autre patient", async () => {
    const app = await admin()
    await app.repository.createAppointment({
      externalName: 'Sarah',
      kindId: 'psychiatre',
      date: demain,
      time: '11:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })
    await app.repository.cancelAppointment(world.appointments[0]!.id, 'Le rendez-vous a été déplacé')
    expect(await lueParLePatient()).toEqual([])
  })
})
