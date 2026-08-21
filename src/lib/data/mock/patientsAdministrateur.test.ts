import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'

/**
 * Faire entrer quelqu'un dans l'application, lui délivrer un code, clôturer son séjour :
 * trois gestes réservés à l'administrateur. Le code étant affiché en clair à qui le
 * demande, quiconque peut en délivrer un peut ouvrir la session de cette personne.
 *
 * Le serveur le vérifie de son côté ; la démonstration doit refuser la même chose, sans
 * quoi prendre la place d'un soignant ne montrerait pas ce qu'il voit vraiment.
 */
describe('la liste des patients ne se modifie qu’en administrateur', () => {
  beforeEach(() => {
    resetWorld()
  })

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    return app
  }

  it('laisse l’administrateur ajouter quelqu’un', async () => {
    const app = await ouvrir()
    const avant = world.patients.length

    const code = await app.repository.createPatient('Lele', 'la-joncquerelle')

    expect(code.printableCode).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/)
    expect(world.patients.length).toBe(avant + 1)
  })

  it('refuse les trois gestes à un soignant ordinaire', async () => {
    const app = await ouvrir()
    const patient = world.patients[0]!
    // On prend la place d'un intervenant : il n'est pas administrateur.
    await app.superAdmin.impersonate('staff-docteur-lemaire')
    expect(app.session.current().role).toBe('staff')

    const avant = world.patients.length
    await expect(app.repository.createPatient('Lele', 'la-joncquerelle')).rejects.toThrow(
      /administrateur/,
    )
    await expect(app.repository.regenerateCode(patient.uid)).rejects.toThrow(/administrateur/)
    await expect(app.repository.endStay(patient.uid)).rejects.toThrow(/administrateur/)
    expect(world.patients.length).toBe(avant)
  })

  it('laisse ce même soignant consulter la liste', async () => {
    const app = await ouvrir()
    await app.superAdmin.impersonate('staff-docteur-lemaire')

    // Consulter reste possible : c'est ce qui sert à la réunion du lundi.
    expect((await app.repository.listPatients()).length).toBeGreaterThan(0)
  })
})
