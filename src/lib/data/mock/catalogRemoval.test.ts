import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld } from './state'

/**
 * L'adapter de démonstration doit prendre la même décision que le serveur : supprimer ce
 * que rien n'utilise, retirer le reste sans rien effacer. C'est aussi ce que voit
 * l'écran `/demo`, donc ce qu'un soignant essaie avant de toucher au vrai catalogue.
 */
describe('retrait d’une entrée dans la démonstration', () => {
  beforeEach(() => {
    resetWorld()
  })

  /** Le catalogue est réservé à l'administrateur, ici comme dans les règles Firestore. */
  const admin = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  it('supprime un lieu que rien n’utilise', async () => {
    const app = await admin()
    mockCatalog.saveLocation({ id: 'salle-inutile', name: 'Salle inutile', isActive: true })
    expect(mockCatalog.locations().some((l) => l.id === 'salle-inutile')).toBe(true)

    const plan = await app.catalogAdmin.removeEntry('location', 'salle-inutile')

    expect(plan.action).toBe('deleted')
    expect(mockCatalog.locations().some((l) => l.id === 'salle-inutile')).toBe(false)
  })

  it('retire sans effacer un lieu déjà utilisé', async () => {
    const app = await admin()
    const activites = await app.repository.listActivities()
    const utilise = activites[0]!.locationId

    const plan = await app.catalogAdmin.removeEntry('location', utilise)

    expect(plan.action).toBe('deactivated')
    const lieu = mockCatalog.locations().find((l) => l.id === utilise)
    // Toujours présent — sinon les séances déjà programmées perdraient le nom de leur lieu.
    expect(lieu).toBeDefined()
    expect(lieu?.isActive).toBe(false)
  })

  it('compte les personnes rattachées à un service', async () => {
    const app = await admin()
    const plan = await app.catalogAdmin.removeEntry('service', 'le-mazurel')

    expect(plan.action).toBe('deactivated')
    expect(plan.message).toContain('personne')
  })
})

/**
 * Le catalogue est réservé à l'administrateur, ici comme dans les règles Firestore.
 *
 * Les garde-fous avaient été posés et les tests modifiés pour ouvrir une session
 * d'administrateur — ce qui les remettait au vert sans que rien ne dise qu'un simple
 * soignant est refusé. Un garde-fou qu'aucun test ne réclame se retire tout seul, un
 * jour de refonte, sans que personne ne le voie.
 *
 * On prend la place d'un intervenant ordinaire : c'est la vraie situation, et c'est
 * exactement ce que la démonstration doit montrer.
 */
describe('le catalogue, pour qui n’est pas administrateur', () => {
  beforeEach(() => {
    resetWorld()
  })

  const soignantOrdinaire = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    // « Julien » est intervenant, sans droits d'administrateur.
    await app.superAdmin.impersonate('staff-julien')
    return app
  }

  it('refuse d’ajouter un lieu, un service, une catégorie ou un motif', async () => {
    const app = await soignantOrdinaire()
    await expect(
      app.catalogAdmin.saveLocation({ id: 'salle-x', name: 'Salle X', isActive: true }),
    ).rejects.toThrow(/administrateur/)
    await expect(
      app.catalogAdmin.saveService({ id: 'service-x', name: 'Service X', isActive: true }),
    ).rejects.toThrow(/administrateur/)
    await expect(
      app.catalogAdmin.saveCategory({
        id: 'cat-x',
        name: 'Catégorie X',
        icon: '🎲',
        colorToken: 'brand',
        isActive: true,
      }),
    ).rejects.toThrow(/administrateur/)
    await expect(
      app.catalogAdmin.saveAppointmentKind({
        id: 'motif-x',
        name: 'Motif X',
        icon: '🩺',
        isActive: true,
      }),
    ).rejects.toThrow(/administrateur/)
  })

  it('n’écrit rien au passage : le catalogue est inchangé', async () => {
    const app = await soignantOrdinaire()
    const avant = mockCatalog.locations().length
    await app.catalogAdmin
      .saveLocation({ id: 'salle-x', name: 'Salle X', isActive: true })
      .catch(() => undefined)
    expect(mockCatalog.locations()).toHaveLength(avant)
    expect(mockCatalog.locations().some((l) => l.id === 'salle-x')).toBe(false)
  })

  it('refuse de retirer une entrée', async () => {
    const app = await soignantOrdinaire()
    const lieu = mockCatalog.locations()[0]!
    await expect(app.catalogAdmin.removeEntry('location', lieu.id)).rejects.toThrow(/administrateur/)
    expect(mockCatalog.locations().some((l) => l.id === lieu.id)).toBe(true)
  })

  it('dit quoi faire, plutôt que « refusé »', async () => {
    const app = await soignantOrdinaire()
    await expect(
      app.catalogAdmin.saveLocation({ id: 'salle-x', name: 'Salle X', isActive: true }),
    ).rejects.toThrow("Cette action est réservée à l'administrateur.")
  })
})
