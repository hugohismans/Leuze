import { describe, expect, it } from 'vitest'
import {
  deletionConsequences,
  deletionCosts,
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
    expect(plan.message).toContain('1 inscription la concerne')
  })

  it('accorde le pluriel des inscriptions', () => {
    const plan = planActivityRemoval('Yoga', { registrations: 4, sessions: 8 })
    // « inscriptions » et non « personnes » : une inscription vaut pour une séance.
    expect(plan.message).toContain('4 inscriptions la concernent')
    expect(plan.message).not.toContain('personnes')
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

describe('les conséquences d’une suppression définitive', () => {
  const rien = { registrations: 0, sessions: 0, pastSessions: 0, attendances: 0 }

  it('ne dit rien quand il n’y a rien à perdre', () => {
    expect(deletionConsequences(rien)).toEqual([])
    expect(deletionCosts(rien)).toBe(false)
  })

  it('nomme les séances, et lesquelles sont déjà passées', () => {
    const lignes = deletionConsequences({ ...rien, sessions: 16, pastSessions: 12 })
    expect(lignes[0]).toBe('16 séances, dont 12 déjà passées.')
  })

  it('ne parle pas de passé quand il n’y en a pas', () => {
    expect(deletionConsequences({ ...rien, sessions: 4 })[0]).toBe('4 séances.')
  })

  it('dit ce qu’il advient des personnes inscrites', () => {
    const lignes = deletionConsequences({ ...rien, registrations: 40 })
    expect(lignes[0]).toContain('40 inscriptions')
    expect(lignes[0]).toContain('sans motif')
  })

  it('nomme la perte de l’historique de présence — c’est la moins visible', () => {
    const lignes = deletionConsequences({ ...rien, attendances: 34 })
    expect(lignes[0]).toContain('34 présences notées')
    expect(lignes[0]).toContain('qui est venu')
  })

  it('accorde le singulier', () => {
    const lignes = deletionConsequences({
      registrations: 1,
      sessions: 1,
      pastSessions: 1,
      attendances: 1,
    })
    expect(lignes[0]).toBe('1 séance, dont 1 déjà passée.')
    expect(lignes[1]).toContain('1 inscription.')
    expect(lignes[2]).toContain('1 présence notée')
  })

  it('les rend dans l’ordre du plus visible au moins visible', () => {
    const lignes = deletionConsequences({
      registrations: 5,
      sessions: 3,
      pastSessions: 1,
      attendances: 2,
    })
    expect(lignes).toHaveLength(3)
    expect(lignes[0]).toContain('séance')
    expect(lignes[1]).toContain('inscription')
    expect(lignes[2]).toContain('présence')
  })
})

describe('le compte rendu d’une suppression', () => {
  it('rend compte de ce qui a été effacé', () => {
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
