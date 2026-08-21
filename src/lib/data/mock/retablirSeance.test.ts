import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'

/**
 * Annuler une séance doit pouvoir se défaire. Le cas courant n'est pas l'erreur de clic :
 * modifier une activité annule d'office les séances déjà inscrites qui ne correspondent
 * plus. Sans retour en arrière, il fallait recréer l'activité — donc perdre les
 * inscriptions, ce que l'annulation cherchait justement à préserver.
 */
describe('rétablir une séance annulée', () => {
  beforeEach(() => {
    resetWorld()
  })

  it('la remet au programme avec ses inscriptions', async () => {
    const app = createMockStaffApp()
    const inscrite = world.registrations[0]!
    const seance = world.occurrences.get(inscrite.occurrenceId)!
    const inscrits = seance.confirmedCount

    await app.repository.cancelOccurrence(seance.id, "L'animateur est absent")
    expect(world.occurrences.get(seance.id)?.status).toBe('cancelled')

    await app.repository.restoreOccurrence(seance.id)

    const remise = world.occurrences.get(seance.id)
    expect(remise?.status).toBe('scheduled')
    expect(remise?.cancellationReason ?? '').toBe('')
    expect(remise?.confirmedCount).toBe(inscrits)
    expect(world.registrations).toContain(inscrite)
  })
})
