import { describe, expect, it } from 'vitest'
import {
  activityEditRefusal,
  canChooseFacilitator,
  canEditActivity,
  facilitatorFor,
} from './activityAccess'

const marc = { role: 'staff' as const, practitionerId: 'marc' }
const sansLien = { role: 'staff' as const, practitionerId: null }
const patronne = { role: 'admin' as const, practitionerId: 'claire' }

const sienne = { facilitatorId: 'marc', facilitator: 'Marc' }
const autre = { facilitatorId: 'claire', facilitator: 'Claire' }
const sansPersonne = {}

describe('qui choisit l’animateur', () => {
  it('l’administrateur, et lui seul', () => {
    expect(canChooseFacilitator(patronne)).toBe(true)
    expect(canChooseFacilitator(marc)).toBe(false)
    expect(canChooseFacilitator({ role: null })).toBe(false)
  })

  it('un soignant anime ce qu’il crée, quoi qu’on envoie', () => {
    expect(facilitatorFor(marc, 'claire')).toBe('marc')
    expect(facilitatorFor(marc, null)).toBe('marc')
  })

  it('l’administrateur garde son choix, y compris « personne »', () => {
    expect(facilitatorFor(patronne, 'claire')).toBe('claire')
    expect(facilitatorFor(patronne, null)).toBeNull()
  })

  it('un compte relié à personne n’anime rien', () => {
    expect(facilitatorFor(sansLien, 'marc')).toBeNull()
  })
})

describe('qui modifie quelle activité', () => {
  it('l’administrateur, toutes', () => {
    expect(canEditActivity(patronne, autre)).toBe(true)
    expect(canEditActivity(patronne, sansPersonne)).toBe(true)
  })

  it('un soignant, les siennes', () => {
    expect(canEditActivity(marc, sienne)).toBe(true)
  })

  it('jamais celle d’un collègue', () => {
    expect(canEditActivity(marc, autre)).toBe(false)
    expect(activityEditRefusal(marc, autre)).toContain('animée par Claire')
  })

  it('ni une activité que personne n’anime', () => {
    expect(canEditActivity(marc, sansPersonne)).toBe(false)
    expect(activityEditRefusal(marc, sansPersonne)).toMatch(/personne en particulier/)
  })

  it('mais toujours celle qu’il est en train de créer', () => {
    expect(canEditActivity(marc, null)).toBe(true)
    expect(activityEditRefusal(marc, null)).toBeNull()
  })

  it('rien du tout sans lien vers une personne du personnel', () => {
    expect(canEditActivity(sansLien, null)).toBe(false)
    expect(activityEditRefusal(sansLien, null)).toMatch(/relié à aucune personne/)
  })
})

/**
 * Une séance appartient à qui anime son activité.
 *
 * Constaté en service : une assistante sociale, qui n'est ni administratrice ni
 * animatrice de l'activité, a pu annuler une séance de gymnastique douce. Le document de
 * l'activité était protégé ; ses séances ne l'étaient pas.
 *
 * `canEditActivity` répond déjà à la question — une séance porte le même `facilitatorId`
 * que son activité. Ce qui manquait, ce n'était pas la règle : c'était de s'en servir,
 * dans les écrans comme dans les règles Firestore.
 */
describe('annuler une séance', () => {
  const seanceDeMarc = { facilitatorId: 'marc' }
  const seanceSansAnimateur = {}

  it("est permis à l'animateur", () => {
    expect(canEditActivity({ role: 'staff', practitionerId: 'marc' }, seanceDeMarc)).toBe(true)
  })

  it('est refusé à un collègue', () => {
    expect(canEditActivity({ role: 'staff', practitionerId: 'lola' }, seanceDeMarc)).toBe(false)
  })

  it("est refusé à un compte du personnel relié à personne", () => {
    expect(canEditActivity({ role: 'staff', practitionerId: null }, seanceDeMarc)).toBe(false)
  })

  it("est permis à l'administrateur, qui répartit", () => {
    expect(canEditActivity({ role: 'admin', practitionerId: null }, seanceDeMarc)).toBe(true)
  })

  it("d'une activité que personne n'anime, relève de l'administrateur seul", () => {
    expect(canEditActivity({ role: 'staff', practitionerId: 'marc' }, seanceSansAnimateur)).toBe(false)
    expect(canEditActivity({ role: 'admin', practitionerId: null }, seanceSansAnimateur)).toBe(true)
  })
})
