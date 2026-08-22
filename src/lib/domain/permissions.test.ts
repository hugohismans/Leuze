import { describe, expect, it } from 'vitest'
import {
  OPEN_TO_PATIENTS,
  PATIENT_ACTIONS,
  actionConsequence,
  actionLabel,
  allOpen,
  isAllowed,
  permissionsSummary,
  readPermissions,
  refusalFor,
  type PatientAction,
} from './permissions'

describe('lire la configuration', () => {
  /*
    L'asymétrie est le cœur du module : se tromper en fermant prive quelqu'un d'un geste
    sans que personne ne l'ait voulu ; se tromper en ouvrant ne fait que rendre
    l'application telle qu'elle était.
  */
  it('laisse tout ouvert quand il n’y a rien à lire', () => {
    expect(readPermissions(undefined)).toEqual(OPEN_TO_PATIENTS)
    expect(readPermissions(null)).toEqual(OPEN_TO_PATIENTS)
    expect(readPermissions({})).toEqual(OPEN_TO_PATIENTS)
  })

  it('laisse tout ouvert quand ce qu’on lit n’a pas la bonne forme', () => {
    expect(readPermissions('oui')).toEqual(OPEN_TO_PATIENTS)
    expect(readPermissions(42)).toEqual(OPEN_TO_PATIENTS)
    expect(readPermissions({ register: 'non' })).toEqual(OPEN_TO_PATIENTS)
    expect(readPermissions({ register: 0 })).toEqual(OPEN_TO_PATIENTS)
  })

  it('ne ferme que sur un « false » explicite', () => {
    const lues = readPermissions({ register: false, proposeActivity: true })
    expect(lues.register).toBe(false)
    expect(lues.proposeActivity).toBe(true)
    expect(lues.unregister).toBe(true)
    expect(lues.requestAppointment).toBe(true)
  })

  it('ignore ce qu’elle ne connaît pas', () => {
    const lues = readPermissions({ register: false, danser: false })
    expect(Object.keys(lues).sort()).toEqual([...PATIENT_ACTIONS].sort())
  })
})

describe('savoir si un geste est ouvert', () => {
  it('l’est par défaut', () => {
    for (const action of PATIENT_ACTIONS) expect(isAllowed(OPEN_TO_PATIENTS, action)).toBe(true)
  })

  it('ne l’est plus une fois fermé', () => {
    const permissions = readPermissions({ requestAppointment: false })
    expect(isAllowed(permissions, 'requestAppointment')).toBe(false)
    expect(isAllowed(permissions, 'register')).toBe(true)
  })
})

describe('ce que le patient lit quand un geste est fermé', () => {
  it('dit toujours ce qui se passe à la place', () => {
    for (const action of PATIENT_ACTIONS) {
      const phrase = refusalFor(action)
      expect(phrase.length).toBeGreaterThan(20)
      expect(phrase).toContain('soignant')
    }
  })

  it('ne parle jamais de droit ni d’interdiction', () => {
    for (const action of PATIENT_ACTIONS) {
      const phrase = refusalFor(action).toLocaleLowerCase('fr')
      expect(phrase).not.toContain('interdit')
      expect(phrase).not.toContain('pas le droit')
      expect(phrase).not.toContain('autorisé')
      expect(phrase).not.toContain('refusé')
    }
  })
})

describe('ce que l’administrateur lit avant de fermer', () => {
  it('nomme chaque geste, et ce que le fermer change', () => {
    for (const action of PATIENT_ACTIONS) {
      expect(actionLabel(action).length).toBeGreaterThan(5)
      expect(actionConsequence(action)).toContain('Fermé')
    }
  })

  it('prévient du piège de la désinscription', () => {
    // Une inscription qu'on ne peut pas défaire décourage de s'inscrire : cela doit se
    // lire avant de cocher, pas se découvrir après.
    expect(actionConsequence('unregister')).toContain('décourage')
  })
})

describe('le résumé de l’écran', () => {
  const ferme = (...actions: PatientAction[]) =>
    readPermissions(Object.fromEntries(actions.map((a) => [a, false])))

  it('ne dit rien de particulier quand tout est ouvert', () => {
    expect(allOpen(OPEN_TO_PATIENTS)).toBe(true)
    expect(permissionsSummary(OPEN_TO_PATIENTS)).toContain('tout faire')
  })

  it('nomme le geste fermé quand il n’y en a qu’un', () => {
    expect(permissionsSummary(ferme('register'))).toContain('Un geste est fermé')
    expect(permissionsSummary(ferme('register'))).toContain('s’inscrire à une activité')
  })

  it('les compte quand il y en a plusieurs', () => {
    const resume = permissionsSummary(ferme('register', 'unregister'))
    expect(resume).toContain('2 gestes sont fermés')
  })

  it('dit la lecture seule quand tout est fermé', () => {
    const resume = permissionsSummary(ferme(...PATIENT_ACTIONS))
    expect(resume).toContain('consultent le programme')
    expect(allOpen(ferme(...PATIENT_ACTIONS))).toBe(false)
  })
})
