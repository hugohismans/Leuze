import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world } from './state'
import { pendingForViewer, visibleAppointments } from '../../domain/appointmentAccess'

/**
 * Une demande nominative arrive dans la file de la personne nommée.
 *
 * Constaté en service : Bernard demande à voir Lola ; l'administrateur voit la demande,
 * le compteur de Lola affiche « 1 », et son écran n'affiche rien. La file entière était
 * réservée à l'administrateur — ce qui était juste tant qu'une demande ne nommait
 * personne, et faux depuis qu'elle porte un nom.
 *
 * Ce que ces tests fixent : la demande atteint réellement l'intervenant, et le compteur
 * annonce exactement ce que l'écran montrera. Un compteur qui fait chercher ce qui n'est
 * pas affiché est pire que pas de compteur du tout.
 */
describe('la file d’un intervenant', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = []
    mockCatalog.savePractitioner({
      id: 'lola',
      name: 'Lola',
      role: 'Assistante sociale',
      kindId: 'assistant-social',
      audience: 'all',
      serviceIds: [],
      isActive: true,
    })
  })

  const demanderLola = async () => {
    const repo = createMockRepository()
    const resultat = await repo.appointments.request('assistant-social', 'apres-midi', 'lola')
    expect(resultat.ok).toBe(true)
  }

  it('reçoit la demande qui la nomme', async () => {
    await demanderLola()
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    await app.superAdmin.impersonate('staff-lola')

    const siennes = await app.repository.listAppointments()
    expect(siennes.map((a) => a.practitionerId)).toContain('lola')
    expect(siennes.some((a) => a.status === 'requested')).toBe(true)
  })

  it('ne reçoit pas celle qui nomme un collègue', async () => {
    mockCatalog.savePractitioner({
      id: 'karim',
      name: 'Karim',
      role: 'Assistant social',
      kindId: 'assistant-social',
      audience: 'all',
      serviceIds: [],
      isActive: true,
    })
    await demanderLola()

    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    await app.superAdmin.impersonate('staff-karim')
    expect(await app.repository.listAppointments()).toHaveLength(0)
  })

  it('le compteur annonce exactement ce que l’écran montrera', async () => {
    await demanderLola()
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    await app.superAdmin.impersonate('staff-lola')

    const moi = { role: 'staff' as const, practitionerId: 'lola' }
    const siennes = await app.repository.listAppointments()
    const compteur = pendingForViewer(moi, siennes, mockCatalog.practitioners())
    const affichees = visibleAppointments(moi, siennes).filter((a) => a.status === 'requested')

    expect(compteur).toBe(1)
    expect(affichees).toHaveLength(compteur)
  })

  it('l’administrateur la voit aussi : la bulle peut toujours fixer', async () => {
    await demanderLola()
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    const toutes = await app.repository.listAppointments()
    expect(toutes.some((a) => a.practitionerId === 'lola' && a.status === 'requested')).toBe(true)
  })
})
