import { describe, expect, it } from 'vitest'
import {
  deletionWarning,
  planActivityRemoval,
  planForcedRemoval,
  planRemoval,
  proposed,
  totalUsage,
} from './catalog'

const RIEN = { activities: 0, occurrences: 0, patients: 0, appointments: 0 }

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
    const plan = planRemoval('service', 'La Couturelle', { activities: 2, occurrences: 12, patients: 1, appointments: 0 })
    expect(plan.message).toContain('2 activités, 12 séances et 1 personne')
  })

  it('compte tous les usages', () => {
    expect(totalUsage({ activities: 1, occurrences: 2, patients: 3, appointments: 4 })).toBe(10)
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

describe('suppression d’une activité', () => {
  it('supprime une activité à laquelle personne ne s’est inscrit', () => {
    const plan = planActivityRemoval('Activité de test', { registrations: 0, sessions: 12 })
    expect(plan.action).toBe('deleted')
    expect(plan.message).toContain('12 séances')
    expect(plan.message).toContain("Personne n'y était inscrit")
  })

  it('ne mentionne pas les séances quand il n’y en a aucune', () => {
    const plan = planActivityRemoval('Brouillon', { registrations: 0, sessions: 0 })
    expect(plan.action).toBe('deleted')
    expect(plan.message).not.toContain('séance')
  })

  it('protège une activité dès la première inscription', () => {
    const plan = planActivityRemoval('Yoga', { registrations: 1, sessions: 8 })
    expect(plan.action).toBe('deactivated')
    expect(plan.message).toContain('1 personne s’y est inscrite')
  })

  it('accorde le pluriel des inscriptions', () => {
    const plan = planActivityRemoval('Yoga', { registrations: 4, sessions: 8 })
    expect(plan.message).toContain('4 personnes s’y sont inscrites')
  })
})

describe('retrait d’un intervenant', () => {
  it('accorde l’article : « L’intervenant », pas « Le intervenant »', () => {
    const plan = planRemoval('practitioner', 'Docteur Lemaire', RIEN)
    expect(plan.message).toContain("L'intervenant « Docteur Lemaire »")
  })

  it('compte les rendez-vous fixés avec lui', () => {
    const plan = planRemoval('practitioner', 'Claire', { ...RIEN, appointments: 3 })
    expect(plan.action).toBe('deactivated')
    expect(plan.message).toContain('3 rendez-vous')
  })

  it('ne met pas « rendez-vous » au pluriel : le mot est invariable', () => {
    const plan = planRemoval('practitioner', 'Claire', { ...RIEN, appointments: 1 })
    expect(plan.message).toContain('1 rendez-vous')
  })
})

describe('la suppression définitive d’une activité', () => {
  it('ne prévient de rien quand personne n’était inscrit', () => {
    expect(deletionWarning('Yoga', { registrations: 0, sessions: 4 })).toBeNull()
  })

  it('nomme ce qui va disparaître, et qu’il n’y a pas de retour', () => {
    const message = deletionWarning('Yoga', { registrations: 6, sessions: 4 })
    expect(message).toContain('6 inscriptions')
    expect(message).toContain('4 séances')
    expect(message).toContain('sans retour en arrière')
  })

  it('rappelle qu’annuler avec un motif prévient, alors que supprimer efface', () => {
    const message = deletionWarning('Yoga', { registrations: 1, sessions: 1 })
    expect(message).toContain('1 inscription')
    expect(message).toContain('motif')
  })

  it('rend compte de ce qui a été effacé, une fois la suppression faite', () => {
    const plan = planForcedRemoval('Yoga', { registrations: 6, sessions: 4 })
    expect(plan.action).toBe('deleted')
    expect(plan.message).toContain('6 inscriptions ont été effacées')
  })

  it('dit aussi quand il n’y avait personne', () => {
    expect(planForcedRemoval('Yoga', { registrations: 0, sessions: 2 }).message).toContain(
      'Personne n’y était inscrit',
    )
  })
})
