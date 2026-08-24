import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'

/**
 * Demander à voir quelqu'un en particulier, de bout en bout.
 *
 * Un patient ne veut souvent pas « un psychiatre » mais celui qu'il connaît. Le nom
 * n'est pas une promesse — la demande reste une demande — mais trois choses doivent
 * tenir : on ne propose que des personnes qui passent réellement dans son unité, le nom
 * demandé reste porté par la demande (c'est lui qui la fait arriver dans la bonne file),
 * et l'on ne se rabat jamais sur un collègue sans le dire.
 */
describe('demander une personne en particulier', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = []
  })

  const ouvrir = () => createMockRepository()

  it("ne propose que des personnes qui passent dans l'unité du patient", () => {
    // Camille est au Mazurel ; Claire y passe, Julien aussi, mais pas dans les autres.
    const claire = mockCatalog.practitioners().find((p) => p.id === 'claire')!
    expect(claire.serviceIds).toContain('le-mazurel')
    expect(claire.serviceIds).not.toContain('l-ancrive')
  })

  it('enregistre le nom demandé sur la demande', async () => {
    const repo = ouvrir()
    const resultat = await repo.appointments.request('psychologue', 'peu-importe', 'claire')
    expect(resultat.ok).toBe(true)
    const demande = world.appointments.find((a) => a.patientUid === DEMO_PATIENT_UID)
    expect(demande?.practitionerId).toBe('claire')
  })

  it("refuse quelqu'un qui ne tient pas ce motif", async () => {
    const repo = ouvrir()
    const resultat = await repo.appointments.request('psychiatre', 'peu-importe', 'claire')
    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain('ne peut pas vous recevoir')
    expect(world.appointments).toHaveLength(0)
  })

  it("refuse quelqu'un qui ne passe pas dans l'unité du patient", async () => {
    mockCatalog.savePractitioner({
      id: 'claire',
      name: 'Claire',
      role: 'Psychologue',
      kindId: 'psychologue',
      audience: 'services',
      serviceIds: ['l-ancrive'],
      isActive: true,
    })
    const repo = ouvrir()
    const resultat = await repo.appointments.request('psychologue', 'peu-importe', 'claire')
    expect(resultat.ok).toBe(false)
    expect(world.appointments).toHaveLength(0)
  })

  it("refuse quelqu'un qui n'est plus en poste", async () => {
    mockCatalog.savePractitioner({
      id: 'claire',
      name: 'Claire',
      role: 'Psychologue',
      kindId: 'psychologue',
      audience: 'services',
      serviceIds: ['le-mazurel'],
      isActive: false,
    })
    const repo = ouvrir()
    expect((await repo.appointments.request('psychologue', 'peu-importe', 'claire')).ok).toBe(false)
  })

  it('sans nom, rien ne change : la demande part comme avant', async () => {
    const repo = ouvrir()
    const resultat = await repo.appointments.request('psychologue', 'peu-importe')
    expect(resultat.ok).toBe(true)
    expect(world.appointments[0]?.practitionerId).toBeUndefined()
  })

  it('ne se rabat pas sur un collègue qui accepte automatiquement', async () => {
    /*
      Deux psychiatres : celui qu'on demande n'accepte pas automatiquement, l'autre si.
      Retenir une place chez l'autre ferait exactement le contraire de ce qui vient
      d'être demandé — et sans le dire.
    */
    mockCatalog.savePractitioner({
      id: 'ada',
      name: 'Ada',
      role: 'Psychiatre',
      kindId: 'psychiatre',
      audience: 'all',
      serviceIds: [],
      availability: [{ weekday: 2, from: '09:00', to: '12:00' }],
      autoAccept: true,
      isActive: true,
    })

    const repo = ouvrir()
    const resultat = await repo.appointments.request('psychiatre', 'peu-importe', 'docteur-lemaire')
    expect(resultat.ok).toBe(true)
    expect(resultat.scheduled).toBe(false)
    const demande = world.appointments[0]
    expect(demande?.status).toBe('requested')
    expect(demande?.practitionerId).toBe('docteur-lemaire')
  })
})
