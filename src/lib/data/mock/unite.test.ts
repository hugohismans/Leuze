import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'
import { appointmentsOfUnit, patientsOfUnit } from '../../domain/unit'

/**
 * Le rattachement d'un compte à une unité de soins.
 *
 * Ce n'est pas un droit : le compte voit exactement ce qu'il voyait, et une case le lui
 * rend. Ces tests vérifient donc deux choses — que le réglage se garde sur le compte
 * (et non dans le navigateur), et qu'il ne fait rien disparaître pour de bon.
 */
describe("l'unité d'un compte du personnel", () => {
  beforeEach(() => {
    resetWorld()
  })

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  it("n'en a aucune au départ", async () => {
    const app = await ouvrir()
    expect(await app.repository.readMyUnit()).toBeNull()
  })

  it('se garde une fois enregistrée', async () => {
    const app = await ouvrir()
    const resultat = await app.repository.saveMyUnit('le-mazurel')
    expect(resultat.ok).toBe(true)
    expect(await app.repository.readMyUnit()).toBe('le-mazurel')
  })

  it('se retire', async () => {
    const app = await ouvrir()
    await app.repository.saveMyUnit('le-mazurel')
    await app.repository.saveMyUnit(null)
    expect(await app.repository.readMyUnit()).toBeNull()
  })

  it('suit le compte, et non l’écran : une nouvelle session la retrouve', async () => {
    const app = await ouvrir()
    await app.repository.saveMyUnit('la-joncquerelle')
    const autre = createMockStaffApp()
    await autre.session.signIn('admin@exemple.test', 'peu-importe')
    expect(await autre.repository.readMyUnit()).toBe('la-joncquerelle')
  })

  it('restreint les patients et les rendez-vous, sans rien effacer', async () => {
    const app = await ouvrir()
    const patients = await app.repository.listPatients()
    const rendezVous = await app.repository.listAppointments()
    const serviceDe = (uid: string) => patients.find((p) => p.uid === uid)?.serviceId ?? null

    const duMazurel = patientsOfUnit(patients, 'le-mazurel')
    expect(duMazurel.length).toBeGreaterThan(0)
    expect(duMazurel.length).toBeLessThan(patients.length)
    expect(duMazurel.every((p) => p.serviceId === 'le-mazurel')).toBe(true)

    // La case « Voir toutes les unités » se traduit par une unité nulle : tout revient.
    expect(patientsOfUnit(patients, null)).toEqual(patients)
    expect(appointmentsOfUnit(rendezVous, serviceDe, null)).toEqual(rendezVous)

    // Et le monde n'a pas bougé : filtrer n'est pas supprimer.
    expect(world.patients.length).toBe(patients.length)
  })
})
