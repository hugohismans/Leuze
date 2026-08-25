import { describe, expect, it } from 'vitest'
import {
  capacityOf,
  likelyStatus,
  patientCapacityLabel,
  registeredLabel,
  registrationActionLabel,
  registrationBlock,
  registrationBlockMessage,
  registrationInvitation,
  staffCapacityLabel,
  unregisterActionLabel,
  wasRegisteredLabel,
} from './capacity'
import { makeOccurrence } from './fixtures'
import { instantOf } from './time'

const avant = new Date('2025-08-19T09:00:00Z')

describe('capacité', () => {
  it('distingue les cinq états', () => {
    expect(capacityOf(makeOccurrence({ status: 'cancelled' })).kind).toBe('cancelled')
    expect(capacityOf(makeOccurrence({ registrationRequired: false, capacity: null })).kind).toBe('no-registration')
    // Une activité ouverte à tous mais à places limitées reste comptée comme les autres.
    expect(capacityOf(makeOccurrence({ registrationRequired: false, capacity: 12, confirmedCount: 4 })).kind).toBe(
      'available',
    )
    expect(capacityOf(makeOccurrence({ capacity: null })).kind).toBe('unlimited')
    expect(capacityOf(makeOccurrence({ capacity: 12, confirmedCount: 4 })).kind).toBe('available')
    expect(capacityOf(makeOccurrence({ capacity: 12, confirmedCount: 10 })).kind).toBe('last-places')
    expect(capacityOf(makeOccurrence({ capacity: 12, confirmedCount: 12 })).kind).toBe('full')
  })

  it('ne descend jamais en dessous de zéro place restante', () => {
    const state = capacityOf(makeOccurrence({ capacity: 4, confirmedCount: 6 }))
    expect(state.kind).toBe('full')
  })

  it('parle au patient en français simple, sans chiffre anxiogène par défaut', () => {
    expect(patientCapacityLabel(makeOccurrence({ registrationRequired: false, capacity: null }))).toBe(
      'Ouvert à tous, sans inscription',
    )
    expect(patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 2 }))).toBe(
      'Il reste des places',
    )
    expect(patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 11 }))).toBe(
      'Dernières places',
    )
    expect(patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 12 }))).toBe(
      'Complet — vous pouvez vous mettre en attente',
    )
    expect(
      patientCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 12, waitlistEnabled: false })),
    ).toBe('Complet')
  })

  it('donne les chiffres exacts au personnel', () => {
    expect(staffCapacityLabel(makeOccurrence({ capacity: 12, confirmedCount: 8, waitlistCount: 3 }))).toBe(
      '8 / 12 inscrits (4 restantes), 3 en attente',
    )
  })

  it('refuse l’inscription dans les cas prévus, et dit pourquoi', () => {
    expect(registrationBlock(makeOccurrence({ capacity: 12 }), avant)).toBeNull()
    expect(registrationBlock(makeOccurrence({ status: 'cancelled' }), avant)).toBe('cancelled')
    // « Sans inscription » n'est pas un refus : on peut s'inscrire pour l'avoir dans sa
    // semaine, et le soignant peut noter qui vient pendant la réunion du lundi.
    expect(registrationBlock(makeOccurrence({ registrationRequired: false }), avant)).toBeNull()
    expect(registrationBlock(makeOccurrence({ capacity: 2, confirmedCount: 2, waitlistEnabled: false }), avant)).toBe(
      'full-no-waitlist',
    )
  })

  it('refuse l’inscription une fois l’activité commencée', () => {
    const occurrence = makeOccurrence({ localDate: '2025-08-19', capacity: 12 })
    const pendant = new Date(instantOf('2025-08-19', '14:30').getTime())
    expect(registrationBlock(occurrence, pendant)).toBe('past')
  })
})

describe('ce que propose le bouton', () => {
  it('parle d’inscription quand elle est nécessaire', () => {
    expect(registrationActionLabel(makeOccurrence({ capacity: 12 }))).toBe("Je m'inscris")
    expect(registrationInvitation(makeOccurrence({ capacity: 12 }))).toBeNull()
  })

  it('parle de noter sa venue quand l’activité est ouverte à tous', () => {
    const ouverte = makeOccurrence({ registrationRequired: false, capacity: null })
    expect(registrationActionLabel(ouverte)).toBe('Je note que je viens')
    expect(registrationInvitation(ouverte)).toContain('sans vous inscrire')
  })

  it('bascule sur la liste d’attente quand c’est complet', () => {
    const complete = makeOccurrence({ capacity: 2, confirmedCount: 2 })
    expect(registrationActionLabel(complete)).toBe("Je m'inscris sur la liste d'attente")
  })
})

describe('ce que lit le personnel', () => {
  it('compte les personnes notées sur une activité sans inscription', () => {
    expect(
      staffCapacityLabel(makeOccurrence({ registrationRequired: false, capacity: null, confirmedCount: 0 })),
    ).toBe('Sans inscription — 0 personne notée')
    expect(
      staffCapacityLabel(makeOccurrence({ registrationRequired: false, capacity: null, confirmedCount: 3 })),
    ).toBe('Sans inscription — 3 personnes notées')
  })
})

describe('ce qui va se passer si l’on s’inscrit maintenant', () => {
  it('est une place tant qu’il en reste', () => {
    expect(likelyStatus(makeOccurrence({ capacity: 12, confirmedCount: 11 }))).toBe('confirmed')
  })

  it('est la liste d’attente quand c’est complet', () => {
    expect(likelyStatus(makeOccurrence({ capacity: 12, confirmedCount: 12 }))).toBe('waitlist')
  })

  it('est une place quand il n’y a pas de limite', () => {
    expect(likelyStatus(makeOccurrence({ capacity: null }))).toBe('confirmed')
  })

  it('dit la même chose que le bouton — c’est tout l’objet', () => {
    /*
      Le texte du bouton et ce que l'écran affiche pendant que la réponse voyage viennent
      de la même prévision. S'ils dérivaient, on promettrait une place puis on la
      reprendrait.
    */
    const complete = makeOccurrence({ capacity: 4, confirmedCount: 4 })
    expect(registrationActionLabel(complete)).toContain("liste d'attente")
    expect(likelyStatus(complete)).toBe('waitlist')
  })
})

describe('les mots de l’inscription se répondent', () => {
  it('emploie « inscrit » quand le bouton dit « Je m’inscris »', () => {
    const seance = makeOccurrence({ registrationRequired: true, capacity: 8, confirmedCount: 1 })
    expect(registrationActionLabel(seance)).toContain('m’inscris'.replace('’', "'"))
    expect(registeredLabel(seance)).toBe('Vous êtes inscrit')
    expect(unregisterActionLabel(seance)).toBe('Me désinscrire')
  })

  it('évite le mot quand le bouton dit « Je note que je viens »', () => {
    // « Ouvert à tous, sans inscription » et « Vous êtes inscrit » se contredisaient
    // mot pour mot sur la même carte.
    const libre = makeOccurrence({ registrationRequired: false, capacity: null })
    expect(registrationActionLabel(libre)).toBe('Je note que je viens')
    expect(registeredLabel(libre)).not.toContain('inscrit')
    expect(unregisterActionLabel(libre)).not.toContain('inscri')
  })
})

/**
 * Ce qu'on lit sur une séance annulée.
 *
 * Le bandeau écrivait « Vous étiez inscrit » à tout le monde — y compris à qui s'était
 * seulement noté sur une activité sans inscription, et à qui attendait une place. C'est
 * exactement la contradiction que `registeredLabel` venait de corriger trois lignes plus
 * bas, sur le même écran.
 */
describe('ce qu’on avait fait, sur une séance qui n’aura pas lieu', () => {
  const avecInscription = makeOccurrence({ registrationRequired: true })
  const sansInscription = makeOccurrence({ registrationRequired: false })

  it('dit « inscrit » là où l’on s’inscrivait', () => {
    expect(wasRegisteredLabel(avecInscription, 'confirmed')).toBe('Vous étiez inscrit')
  })

  it('dit « noté » là où l’on notait qu’on venait', () => {
    expect(wasRegisteredLabel(sansInscription, 'confirmed')).toBe('Vous aviez noté que vous veniez')
    // Les mêmes mots que la carte, au passé.
    expect(registeredLabel(sansInscription)).toBe('Vous avez noté que vous venez')
  })

  it('n’annonce pas une inscription à qui attendait une place', () => {
    expect(wasRegisteredLabel(avecInscription, 'waitlist')).toContain("liste d'attente")
    expect(wasRegisteredLabel(sansInscription, 'waitlist')).toContain("liste d'attente")
  })
})

/**
 * Le refus d'inscription, selon qui le lit.
 *
 * Le serveur renvoyait au soignant les phrases écrites pour le patient : « Adressez-vous
 * à un soignant » lu par le soignant lui-même, et « Un soignant peut vous proposer autre
 * chose » sur un écran où l'on rétablit la séance d'un bouton.
 */
describe('pourquoi l’inscription est refusée', () => {
  it('dit au patient à qui s’adresser', () => {
    expect(registrationBlockMessage('full-no-waitlist')).toContain('Adressez-vous à un soignant')
    expect(registrationBlockMessage('cancelled')).toContain('Un soignant peut vous proposer')
  })

  it('dit au soignant ce qu’il peut faire, lui', () => {
    const complet = registrationBlockMessage('full-no-waitlist', 'staff')
    expect(complet).not.toContain('Adressez-vous à un soignant')
    expect(complet).toContain('fiche de l’activité')

    const annulee = registrationBlockMessage('cancelled', 'staff')
    expect(annulee).not.toContain('vous proposer autre chose')
    expect(annulee).toContain('Rétablissez-la')
  })

  it('parle de « séance » au soignant, d’« activité » au patient', () => {
    // Le mot du programme pour l'un, le mot de la fiche pour l'autre : c'est le
    // vocabulaire que chacun a sous les yeux.
    expect(registrationBlockMessage('past', 'staff')).toContain('Cette séance')
    expect(registrationBlockMessage('past')).toContain('Cette activité')
    // Quand il n'y a rien à faire, on ne propose rien à personne.
    expect(registrationBlockMessage('past', 'staff')).toContain("n'est plus possible")
  })
})
