import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'

/**
 * La règle de suppression d'une activité, jouée de bout en bout sur la démonstration :
 * ce qui n'a jamais réuni personne disparaît, le reste est seulement retiré du programme.
 *
 * La démonstration refuse ce que le serveur refuse : supprimer demande d'être connecté,
 * et d'être administrateur ou d'animer l'activité. Chaque cas ouvre donc une session.
 */
async function ouvrirUneSession(): Promise<ReturnType<typeof createMockStaffApp>> {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test')
  return app
}

describe('suppression d’une activité', () => {
  beforeEach(() => {
    resetWorld()
  })

  it('supprime l’activité et ses séances quand personne n’est inscrit', async () => {
    const app = await ouvrirUneSession()
    const { activityId } = await app.repository.saveActivity({
      title: 'Activité de test',
      description: '',
      categoryId: 'creatif',
      locationId: 'atelier-creatif',
      audience: 'all',
      serviceIds: [],
      capacity: null,
      registrationRequired: false,
      waitlistEnabled: false,
      recurrence: null,
      singleStart: { date: '2026-09-15', time: '14:00', durationMin: 60 },
      isActive: true,
    })
    expect([...world.occurrences.values()].some((o) => o.activityId === activityId)).toBe(true)

    const plan = await app.repository.deleteActivity(activityId)

    expect(plan.action).toBe('deleted')
    expect((await app.repository.listActivities()).some((a) => a.id === activityId)).toBe(false)
    expect([...world.occurrences.values()].some((o) => o.activityId === activityId)).toBe(false)
  })

  it('retire du programme sans rien effacer dès qu’une inscription existe', async () => {
    const app = await ouvrirUneSession()
    const inscrite = world.registrations[0]
    expect(inscrite).toBeDefined()
    const occurrence = world.occurrences.get(inscrite!.occurrenceId)
    expect(occurrence).toBeDefined()

    const plan = await app.repository.deleteActivity(occurrence!.activityId)

    expect(plan.action).toBe('deactivated')
    const activite = (await app.repository.listActivities()).find((a) => a.id === occurrence!.activityId)
    expect(activite?.isActive).toBe(false)
    // Les séances et les inscriptions sont intactes : c'est tout l'objet de la règle.
    expect(world.occurrences.has(inscrite!.occurrenceId)).toBe(true)
    expect(world.registrations).toContain(inscrite)
  })
})
