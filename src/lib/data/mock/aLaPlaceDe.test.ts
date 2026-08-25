import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * Le rôle réel du compte, au rechargement.
 *
 * « Voir à leur place » recharge la page. L'adapter se reconstruit alors, et c'est un
 * bloc de reprise — et non `impersonate` — qui refabrique l'identité : il posait
 * « soignant » en dur. On prenait donc la place de quelqu'un pour voir ce qu'il voit, et
 * l'on voyait autre chose. Le rôle donné pendant la visite se perdait par-dessus le
 * marché, puisqu'il ne vivait qu'en mémoire.
 */
describe('reprendre un détour après un rechargement', () => {
  /*
    Un `sessionStorage` en mémoire.

    Les tests tournent sous Node, qui n'en a pas : sans lui, tout ce qui doit survivre au
    rechargement disparaît en silence et le test passerait sans rien prouver. Celui-ci se
    comporte comme celui du navigateur, et rien de plus.
  */
  const memoire = new Map<string, string>()
  const faux = {
    getItem: (cle: string) => memoire.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void memoire.set(cle, valeur),
    removeItem: (cle: string) => void memoire.delete(cle),
    clear: () => memoire.clear(),
    key: (i: number) => [...memoire.keys()][i] ?? null,
    get length() {
      return memoire.size
    },
  }

  beforeAll(() => {
    Object.defineProperty(globalThis, 'sessionStorage', { value: faux, configurable: true })
  })
  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  })

  beforeEach(() => {
    memoire.clear()
    resetWorld()
  })

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    return app
  }

  it('rend l’administrateur administrateur, et pas simple soignant', async () => {
    const app = await ouvrir()
    await app.catalogAdmin.setStaffRole('staff-claire', 'admin')
    await app.superAdmin.impersonate('staff-claire')

    // Le rechargement : un adapter tout neuf, qui ne connaît que le stockage de session.
    const apres = createMockStaffApp()
    expect(apres.session.current().practitionerId).toBe('claire')
    expect(apres.session.current().role).toBe('admin')
  })

  it('laisse simple soignant celui qui l’est', async () => {
    const app = await ouvrir()
    await app.superAdmin.impersonate('staff-julien')

    const apres = createMockStaffApp()
    expect(apres.session.current().practitionerId).toBe('julien')
    expect(apres.session.current().role).toBe('staff')
  })

  it('n’accorde le rôle qu’à qui l’a reçu', async () => {
    const app = await ouvrir()
    await app.catalogAdmin.setStaffRole('staff-claire', 'admin')
    await app.superAdmin.impersonate('staff-sophie')

    expect(createMockStaffApp().session.current().role).toBe('staff')
  })

  it('garde le rôle donné pendant la visite, module rechargé compris', async () => {
    /*
      Le vrai rechargement, celui que « Voir à leur place » déclenche.

      Les deux appels précédents partagent l'état du module : ils ne prouvent donc rien
      sur ce qui survit à un `location.reload()`. Ici le module est réellement rejoué —
      le registre des rôles repart de zéro, et seul le stockage de session peut encore
      dire que Claire est administratrice.
    */
    const app = await ouvrir()
    await app.catalogAdmin.setStaffRole('staff-claire', 'admin')
    await app.superAdmin.impersonate('staff-claire')

    vi.resetModules()
    const rejoue = await import('./index')
    const apres = rejoue.createMockStaffApp()
    expect(apres.session.current().practitionerId).toBe('claire')
    expect(apres.session.current().role).toBe('admin')
  })
})
