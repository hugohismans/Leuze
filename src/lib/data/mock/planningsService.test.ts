import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world, DEMO_SERVICE_ID } from './state'
import { startOfIsoWeek, todayLocalDate, addLocalDays } from '../../domain/time'

/**
 * La pile de plannings imprimée à la fin de la réunion : une feuille par personne du
 * service, y compris pour qui n'est inscrit à rien — une grille vide se remplit à la main.
 */
describe('les plannings d’un service', () => {
  beforeEach(() => {
    resetWorld()
  })

  const semaine = () => {
    const debut = startOfIsoWeek(todayLocalDate())
    return { debut, fin: addLocalDays(debut, 6) }
  }

  it('donne une feuille à chaque personne du service, et à elles seules', async () => {
    const app = createMockStaffApp()
    const { debut, fin } = semaine()

    const plannings = await app.repository.weekPlannings(debut, fin, DEMO_SERVICE_ID)

    const attendus = world.patients.filter((p) => p.serviceId === DEMO_SERVICE_ID).map((p) => p.uid)
    expect(plannings.map((p) => p.patientUid).sort()).toEqual(attendus.sort())
    expect(plannings.length).toBeGreaterThan(0)
  })

  it('range les prénoms dans l’ordre, pour distribuer la pile sans la trier', async () => {
    const app = createMockStaffApp()
    const { debut, fin } = semaine()

    const prenoms = (await app.repository.weekPlannings(debut, fin, DEMO_SERVICE_ID)).map((p) => p.firstName)

    expect(prenoms).toEqual([...prenoms].sort((a, b) => a.localeCompare(b, 'fr')))
  })

  it('ne retient que les séances de la semaine demandée', async () => {
    const app = createMockStaffApp()
    const { debut, fin } = semaine()

    const plannings = await app.repository.weekPlannings(debut, fin, DEMO_SERVICE_ID)

    for (const planning of plannings) {
      for (const ligne of planning.lines) {
        const occurrence = world.occurrences.get(ligne.occurrenceId)
        expect(occurrence).toBeDefined()
        expect(occurrence!.localDate >= debut && occurrence!.localDate <= fin).toBe(true)
      }
    }
  })

  it('n’oublie pas ceux qui ne sont inscrits à rien', async () => {
    const app = createMockStaffApp()
    const { debut, fin } = semaine()
    world.patients.push({ uid: 'p_nouveau', firstName: 'Aaron', serviceId: DEMO_SERVICE_ID })

    const plannings = await app.repository.weekPlannings(debut, fin, DEMO_SERVICE_ID)

    const nouveau = plannings.find((p) => p.patientUid === 'p_nouveau')
    expect(nouveau).toBeDefined()
    expect(nouveau?.lines).toEqual([])
  })
})
