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
