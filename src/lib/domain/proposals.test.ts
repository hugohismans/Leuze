import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_MAX,
  PROPOSAL_IDEAS,
  TITLE_MAX,
  alreadyWaiting,
  cleanProposal,
  patientProposalLabel,
  pendingProposals,
  validateProposal,
  waitingDays,
  type ActivityProposal,
  remainingNotice,
} from './proposals'

const idee = (overrides: Partial<ActivityProposal> = {}): ActivityProposal => ({
  id: 'idee-1',
  patientUid: 'p_camille',
  title: 'Tournoi d’échecs',
  description: 'Deux tables, des parties de vingt minutes, et un tableau des scores.',
  wantsToLead: true,
  status: 'proposed',
  createdAt: new Date('2026-08-18T10:00:00Z'),
  ...overrides,
})

describe('ce qu’une proposition doit contenir', () => {
  it('accepte une idée nommée et décrite', () => {
    expect(validateProposal(idee())).toEqual({ ok: true })
  })

  it('refuse une idée sans nom, en disant quoi écrire', () => {
    const refus = validateProposal({ title: '  ', description: 'On jouerait aux cartes.', wantsToLead: false })
    expect(refus.ok).toBe(false)
    expect(refus.ok === false && refus.message).toContain('Donnez un nom')
  })

  it('refuse une description trop courte : « ok » n’explique rien', () => {
    const refus = validateProposal({ title: 'Échecs', description: 'ok', wantsToLead: false })
    expect(refus.ok).toBe(false)
    expect(refus.ok === false && refus.message).toContain('une phrase')
  })

  it('refuse les textes trop longs — le champ libre reste court, volontairement', () => {
    const long = validateProposal({
      title: 'a'.repeat(TITLE_MAX + 1),
      description: 'Une description tout à fait correcte.',
      wantsToLead: false,
    })
    expect(long.ok).toBe(false)

    const bavard = validateProposal({
      title: 'Échecs',
      description: 'a'.repeat(DESCRIPTION_MAX + 1),
      wantsToLead: false,
    })
    expect(bavard.ok).toBe(false)
    expect(bavard.ok === false && bavard.message).toContain(String(DESCRIPTION_MAX))
  })

  it('ne compte pas les espaces comme du texte', () => {
    const refus = validateProposal({ title: 'Échecs', description: `   ${' '.repeat(40)}   `, wantsToLead: false })
    expect(refus.ok).toBe(false)
  })
})

describe('le brouillon nettoyé', () => {
  it('perd ses espaces et n’invente pas d’intention', () => {
    expect(
      cleanProposal({ title: '  Échecs  ', description: '  On joue aux échecs.  ', wantsToLead: false }),
    ).toEqual({ title: 'Échecs', description: 'On joue aux échecs.', wantsToLead: false })
  })
})

describe('ce que le patient lit', () => {
  it('dit que l’idée est partie, sans promettre de délai', () => {
    expect(patientProposalLabel(idee())).toContain('Un soignant va la lire')
  })

  it('dit qu’elle est retenue — sans promettre un programme qui n’existe pas encore', () => {
    const texte = patientProposalLabel(idee({ status: 'accepted' }))
    expect(texte).toContain('retenue')
    /*
      Retenir une idée ouvre le formulaire de création : l'activité n'existe pas encore, et
      le soignant peut être appelé ailleurs avant de l'avoir enregistrée. Envoyer le patient
      la chercher dans le calendrier, c'est lui faire constater une panne.
    */
    expect(texte).not.toContain('au programme')
  })

  it('donne le motif d’un refus quand il y en a un, et invite à réessayer sinon', () => {
    expect(patientProposalLabel(idee({ status: 'declined', declineReason: 'la salle n’est pas libre' }))).toContain(
      'la salle n’est pas libre',
    )
    expect(patientProposalLabel(idee({ status: 'declined' }))).toContain('en proposer une autre')
  })
})

describe('la file des idées', () => {
  it('met les plus anciennes en tête, et ignore ce qui est déjà tranché', () => {
    const file = pendingProposals([
      idee({ id: 'recente', createdAt: new Date('2026-08-19T10:00:00Z') }),
      idee({ id: 'acceptee', status: 'accepted', createdAt: new Date('2026-08-10T10:00:00Z') }),
      idee({ id: 'ancienne', createdAt: new Date('2026-08-12T10:00:00Z') }),
    ])
    expect(file.map((p) => p.id)).toEqual(['ancienne', 'recente'])
  })

  it('compte l’attente en jours, jamais à l’envers', () => {
    const maintenant = new Date('2026-08-20T10:00:00Z')
    expect(waitingDays(idee({ createdAt: new Date('2026-08-20T09:00:00Z') }), maintenant)).toBe(0)
    expect(waitingDays(idee({ createdAt: new Date('2026-08-15T09:00:00Z') }), maintenant)).toBe(5)
    expect(waitingDays(idee({ createdAt: new Date('2026-08-25T09:00:00Z') }), maintenant)).toBe(0)
  })
})

describe('une seule idée en attente à la fois', () => {
  it('reconnaît celle qui attend déjà', () => {
    const file = [idee(), idee({ id: 'autre', patientUid: 'p_lucien' })]
    expect(alreadyWaiting(file, 'p_camille')).toBe(true)
    expect(alreadyWaiting(file, 'p_farida')).toBe(false)
  })

  it('ne retient pas ce qui a déjà reçu une réponse', () => {
    const file = [idee({ status: 'declined' }), idee({ id: 'b', status: 'accepted' })]
    expect(alreadyWaiting(file, 'p_camille')).toBe(false)
  })
})

describe('les exemples proposés au patient', () => {
  it('existent, et parlent d’activités — jamais de santé', () => {
    expect(PROPOSAL_IDEAS.length).toBeGreaterThanOrEqual(4)
    const tout = PROPOSAL_IDEAS.join(' ').toLowerCase()
    for (const interdit of ['médic', 'soin', 'traitement', 'diagnostic', 'symptôme']) {
      expect(tout).not.toContain(interdit)
    }
  })
})

/**
 * Le compte de caractères, sous les deux champs de « Proposer une activité ».
 *
 * Ils ne suivaient pas la même règle : le nom se taisait jusqu'aux vingt derniers
 * caractères, la description annonçait « Il vous reste 300 caractères » sous un champ
 * encore vide. Trois cents ne veut rien dire avant d'avoir écrit, et cette phrase de
 * plus se lit comme une consigne pour qui lit avec effort.
 */
describe('le compte de caractères restants', () => {
  const atteint = 'Vous avez atteint la longueur maximale du nom.'

  it('se tait tant qu’il reste de la place', () => {
    expect(remainingNotice(300, atteint)).toBeNull()
    expect(remainingNotice(21, atteint)).toBeNull()
  })

  it('paraît à l’approche de la limite', () => {
    expect(remainingNotice(20, atteint)).toBe('Il vous reste 20 caractères.')
  })

  it('accorde le singulier — « 1 caractère », et non « 1 caractères »', () => {
    expect(remainingNotice(1, atteint)).toBe('Il vous reste 1 caractère.')
  })

  it('dit que c’est fini, plutôt que « il vous reste 0 »', () => {
    expect(remainingNotice(0, atteint)).toBe(atteint)
    // Un texte collé plus long que la limite : le champ le coupe, le compte reste juste.
    expect(remainingNotice(-12, atteint)).toBe(atteint)
  })
})
