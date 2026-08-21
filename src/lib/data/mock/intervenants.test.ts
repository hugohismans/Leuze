import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { startOfIsoWeek, todayLocalDate, addLocalDays } from '../../domain/time'

/** Fixer un rendez-vous demande une session ouverte : la démonstration l'exige comme le serveur. */
const ouvrir = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test', 'peu-importe')
  return app
}

/**
 * Les intervenants : psychiatre, kinésithérapeute, animateur. Nommés une fois dans le
 * catalogue, ils relient une activité et un rendez-vous à la même personne — ce qu'un nom
 * tapé à la main dans deux écrans différents ne permettait pas.
 */
describe('les intervenants', () => {
  beforeEach(() => {
    resetWorld()
  })

  it('s’enregistrent et se retrouvent dans le catalogue', async () => {
    const app = await ouvrir()

    await app.catalogAdmin.savePractitioner({
      id: 'docteur-neuf',
      name: 'Docteur Neuf',
      role: 'Psychiatre',
      kindId: 'psychiatre',
      isActive: true,
    })

    const trouve = mockCatalog.practitioners().find((i) => i.id === 'docteur-neuf')
    expect(trouve?.name).toBe('Docteur Neuf')
    expect(trouve?.role).toBe('Psychiatre')
  })

  it('relient un rendez-vous à leur planning', async () => {
    const app = await ouvrir()
    const jour = addLocalDays(startOfIsoWeek(todayLocalDate()), 2)

    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: jour,
      time: '11:00',
      durationMin: 30,
      withWhom: 'Julien',
      // Un intervenant que la démonstration ne charge pas déjà de rendez-vous.
      practitionerId: 'julien',
    })

    const sien = world.appointments.filter((r) => r.practitionerId === 'julien')
    expect(sien).toHaveLength(1)
    expect(sien[0]?.localDate).toBe(jour)
  })

  it('portent leurs séances jusque dans les occurrences', () => {
    // `expand` recopie l'intervenant sur chaque séance : c'est ce qui permet de retrouver
    // sa semaine sans relire toutes les activités.
    const seances = [...world.occurrences.values()].filter((o) => o.facilitatorId === 'marc')
    expect(seances.length).toBeGreaterThan(0)
    expect(seances.every((o) => o.facilitator === 'Marc')).toBe(true)
  })

  it('ne se suppriment pas tant qu’un rendez-vous les nomme', async () => {
    const app = await ouvrir()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: addLocalDays(startOfIsoWeek(todayLocalDate()), 2),
      time: '11:00',
      durationMin: 30,
      withWhom: 'Claire',
      practitionerId: 'claire',
    })

    const plan = await app.catalogAdmin.removeEntry('practitioner', 'claire')

    expect(plan.action).toBe('deactivated')
    expect(plan.message).toContain('rendez-vous')
    expect(mockCatalog.practitioners().find((i) => i.id === 'claire')?.isActive).toBe(false)
  })

  it('se suppriment quand rien ne les nomme', async () => {
    const app = await ouvrir()
    await app.catalogAdmin.savePractitioner({
      id: 'intervenant-inutile',
      name: 'Personne',
      role: 'Essai',
      isActive: true,
    })

    const plan = await app.catalogAdmin.removeEntry('practitioner', 'intervenant-inutile')

    expect(plan.action).toBe('deleted')
    expect(mockCatalog.practitioners().some((i) => i.id === 'intervenant-inutile')).toBe(false)
  })
})
