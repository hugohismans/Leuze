import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'

/**
 * Proposer une activité, de bout en bout.
 *
 * Le programme se construit pour les patients ; rien n'oblige à ce qu'il se construise
 * sans eux. Ce qui se vérifie ici, ce sont les trois garde-fous — pas la mécanique :
 * rien ne paraît sans validation, les textes restent courts, et une seule idée attend à
 * la fois.
 */
const ouvrirSoignant = async (email = 'soignant@exemple.test') => {
  const app = createMockStaffApp()
  await app.session.signIn(email, 'peu-importe')
  return app
}

const IDEE = {
  title: 'Tournoi d’échecs',
  description: 'On jouerait aux échecs. Je peux apprendre les règles à ceux qui ne savent pas.',
  wantsToLead: true,
}

describe('déposer une idée', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.proposals = []
  })

  it('l’enregistre au nom de la personne connectée, en attente', async () => {
    const patient = createMockRepository()
    const resultat = await patient.proposals.submit(IDEE)
    expect(resultat.ok).toBe(true)

    const miennes = await patient.proposals.listMine()
    expect(miennes).toHaveLength(1)
    expect(miennes[0]).toMatchObject({
      title: 'Tournoi d’échecs',
      status: 'proposed',
      wantsToLead: true,
      patientUid: DEMO_PATIENT_UID,
    })
    // Le prénom voyage avec l'idée : sans lui, l'administrateur répondrait à un identifiant.
    expect(miennes[0]?.patientFirstName).toBeTruthy()
  })

  it('refuse un texte trop court, et dit quoi faire', async () => {
    const patient = createMockRepository()
    const sansTexte = await patient.proposals.submit({ ...IDEE, description: 'échecs' })
    expect(sansTexte.ok).toBe(false)
    expect(sansTexte.message).toContain('une phrase')

    const sansNom = await patient.proposals.submit({ ...IDEE, title: 'a' })
    expect(sansNom.ok).toBe(false)
    expect(sansNom.message).toContain('Par exemple')
  })

  it('refuse un texte trop long : ce champ n’est pas un message à un soignant', async () => {
    const patient = createMockRepository()
    const resultat = await patient.proposals.submit({ ...IDEE, description: 'x'.repeat(500) })
    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain('trop long')
  })

  it('n’en accepte qu’une à la fois, et l’explique', async () => {
    const patient = createMockRepository()
    await patient.proposals.submit(IDEE)
    const seconde = await patient.proposals.submit({ ...IDEE, title: 'Atelier tricot' })
    expect(seconde.ok).toBe(false)
    expect(seconde.message).toContain('déjà une idée en attente')
    expect(world.proposals).toHaveLength(1)
  })

  it('en laisse déposer une autre une fois la première traitée', async () => {
    const patient = createMockRepository()
    await patient.proposals.submit(IDEE)
    const admin = await ouvrirSoignant('admin@exemple.test')
    await admin.repository.decideProposal(world.proposals[0]!.id, 'declined', {
      declineReason: 'Pas de salle libre à ce moment-là.',
    })

    const seconde = await patient.proposals.submit({ ...IDEE, title: 'Atelier tricot' })
    expect(seconde.ok).toBe(true)
    expect(world.proposals).toHaveLength(2)
  })

  it('ne montre à personne les idées des autres', async () => {
    const patient = createMockRepository()
    world.proposals = [
      {
        id: 'idee-de-quelquun-dautre',
        patientUid: 'un-autre-patient',
        title: 'Atelier poterie',
        description: 'Je voudrais faire de la poterie avec deux ou trois personnes.',
        wantsToLead: false,
        status: 'proposed',
        createdAt: new Date(),
      },
    ]
    expect(await patient.proposals.listMine()).toEqual([])
  })
})

describe('répondre à une idée', () => {
  beforeEach(async () => {
    resetWorld()
    mockCatalog.reset()
    world.proposals = []
    await createMockRepository().proposals.submit(IDEE)
  })

  const idee = () => world.proposals[0]!

  it('est refusé à qui n’est pas administrateur', async () => {
    /*
      La démonstration n'a qu'un seul compte du personnel, et il est administrateur : on
      éprouve donc la garde avec une session fermée, qui n'a aucun rôle. Le refus opposé
      à un soignant ordinaire, lui, est vérifié là où il vit réellement — dans les règles
      Firestore (`tests/rules/`) et dans `requireAdmin` côté serveur.
    */
    const personne = createMockStaffApp()
    await expect(personne.repository.decideProposal(idee().id, 'accepted')).rejects.toThrow(
      "réservée à l'administrateur",
    )
    expect(idee().status).toBe('proposed')
  })

  it('retient l’idée, et le patient le lit', async () => {
    const admin = await ouvrirSoignant('admin@exemple.test')
    const resultat = await admin.repository.decideProposal(idee().id, 'accepted')
    expect(resultat.ok).toBe(true)

    const miennes = await createMockRepository().proposals.listMine()
    expect(miennes[0]?.status).toBe('accepted')
  })

  it('exige un motif pour ne pas retenir : « non » sans raison décourage plus que le refus', async () => {
    const admin = await ouvrirSoignant('admin@exemple.test')
    const sansMotif = await admin.repository.decideProposal(idee().id, 'declined')
    expect(sansMotif.ok).toBe(false)
    expect(idee().status).toBe('proposed')

    const avecMotif = await admin.repository.decideProposal(idee().id, 'declined', {
      declineReason: 'Il n’y a pas de salle libre. Reproposez-la à la rentrée.',
    })
    expect(avecMotif.ok).toBe(true)
    expect(idee().declineReason).toContain('rentrée')
  })

  it('ne revient pas sur une réponse déjà donnée', async () => {
    const admin = await ouvrirSoignant('admin@exemple.test')
    await admin.repository.decideProposal(idee().id, 'accepted')
    const volteFace = await admin.repository.decideProposal(idee().id, 'declined', {
      declineReason: 'Finalement non.',
    })
    expect(volteFace.ok).toBe(false)
    expect(idee().status).toBe('accepted')
  })

  it('rattache l’activité créée à l’idée, sans la décider une seconde fois', async () => {
    const admin = await ouvrirSoignant('admin@exemple.test')
    await admin.repository.decideProposal(idee().id, 'accepted')
    const rattachement = await admin.repository.decideProposal(idee().id, 'accepted', {
      activityId: 'activite-née-de-lidee',
    })
    expect(rattachement.ok).toBe(true)
    expect(idee().activityId).toBe('activite-née-de-lidee')
    expect(idee().status).toBe('accepted')
  })

  it('refuse une idée qui n’existe pas', async () => {
    const admin = await ouvrirSoignant('admin@exemple.test')
    const resultat = await admin.repository.decideProposal('idee-inexistante', 'accepted')
    expect(resultat.ok).toBe(false)
  })
})
