import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'

/**
 * Une activité « ouverte à tous » accepte les inscriptions comme les autres. C'est ce
 * qui la fait apparaître dans la semaine du patient, et ce que la réunion du lundi
 * propose de noter — la question posée y est « qui veut venir ? », pas « qui doit
 * s'inscrire ? ».
 */
describe('activité sans inscription obligatoire', () => {
  beforeEach(() => {
    resetWorld()
  })

  it('accepte qu’un soignant note quelqu’un', async () => {
    const app = createMockStaffApp()
    const libre = [...world.occurrences.values()].find(
      (o) => !o.registrationRequired && o.capacity === null && o.start.getTime() > Date.now(),
    )
    expect(libre).toBeDefined()

    const resultat = await app.repository.registerPatient(libre!.id, 'demo-patient')

    expect(resultat.ok).toBe(true)
    const inscrite = world.registrations.find(
      (r) => r.occurrenceId === libre!.id && r.patientUid === 'demo-patient',
    )
    expect(inscrite?.status).toBe('confirmed')
  })

  it('la fait ensuite figurer dans la liste des inscrits', async () => {
    const app = createMockStaffApp()
    const libre = [...world.occurrences.values()].find(
      (o) => !o.registrationRequired && o.capacity === null && o.start.getTime() > Date.now(),
    )!
    await app.repository.registerPatient(libre.id, 'demo-patient')

    const liste = await app.repository.roster(libre.id)
    expect(liste.map((l) => l.patientUid)).toContain('demo-patient')
  })
})
