import { describe, expect, it } from 'vitest'
import { animePar, facilitatorFields, facilitatorIdsOf, facilitatorLabel } from './animation'

/**
 * Plusieurs personnes peuvent animer la même activité.
 *
 * Retour du terrain : un atelier cuisine se tient à deux. La seconde ne pouvait ni faire
 * l'appel, ni voir la séance dans son planning — elle n'existait pas pour l'application
 * alors qu'elle était dans la salle.
 *
 * Le risque de ce changement n'est pas d'oublier quelqu'un : c'est de **perdre** ceux qui
 * étaient déjà enregistrés sous l'ancienne forme. Ces tests gardent d'abord cela.
 */
describe('lire qui anime', () => {
  it('lit la liste quand elle est là', () => {
    expect(facilitatorIdsOf({ facilitatorIds: ['claire', 'marc'] })).toEqual(['claire', 'marc'])
  })

  it('lit l’unique d’avant quand la liste n’existe pas encore', () => {
    // Toutes les activités déjà enregistrées sont dans ce cas : les perdre de vue
    // reviendrait à retirer l'appel et le planning à ceux qui les animent aujourd'hui.
    expect(facilitatorIdsOf({ facilitatorId: 'claire' })).toEqual(['claire'])
  })

  it('ne trouve personne quand il n’y a rien', () => {
    expect(facilitatorIdsOf({})).toEqual([])
    expect(facilitatorIdsOf({ facilitatorId: '' })).toEqual([])
    expect(facilitatorIdsOf({ facilitatorIds: [] })).toEqual([])
  })

  it('laisse la liste l’emporter, même vide', () => {
    /*
      Une liste vide veut dire « personne n'anime », et c'est une décision. Retomber sur
      l'ancien champ ferait revenir quelqu'un qu'on vient justement de retirer.
    */
    expect(facilitatorIdsOf({ facilitatorIds: [], facilitatorId: 'claire' })).toEqual([])
  })

  it('ne compte pas deux fois la même personne', () => {
    expect(facilitatorIdsOf({ facilitatorIds: ['claire', 'claire'] })).toEqual(['claire'])
  })
})

describe('cette personne anime-t-elle ?', () => {
  it('dit oui à chacun de ceux qui animent, pas seulement au premier', () => {
    // Le défaut d'origine : la question se posait par une égalité, et le second animateur
    // se voyait refuser sa propre séance.
    const atelier = { facilitatorIds: ['claire', 'marc'] }
    expect(animePar(atelier, 'claire')).toBe(true)
    expect(animePar(atelier, 'marc')).toBe(true)
    expect(animePar(atelier, 'sophie')).toBe(false)
  })

  it('vaut aussi pour l’ancien format', () => {
    expect(animePar({ facilitatorId: 'claire' }, 'claire')).toBe(true)
  })

  it('ne dit jamais oui à un compte sans intervenant attaché', () => {
    /*
      Un compte non relié porte une chaîne vide. Sans cette garde, il aurait été « celui
      qui anime » de toute activité sans animateur — et aurait ouvert l'appel de tout
      l'hôpital.
    */
    expect(animePar({ facilitatorIds: [] }, '')).toBe(false)
    expect(animePar({}, '')).toBe(false)
    expect(animePar({}, null)).toBe(false)
    expect(animePar({}, undefined)).toBe(false)
  })
})

describe('ce que le patient lit', () => {
  it('nomme tout le monde, en français', () => {
    expect(facilitatorLabel(['Claire'])).toBe('Claire')
    expect(facilitatorLabel(['Claire', 'Marc'])).toBe('Claire et Marc')
    expect(facilitatorLabel(['Claire', 'Marc', 'Sophie'])).toBe('Claire, Marc et Sophie')
  })

  it('ne laisse pas traîner de virgule quand un nom manque', () => {
    expect(facilitatorLabel(['Claire', '', 'Marc'])).toBe('Claire et Marc')
    expect(facilitatorLabel([])).toBe('')
  })
})

describe('ce qu’on écrit sur l’activité', () => {
  it('garde l’ancien champ renseigné avec le premier', () => {
    /*
      Ce n'est pas de la politesse envers l'ancien format : les règles de sécurité et
      toutes les séances déjà enregistrées s'appuient dessus. L'oublier retirerait à
      quelqu'un le droit de modifier sa propre activité.
    */
    expect(facilitatorFields(['claire', 'marc'])).toEqual({
      facilitatorIds: ['claire', 'marc'],
      facilitatorId: 'claire',
    })
  })

  it('n’écrit pas d’ancien champ quand personne n’anime', () => {
    expect(facilitatorFields([])).toEqual({ facilitatorIds: [] })
  })

  it('nettoie les vides et les doublons avant d’écrire', () => {
    expect(facilitatorFields(['claire', '', 'claire', 'marc'])).toEqual({
      facilitatorIds: ['claire', 'marc'],
      facilitatorId: 'claire',
    })
  })
})

/**
 * Ce que le second animateur obtient, et qu'il n'avait pas.
 *
 * Ce sont les trois droits qui pendaient à l'égalité `facilitatorId === moi` : faire
 * l'appel, modifier l'activité, et la voir dans son planning. Les trois se posaient de la
 * même façon, et se trompaient donc ensemble.
 */
describe('ce que le second animateur récupère', () => {
  const atelier = { facilitatorIds: ['claire', 'marc'], facilitatorId: 'claire' }

  it('l’appel', async () => {
    const { canMarkAttendance } = await import('./attendance')
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'marc' }, atelier)).toBe(true)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'claire' }, atelier)).toBe(true)
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'sophie' }, atelier)).toBe(false)
  })

  it('le droit de modifier', async () => {
    const { canEditActivity } = await import('./activityAccess')
    expect(canEditActivity({ role: 'staff', practitionerId: 'marc' }, atelier)).toBe(true)
    expect(canEditActivity({ role: 'staff', practitionerId: 'sophie' }, atelier)).toBe(false)
  })

  it('et rien de tout cela sur une activité qui ne le nomme pas', async () => {
    const { canMarkAttendance } = await import('./attendance')
    const { canEditActivity } = await import('./activityAccess')
    const ailleurs = { facilitatorIds: ['claire'], facilitatorId: 'claire' }
    expect(canMarkAttendance({ role: 'staff', practitionerId: 'marc' }, ailleurs)).toBe(false)
    expect(canEditActivity({ role: 'staff', practitionerId: 'marc' }, ailleurs)).toBe(false)
  })
})
