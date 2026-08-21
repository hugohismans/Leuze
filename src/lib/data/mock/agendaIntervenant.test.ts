import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { addLocalDays, startOfIsoWeek, todayLocalDate } from '../../domain/time'

/**
 * Un rendez-vous ne dit pas pourquoi, mais il dit avec qui — et « avec le psychiatre »
 * en apprend déjà beaucoup sur quelqu'un. Un intervenant voit donc son agenda et lui
 * seul, et ne fixe de rendez-vous que pour lui-même.
 */
describe('l’agenda d’un intervenant', () => {
  beforeEach(() => {
    resetWorld()
  })

  const jour = () => addLocalDays(startOfIsoWeek(todayLocalDate()), 2)

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    return app
  }

  /** Deux rendez-vous, deux professionnels : de quoi vérifier que la cloison tient. */
  const deuxRendezVous = async (app: Awaited<ReturnType<typeof ouvrir>>) => {
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: jour(),
      time: '11:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychologue',
      date: jour(),
      time: '14:00',
      durationMin: 30,
      withWhom: 'Claire',
      practitionerId: 'claire',
    })
  }

  it('l’administrateur voit tout, y compris les demandes en attente', async () => {
    const app = await ouvrir()
    await deuxRendezVous(app)

    const tous = await app.repository.listAppointments()
    expect(tous.filter((r) => r.practitionerId === 'docteur-lemaire').length).toBeGreaterThan(0)
    expect(tous.filter((r) => r.practitionerId === 'claire').length).toBeGreaterThan(0)
    expect(tous.some((r) => r.status === 'requested')).toBe(true)
  })

  it('un intervenant ne voit que le sien', async () => {
    const app = await ouvrir()
    await deuxRendezVous(app)
    await app.superAdmin.impersonate('staff-docteur-lemaire')

    const siens = await app.repository.listAppointments()

    expect(siens.length).toBeGreaterThan(0)
    expect(siens.every((r) => r.practitionerId === 'docteur-lemaire')).toBe(true)
    // Ni ceux d'une collègue, ni les demandes que personne n'a encore prises.
    expect(siens.some((r) => r.practitionerId === 'claire')).toBe(false)
    expect(siens.some((r) => r.status === 'requested')).toBe(false)
  })

  it('il ne fixe un rendez-vous que pour lui-même', async () => {
    const app = await ouvrir()
    await app.superAdmin.impersonate('staff-docteur-lemaire')

    const pourLui = await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: jour(),
      time: '11:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })
    const pourUneAutre = await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychologue',
      date: jour(),
      time: '14:00',
      durationMin: 30,
      withWhom: 'Claire',
      practitionerId: 'claire',
    })

    expect(pourLui.ok).toBe(true)
    expect(pourUneAutre.ok).toBe(false)
    expect(pourUneAutre.message).toMatch(/que pour vous-même/)
  })

  it('il ne s’attribue pas une demande en attente', async () => {
    const app = await ouvrir()
    const demande = world.appointments.find((r) => r.status === 'requested')!
    await app.superAdmin.impersonate('staff-docteur-lemaire')

    const resultat = await app.repository.scheduleAppointment(demande.id, {
      date: jour(),
      time: '11:00',
      durationMin: 30,
      withWhom: 'Claire',
      practitionerId: 'claire',
    })

    expect(resultat.ok).toBe(false)
  })
})
