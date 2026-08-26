import { describe, expect, it } from 'vitest'
import {
  becomeParticipantLabel,
  fullButWatchableMessage,
  registrationBlock,
  registrationBlockMessage,
  spectatorActionLabel,
  spectatorsOf,
  staffCapacityLabel,
  unregisterActionLabel,
} from './capacity'
import { patientRegistrationDecision, type BusyEntry } from './conflicts'
import { makeOccurrence } from './fixtures'
import { register, rosterOf, unregister, waitlistPosition, type Board } from './waitlist'

/**
 * Venir regarder, sans prendre la place de personne.
 *
 * Certains patients viennent s'asseoir à côté de l'atelier sans y participer : c'est le
 * groupe qu'ils viennent chercher, pas l'activité. Jusqu'ici ils n'avaient le choix
 * qu'entre prendre une place à quelqu'un et venir sans rien dire.
 *
 * Deux garanties, et ce sont elles qui font tenir tout le reste :
 *
 * — **un spectateur ne consomme aucune place**, quoi qu'il arrive et quel qu'en soit le
 *   nombre. Le jour où ce test devient faux, une activité complète refuse quelqu'un pour
 *   une place qu'un spectateur avait prise sans en avoir besoin ;
 * — **un spectateur est quelque part**. Il ne peut donc pas être ailleurs au même moment,
 *   et surtout pas pendant un rendez-vous — décision de l'hôpital, prise après un essai
 *   en service.
 */

const now = new Date('2025-08-10T09:00:00Z')
const plusTard = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

function board(capacity: number | null, overrides = {}): Board {
  return { occurrence: makeOccurrence({ capacity, ...overrides }), registrations: [] }
}

function ajoute(
  courant: Board,
  uid: string,
  at: Date,
  as: 'participant' | 'spectator' = 'participant',
): Board {
  const outcome = register(courant, uid, { now: at, registrationId: `reg-${uid}`, by: 'patient', as })
  if (!outcome.ok) throw new Error(`refusé : ${outcome.reason}`)
  return outcome.board
}

describe('un spectateur ne prend la place de personne', () => {
  it('ne compte pas dans les inscrits', () => {
    const apres = ajoute(board(2), 'a', now, 'spectator')
    expect(apres.occurrence.confirmedCount).toBe(0)
    expect(apres.occurrence.waitlistCount).toBe(0)
    expect(spectatorsOf(apres.occurrence)).toBe(1)
  })

  it('entre sur une séance complète, là où une inscription serait refusée', () => {
    let complet = ajoute(board(1), 'a', now)
    expect(complet.occurrence.confirmedCount).toBe(1)

    // Sans liste d'attente, une inscription ordinaire est refusée…
    const sansFile = { ...complet, occurrence: { ...complet.occurrence, waitlistEnabled: false } }
    const refus = register(sansFile, 'b', { now: plusTard(1), registrationId: 'reg-b', by: 'patient' })
    expect(refus.ok).toBe(false)
    expect(!refus.ok && refus.reason).toBe('full-no-waitlist')

    // … et pourtant venir regarder reste possible. C'est toute la raison d'être du geste.
    complet = ajoute(sansFile, 'b', plusTard(1), 'spectator')
    expect(complet.occurrence.confirmedCount).toBe(1)
    expect(spectatorsOf(complet.occurrence)).toBe(1)
  })

  it('n’est jamais mis en liste d’attente, même sur une séance pleine', () => {
    let plein = ajoute(board(1), 'a', now)
    plein = ajoute(plein, 'b', plusTard(1), 'spectator')
    expect(plein.occurrence.waitlistCount).toBe(0)
    expect(waitlistPosition(plein, 'b')).toBeNull()
  })

  it('n’est pas limité en nombre', () => {
    let salle = board(1)
    for (let i = 0; i < 30; i += 1) salle = ajoute(salle, `spectateur-${i}`, plusTard(i), 'spectator')
    expect(spectatorsOf(salle.occurrence)).toBe(30)
    expect(salle.occurrence.confirmedCount).toBe(0)
    // La place, elle, est toujours libre pour qui veut vraiment participer.
    salle = ajoute(salle, 'participante', plusTard(40))
    expect(salle.occurrence.confirmedCount).toBe(1)
  })

  it('ne libère aucune place en partant : il n’en tenait aucune', () => {
    let plein = ajoute(board(1), 'a', now)
    plein = ajoute(plein, 'attente', plusTard(1)) // liste d'attente
    plein = ajoute(plein, 'regard', plusTard(2), 'spectator')
    expect(plein.occurrence.waitlistCount).toBe(1)

    const sortie = unregister(plein, 'regard')
    expect(sortie.ok).toBe(true)
    // Personne n'est promu : le spectateur n'occupait rien.
    expect(sortie.ok && sortie.promoted).toBeNull()
    expect(sortie.ok && sortie.board.occurrence.waitlistCount).toBe(1)
  })
})

describe('ce qui ferme la porte, la ferme aussi au spectateur', () => {
  it('une séance annulée', () => {
    const annulee = makeOccurrence({ status: 'cancelled' })
    expect(registrationBlock(annulee, now, 'spectator')).toBe('cancelled')
  })

  it('une séance déjà commencée', () => {
    const passee = makeOccurrence({})
    expect(registrationBlock(passee, new Date(passee.start.getTime() + 60_000), 'spectator')).toBe('past')
  })

  it('mais jamais le nombre de places', () => {
    const complete = makeOccurrence({ capacity: 2, confirmedCount: 2, waitlistEnabled: false })
    expect(registrationBlock(complete, now)).toBe('full-no-waitlist')
    expect(registrationBlock(complete, now, 'spectator')).toBeNull()
  })
})

describe('changer d’avis', () => {
  it('ne crée pas une seconde inscription : il change celle qui existe', () => {
    const inscrit = ajoute(board(4), 'a', now)
    const outcome = register(inscrit, 'a', {
      now: plusTard(5),
      registrationId: 'ne-doit-pas-servir',
      by: 'patient',
      as: 'spectator',
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changed).toBe(true)
    expect(outcome.registration.id).toBe('reg-a')
    // Une seule ligne active au nom de cette personne : deux fausseraient tous les comptes.
    const actives = outcome.board.registrations.filter((r) => r.status !== 'cancelled')
    expect(actives).toHaveLength(1)
    expect(outcome.board.occurrence.confirmedCount).toBe(0)
    expect(spectatorsOf(outcome.board.occurrence)).toBe(1)
  })

  it('rend sa place au premier de la liste d’attente, dans le même geste', () => {
    let plein = ajoute(board(1), 'a', now)
    plein = ajoute(plein, 'b', plusTard(1))
    expect(waitlistPosition(plein, 'b')).toBe(1)

    const outcome = register(plein, 'a', {
      now: plusTard(2),
      registrationId: 'x',
      by: 'patient',
      as: 'spectator',
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // La place libérée ne reste pas vide : sans cela, la file cesse d'être une file.
    expect(outcome.promoted?.patientUid).toBe('b')
    expect(outcome.board.occurrence.confirmedCount).toBe(1)
    expect(outcome.board.occurrence.waitlistCount).toBe(0)
  })

  it('laisse un spectateur redevenir participant quand il reste de la place', () => {
    const regarde = ajoute(board(2), 'a', now, 'spectator')
    const outcome = register(regarde, 'a', { now: plusTard(1), registrationId: 'y', by: 'patient' })
    expect(outcome.ok && outcome.status).toBe('confirmed')
    expect(outcome.ok && spectatorsOf(outcome.board.occurrence)).toBe(0)
    expect(outcome.ok && outcome.board.occurrence.confirmedCount).toBe(1)
  })

  it('le met en file d’attente si la séance est pleine, et à la fin de la file', () => {
    let plein = ajoute(board(1), 'a', now)
    plein = ajoute(plein, 'attend', plusTard(1)) // entre en file avant lui
    plein = ajoute(plein, 'regard', plusTard(2), 'spectator')

    const outcome = register(plein, 'regard', { now: plusTard(3), registrationId: 'z', by: 'patient' })
    expect(outcome.ok && outcome.status).toBe('waitlist')
    // On se met à la fin de la file, pas devant ceux qui attendaient déjà.
    expect(outcome.ok && outcome.position).toBe(2)
  })

  it('ne le déloge pas quand la séance est complète et la file fermée', () => {
    let complet = ajoute(board(1), 'a', now)
    complet = { ...complet, occurrence: { ...complet.occurrence, waitlistEnabled: false } }
    complet = ajoute(complet, 'regard', plusTard(1), 'spectator')

    const outcome = register(complet, 'regard', { now: plusTard(2), registrationId: 'w', by: 'patient' })
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toBe('full-no-waitlist')
    // Refusé, il reste ce qu'il était : on ne perd pas sa place en essayant d'en changer.
    expect(spectatorsOf(complet.occurrence)).toBe(1)
  })

  it('refuse deux fois le même geste', () => {
    const regarde = ajoute(board(4), 'a', now, 'spectator')
    const outcome = register(regarde, 'a', {
      now: plusTard(1),
      registrationId: 'v',
      by: 'patient',
      as: 'spectator',
    })
    expect(!outcome.ok && outcome.reason).toBe('already-registered')
  })
})

describe('la liste que lit l’animateur', () => {
  it('range les spectateurs à part, jamais parmi les inscrits', () => {
    let salle = ajoute(board(4), 'a', now)
    salle = ajoute(salle, 'b', plusTard(1), 'spectator')
    salle = ajoute(salle, 'c', plusTard(2), 'spectator')

    const { confirmed, waitlist, spectators } = rosterOf(salle)
    expect(confirmed.map((r) => r.patientUid)).toEqual(['a'])
    expect(waitlist).toHaveLength(0)
    expect(spectators.map((r) => r.patientUid)).toEqual(['b', 'c'])
  })

  it('dit les deux chiffres au personnel, sans les additionner', () => {
    const occurrence = makeOccurrence({ capacity: 8, confirmedCount: 8, spectatorCount: 3 })
    const texte = staffCapacityLabel(occurrence)
    expect(texte).toContain('8 / 8')
    expect(texte).toContain('3 spectateurs')
    // Surtout pas « 11 / 8 » : la séance n'a jamais dépassé.
    expect(texte).not.toContain('11')
  })

  it('reste muet quand il n’y a aucun spectateur', () => {
    const occurrence = makeOccurrence({ capacity: 8, confirmedCount: 2 })
    expect(staffCapacityLabel(occurrence)).not.toContain('spectateur')
  })

  it('accorde le singulier', () => {
    const occurrence = makeOccurrence({ capacity: 8, confirmedCount: 2, spectatorCount: 1 })
    expect(staffCapacityLabel(occurrence)).toContain(', 1 spectateur')
  })
})

describe('on ne regarde pas deux choses à la fois', () => {
  const activite = (label: string, spectator = false): BusyEntry => ({
    start: new Date('2025-08-12T14:00:00Z'),
    end: new Date('2025-08-12T15:00:00Z'),
    label,
    kind: 'activity',
    occurrenceId: 'autre_20250812T1600',
    ...(spectator ? { spectator: true } : {}),
  })
  const rendezVous: BusyEntry = {
    start: new Date('2025-08-12T14:00:00Z'),
    end: new Date('2025-08-12T14:30:00Z'),
    label: 'Rendez-vous avec le psychiatre',
    kind: 'appointment',
  }

  it('un rendez-vous ferme la porte, même à qui veut seulement regarder', () => {
    const decision = patientRegistrationDecision([rendezVous], 'spectator')
    expect(decision.kind).toBe('rendez-vous')
    // Rien à proposer : un patient ne décommande pas un rendez-vous tout seul.
    expect(decision.kind === 'rendez-vous' && decision.message).toContain('rendez-vous')
  })

  it('une activité déjà prise se propose à l’échange, dans les mots du geste demandé', () => {
    const decision = patientRegistrationDecision([activite('Jonglerie')], 'spectator')
    expect(decision.kind).toBe('activites')
    if (decision.kind !== 'activites') return
    expect(decision.actionLabel).toBe('Me désinscrire de « Jonglerie » pour venir ici')
    // « pour m'inscrire ici » serait faux : on ne s'inscrit pas, on vient regarder.
    expect(decision.actionLabel).not.toContain('m’inscrire')
  })

  it('dit « vous venez déjà regarder » quand c’est ce que la personne avait fait', () => {
    const decision = patientRegistrationDecision([activite('Jonglerie', true)])
    expect(decision.kind === 'activites' && decision.message).toContain('Vous venez déjà regarder')
    expect(decision.kind === 'activites' && decision.message).not.toContain('déjà inscrit')
    expect(decision.kind === 'activites' && decision.actionLabel).toBe(
      'Ne plus venir regarder « Jonglerie » pour m’inscrire ici',
    )
  })

  it('garde ses mots d’origine pour une inscription ordinaire', () => {
    const decision = patientRegistrationDecision([activite('Jonglerie')])
    expect(decision.kind === 'activites' && decision.actionLabel).toBe(
      'Me désinscrire de « Jonglerie » pour m’inscrire ici',
    )
  })
})

describe('changer d’avis n’est pas s’engager de nouveau', () => {
  const rendezVous: BusyEntry = {
    start: new Date('2025-08-12T09:30:00Z'),
    end: new Date('2025-08-12T10:00:00Z'),
    label: 'Rendez-vous avec Docteur Lemaire',
    kind: 'appointment',
  }

  it('laisse passer qui est déjà sur la séance, même sous un rendez-vous', () => {
    /*
      Le cas se produit pour de bon : un soignant inscrit quelqu'un à une activité qui
      tombe sur son rendez-vous — il en a le droit, il sait que le rendez-vous sera
      déplacé. La personne ouvre ensuite la fiche et veut seulement regarder. Sans cette
      réserve, elle lisait « Vous avez un rendez-vous à ce moment-là » et restait inscrite
      pour de bon : on lui interdisait de *réduire* son engagement au motif qu'il existe.
    */
    expect(patientRegistrationDecision([rendezVous], 'spectator').kind).toBe('rendez-vous')
    expect(
      patientRegistrationDecision([rendezVous], 'spectator', { alreadyRegistered: true }).kind,
    ).toBe('libre')
  })

  it('vaut aussi dans l’autre sens, du regard vers la participation', () => {
    expect(
      patientRegistrationDecision([rendezVous], 'participant', { alreadyRegistered: true }).kind,
    ).toBe('libre')
  })

  it('ne désarme rien pour quelqu’un qui n’y est pas encore', () => {
    // La garantie ne doit pas fuir : sans inscription vivante, le rendez-vous ferme.
    expect(
      patientRegistrationDecision([rendezVous], 'participant', { alreadyRegistered: false }).kind,
    ).toBe('rendez-vous')
  })
})

describe('les mots des boutons', () => {
  it('disent ce qu’on va faire, pas comment cela s’appelle', () => {
    expect(spectatorActionLabel()).toBe('Je viens seulement regarder')
    // « Spectateur » est le mot de l'équipe ; ce n'est pas celui du bouton.
    expect(spectatorActionLabel().toLowerCase()).not.toContain('spectateur')
  })

  it('ne parlent pas de désinscription à qui ne s’était pas inscrit', () => {
    const occurrence = makeOccurrence({})
    expect(unregisterActionLabel(occurrence, 'spectator')).toBe('Finalement, je ne viendrai pas')
    expect(unregisterActionLabel(occurrence, 'confirmed')).toBe('Me désinscrire')
  })

  it('n’envoient plus vers un soignant ce qu’on peut faire soi-même', () => {
    /*
      « Cette activité est complète. Adressez-vous à un soignant. » était le seul mot
      possible tant qu'il n'y avait rien d'autre à faire. Depuis qu'on peut venir
      regarder, cette phrase envoie quelqu'un déranger un soignant pour un bouton qu'il a
      sous les yeux.
    */
    expect(fullButWatchableMessage()).toContain('venir regarder')
    expect(fullButWatchableMessage()).not.toContain('soignant')
    // Et l'ancienne phrase, elle, n'a pas changé : elle sert encore ailleurs.
    expect(registrationBlockMessage('full-no-waitlist')).toContain('soignant')
  })

  it('préviennent quand vouloir participer mène à la liste d’attente', () => {
    const complete = makeOccurrence({ capacity: 2, confirmedCount: 2 })
    expect(becomeParticipantLabel(complete)).toContain("liste d'attente")
    const libre = makeOccurrence({ capacity: 8, confirmedCount: 1 })
    expect(becomeParticipantLabel(libre)).toBe('Je veux participer, finalement')
  })
})
