import { describe, expect, it } from 'vitest'
import { accorde, de, enumeration, motAccorde, phrase, que } from './francais'

describe('l’élision', () => {
  it('élide devant une voyelle', () => {
    expect(de('Aline')).toBe('d’Aline')
    expect(de('Émile')).toBe('d’Émile')
    expect(de('Hugo')).toBe('d’Hugo')
    expect(que('Aline')).toBe('qu’Aline')
  })

  it('ne s’élide pas devant une consonne', () => {
    expect(de('Marc')).toBe('de Marc')
    expect(que('Camille')).toBe('que Camille')
  })

  it('ne fabrique rien à partir de rien', () => {
    expect(de('  ')).toBe('de')
    expect(que('')).toBe('que')
  })
})

describe('l’accord en nombre', () => {
  it('met zéro au singulier, comme en français', () => {
    expect(accorde(0, 'place restante', 'places restantes')).toBe('0 place restante')
    expect(accorde(1, 'place restante', 'places restantes')).toBe('1 place restante')
    expect(accorde(2, 'place restante', 'places restantes')).toBe('2 places restantes')
  })

  it('rend le mot seul quand le nombre est déjà écrit ailleurs', () => {
    expect(motAccorde(1, 'planning', 'plannings')).toBe('planning')
    expect(motAccorde(4, 'planning', 'plannings')).toBe('plannings')
  })
})

describe('l’énumération', () => {
  it('se lit à voix haute', () => {
    expect(enumeration(['le lundi'])).toBe('le lundi')
    expect(enumeration(['le lundi', 'le jeudi'])).toBe('le lundi et le jeudi')
    expect(enumeration(['le lundi', 'le mardi', 'le jeudi'])).toBe('le lundi, le mardi et le jeudi')
    expect(enumeration([])).toBe('')
  })
})

describe('la majuscule de début de phrase', () => {
  it('remet la capitale sur un morceau assemblé', () => {
    expect(phrase('un rendez-vous est remis dans la file')).toBe(
      'Un rendez-vous est remis dans la file',
    )
    expect(phrase('Déjà correct')).toBe('Déjà correct')
    expect(phrase('   ')).toBe('')
  })
})
