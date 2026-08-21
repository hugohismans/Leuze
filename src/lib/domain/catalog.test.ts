import { describe, expect, it } from 'vitest'
import { planRemoval, proposed, totalUsage } from './catalog'

const RIEN = { activities: 0, occurrences: 0, patients: 0 }

describe('retrait d’une entrée du catalogue', () => {
  it('supprime ce que rien n’utilise', () => {
    const plan = planRemoval('location', 'Salle bleue', RIEN)
    expect(plan.action).toBe('deleted')
    expect(plan.message).toContain('Le lieu « Salle bleue » est supprimé')
  })

  it('retire sans effacer ce qui est utilisé', () => {
    const plan = planRemoval('location', 'Salle bleue', { ...RIEN, activities: 3 })
    expect(plan.action).toBe('deactivated')
    expect(plan.message).toContain('3 activités')
    expect(plan.message).toContain("rien n'a été effacé")
  })

  it('accorde le singulier', () => {
    const plan = planRemoval('category', 'Musique', { ...RIEN, activities: 1 })
    expect(plan.message).toContain('La catégorie « Musique »')
    expect(plan.message).toContain('1 activité ')
    expect(plan.message).not.toContain('1 activités')
  })

  it('énumère les usages en français', () => {
    const plan = planRemoval('service', 'La Couturelle', { activities: 2, occurrences: 12, patients: 1 })
    expect(plan.message).toContain('2 activités, 12 séances et 1 personne')
  })

  it('compte tous les usages', () => {
    expect(totalUsage({ activities: 1, occurrences: 2, patients: 3 })).toBe(6)
    expect(totalUsage(RIEN)).toBe(0)
  })
})

describe('ce qui reste proposé', () => {
  it('écarte les entrées retirées et garde celles sans drapeau', () => {
    const entries = [
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
      { id: 'c' },
    ]
    expect(proposed(entries).map((e) => e.id)).toEqual(['a', 'c'])
  })
})
