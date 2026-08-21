import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { createMockRepository } from './index'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { startOfIsoWeek, todayLocalDate, addLocalDays } from '../../domain/time'

/**
 * Un rendez-vous fixé sans demande préalable. Beaucoup de patients ne se serviront jamais
 * de l'application : ils en parlent à un soignant, qui note. Le rendez-vous doit ensuite
 * apparaître chez le patient exactement comme s'il l'avait demandé lui-même.
 */
describe('fixer un rendez-vous de vive voix', () => {
  beforeEach(() => {
    resetWorld()
  })

  const jour = () => addLocalDays(startOfIsoWeek(todayLocalDate()), 2)

  it('le crée déjà fixé', async () => {
    const app = createMockStaffApp()

    const resultat = await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: jour(),
      time: '11:00',
      durationMin: 30,
      withWhom: 'Docteur Martin',
    })

    expect(resultat.ok).toBe(true)
    const cree = world.appointments.find(
      (r) => r.patientUid === DEMO_PATIENT_UID && r.withWhom === 'Docteur Martin',
    )
    expect(cree?.status).toBe('scheduled')
    expect(cree?.localDate).toBe(jour())
    expect(cree?.end?.getTime()! - cree?.start?.getTime()!).toBe(30 * 60_000)
  })

  it('le patient le voit dans ses rendez-vous, sans avoir rien demandé', async () => {
    const app = createMockStaffApp()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: jour(),
      time: '11:00',
      durationMin: 30,
      withWhom: 'Docteur Martin',
      locationId: 'salon-daccueil',
    })

    const patient = createMockRepository()
    const siens = await patient.appointments.listMine()

    expect(siens.some((r) => r.withWhom === 'Docteur Martin' && r.status === 'scheduled')).toBe(true)
  })
})
