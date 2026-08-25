import { describe, expect, it } from 'vitest'
import {
  MEETING_HINT,
  meetingAction,
  meetingBadge,
  meetingStateOf,
  nextMeetingState,
  type MeetingState,
} from './reunion'

/**
 * Le cycle de la réunion du lundi.
 *
 * Dix prénoms à la minute, sur une tablette posée sur une table. Ce qui compte ici n'est
 * pas la beauté du code mais deux garanties très concrètes : qu'on revienne toujours au
 * point de départ au bout de trois appuis, et que retirer quelqu'un ne puisse jamais
 * arriver par accident au premier ou au deuxième.
 */
describe('le cycle d’un prénom', () => {
  it('fait le tour en trois appuis, et revient au point de départ', () => {
    expect(nextMeetingState('rien')).toBe('inscrit')
    expect(nextMeetingState('inscrit')).toBe('regarde')
    expect(nextMeetingState('regarde')).toBe('rien')
  })

  it('boucle sans jamais se perdre, quel qu’en soit le nombre', () => {
    let etat: MeetingState = 'rien'
    for (let i = 0; i < 30; i += 1) etat = nextMeetingState(etat)
    // Trente appuis : dix tours complets.
    expect(etat).toBe('rien')
  })

  it('ne retire personne avant le troisième appui', () => {
    /*
      La garantie qui compte. En réunion on clique vite, et un retrait ne se voit pas :
      le prénom redevient gris parmi trente-neuf autres. Il doit donc être l'appui le plus
      loin du geste courant.
    */
    expect(meetingAction('rien').kind).toBe('inscrire')
    expect(meetingAction('inscrit').kind).toBe('faire-spectateur')
    expect(meetingAction('regarde').kind).toBe('retirer')
  })
})

describe('l’état lu sur la liste', () => {
  it('reconnaît chacun des statuts', () => {
    expect(meetingStateOf('confirmed')).toBe('inscrit')
    expect(meetingStateOf('spectator')).toBe('regarde')
    expect(meetingStateOf(undefined)).toBe('rien')
    expect(meetingStateOf(null)).toBe('rien')
  })

  it('range la liste d’attente avec les inscrits', () => {
    /*
      La personne a demandé sa place et l'aura si quelqu'un se retire : l'appui suivant
      doit lui proposer la même chose qu'à un inscrit. Un quatrième état n'apporterait
      qu'une couleur de plus à apprendre.
    */
    expect(meetingStateOf('waitlist')).toBe('inscrit')
    expect(meetingAction(meetingStateOf('waitlist')).kind).toBe('faire-spectateur')
  })

  it('ne prend pas une inscription annulée pour une inscription', () => {
    expect(meetingStateOf('cancelled')).toBe('rien')
  })
})

describe('ce que le prénom porte à l’écran', () => {
  it('double toujours la couleur d’un signe et d’un mot', () => {
    // Bleu et orange se ressemblent pour beaucoup de gens, et tout le geste consiste à
    // les distinguer d'un coup d'œil. C'est un critère de refus en revue.
    const inscrit = meetingBadge('inscrit')
    const regarde = meetingBadge('regarde')
    expect(inscrit.word).not.toBe('')
    expect(regarde.word).not.toBe('')
    expect(inscrit.word).not.toBe(regarde.word)
    expect(inscrit.icon).not.toBe(regarde.icon)
  })

  it('n’écrit rien à côté de qui n’est pas inscrit', () => {
    // Trente-neuf fois « pas inscrit » sous quarante prénoms : illisible, et pour rien.
    expect(meetingBadge('rien').word).toBe('')
    expect(meetingBadge('rien').icon).not.toBe('')
  })

  it('dit à voix haute ce que fera le prochain appui', () => {
    for (const etat of ['rien', 'inscrit', 'regarde'] as MeetingState[]) {
      expect(meetingBadge(etat).next).toMatch(/^Appuyez/)
    }
    expect(meetingBadge('regarde').next).toContain('retirer')
    expect(meetingBadge('inscrit').next).toContain('regarder')
  })
})

describe('le rappel au-dessus de la liste', () => {
  it('décrit les trois appuis, dans l’ordre', () => {
    // Un cycle de trois ne se devine pas : il faut avoir eu l'idée d'appuyer deux fois.
    expect(MEETING_HINT).toContain('inscrire')
    expect(MEETING_HINT).toContain('regarder')
    expect(MEETING_HINT).toContain('retire')
    expect(MEETING_HINT.indexOf('regarder')).toBeLessThan(MEETING_HINT.indexOf('retire'))
  })

  it('dit pourquoi le deuxième état existe', () => {
    expect(MEETING_HINT).toContain('sans prendre de place')
  })
})
