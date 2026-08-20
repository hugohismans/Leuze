import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from './slug'

describe('identifiants lisibles', () => {
  it('reproduit les identifiants des services existants', () => {
    expect(slugify('La Joncquerelle')).toBe('la-joncquerelle')
    expect(slugify("L'Ancrive")).toBe('l-ancrive')
    expect(slugify('Le Mazurel')).toBe('le-mazurel')
    expect(slugify("L'Écheveau")).toBe('l-echeveau')
  })

  it('retire les accents sans perdre les lettres', () => {
    expect(slugify('Salle de détente')).toBe('salle-de-detente')
    expect(slugify('Café-rencontre')).toBe('cafe-rencontre')
    expect(slugify('Ergothérapie')).toBe('ergotherapie')
  })

  it('supporte une saisie approximative', () => {
    expect(slugify('  Le   Jardin !!  ')).toBe('le-jardin')
    expect(slugify('Atelier n°2')).toBe('atelier-n-2')
    expect(slugify('')).toBe('')
  })

  it('évite les collisions', () => {
    expect(uniqueSlug('Le Jardin', [])).toBe('le-jardin')
    expect(uniqueSlug('Le Jardin', ['le-jardin'])).toBe('le-jardin-2')
    expect(uniqueSlug('Le Jardin', ['le-jardin', 'le-jardin-2'])).toBe('le-jardin-3')
    expect(uniqueSlug('!!', ['sans-nom'])).toBe('sans-nom-2')
  })
})
