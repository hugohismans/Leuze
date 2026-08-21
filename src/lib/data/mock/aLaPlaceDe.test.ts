import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { createMockRepository } from './mockRepository'
import { resetWorld, world } from './state'

/**
 * « Voir à leur place », de bout en bout sur la démonstration.
 *
 * Ce qui compte n'est pas seulement d'ouvrir la session : c'est que l'écran change
 * réellement de point de vue. Prendre la place d'un patient de la Ferme doit donner le
 * calendrier de la Ferme ; prendre celle d'un intervenant doit retirer les droits
 * d'administrateur, sans quoi l'outil mentirait sur ce qu'il montre.
 */
describe('voir l’application à la place de quelqu’un', () => {
  beforeEach(() => {
    resetWorld()
  })

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    return app
  }

  it('propose le personnel et les patients, sans rien d’autre', async () => {
    const app = await ouvrir()
    const comptes = await app.superAdmin.listAccounts()

    expect(comptes.filter((c) => c.kind === 'staff').length).toBeGreaterThan(0)
    expect(comptes.filter((c) => c.kind === 'patient').length).toBeGreaterThan(0)
    /*
      Un prénom, un service ou un poste : rien de plus ne sort de la liste. Un compte du
      personnel porte en plus son rôle et l'intervenant auquel il est relié — ce qu'il
      faut pour proposer la case « Administrateur », et rien qui touche à quelqu'un.
    */
    for (const compte of comptes) {
      const attendu =
        compte.kind === 'staff'
          ? ['detail', 'kind', 'label', 'practitionerId', 'role', 'uid']
          : ['detail', 'kind', 'label', 'uid']
      expect(Object.keys(compte).sort()).toEqual(attendu)
    }
  })

  it('prend la place d’un patient : c’est son service qui décide de ce qu’on voit', async () => {
    const app = await ouvrir()
    const patient = world.patients.find((p) => p.serviceId !== 'le-mazurel')!

    const resultat = await app.superAdmin.impersonate(patient.uid)

    expect(resultat.ok).toBe(true)
    expect(app.session.current().role).toBeNull()
    expect(createMockRepository().session.current()).toEqual({
      patientUid: patient.uid,
      firstName: patient.firstName,
      serviceId: patient.serviceId,
    })
  })

  it('prend la place d’un intervenant : il n’est plus administrateur', async () => {
    const app = await ouvrir()
    expect(app.session.current().role).toBe('admin')

    const resultat = await app.superAdmin.impersonate('staff-docteur-lemaire')

    expect(resultat.ok).toBe(true)
    const identite = app.session.current()
    expect(identite.role).toBe('staff')
    expect(identite.practitionerId).toBe('docteur-lemaire')
  })

  it('n’ouvre rien pour un compte qui n’existe pas', async () => {
    const app = await ouvrir()
    const resultat = await app.superAdmin.impersonate('personne')

    expect(resultat).toEqual({ ok: false, message: "Ce compte n'existe pas." })
    expect(app.session.current().role).toBe('admin')
  })

  it('revient à son compte, et rend ses droits', async () => {
    const app = await ouvrir()
    await app.superAdmin.impersonate('staff-docteur-lemaire')

    await app.superAdmin.resume('demo')

    expect(app.session.current().role).toBe('admin')
    expect(world.impersonating).toBeNull()
  })

  it('l’appel suit le point de vue : chacun ne fait que le sien', async () => {
    const app = await ouvrir()
    const sienne = [...world.occurrences.values()].find((o) => o.facilitatorId === 'docteur-lemaire')!
    const autre = [...world.occurrences.values()].find((o) => o.facilitatorId === 'marc')!

    await app.superAdmin.impersonate('staff-docteur-lemaire')

    expect((await app.repository.roster(sienne.id)).canMarkAttendance).toBe(true)
    expect((await app.repository.roster(autre.id)).canMarkAttendance).toBe(false)
  })
})
