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

  it('supprime un lieu que rien n’utilise', async () => {
    const app = createMockStaffApp()
    mockCatalog.saveLocation({ id: 'salle-inutile', name: 'Salle inutile', isActive: true })
    expect(mockCatalog.locations().some((l) => l.id === 'salle-inutile')).toBe(true)

    const plan = await app.catalogAdmin.removeEntry('location', 'salle-inutile')

    expect(plan.action).toBe('deleted')
    expect(mockCatalog.locations().some((l) => l.id === 'salle-inutile')).toBe(false)
  })

  it('retire sans effacer un lieu déjà utilisé', async () => {
    const app = createMockStaffApp()
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
    const app = createMockStaffApp()
    const plan = await app.catalogAdmin.removeEntry('service', 'le-mazurel')

    expect(plan.action).toBe('deactivated')
    expect(plan.message).toContain('personne')
  })
})
