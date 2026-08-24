import { describe, expect, it } from 'vitest'
import {
  practitionerAudience,
  practitionerAudienceKeys,
  practitionerChoiceNotice,
  requestablePractitioners,
  servesService,
} from './practitioners'
import type { Practitioner } from './types'

const faire = (p: Partial<Practitioner> & { id: string; name: string }): Practitioner => ({
  role: 'Psychiatre',
  isActive: true,
  ...p,
})

describe("le public d'un intervenant", () => {
  it('vaut tous les services quand rien n’a été dit', () => {
    // Personne n'a été rattaché à quoi que ce soit avant que ce champ existe : ils
    // couvraient tout l'hôpital, et le déploiement ne doit rien restreindre en silence.
    const marc = faire({ id: 'marc', name: 'Marc' })
    expect(practitionerAudience(marc)).toEqual({ audience: 'all', serviceIds: [] })
    expect(servesService(marc, 'la-couturelle')).toBe(true)
    expect(servesService(marc, null)).toBe(true)
    expect(practitionerAudienceKeys(marc)).toEqual(['all'])
  })

  it('se restreint aux unités nommées', () => {
    const claire = faire({
      id: 'claire',
      name: 'Claire',
      audience: 'services',
      serviceIds: ['le-mazurel', 'la-couturelle'],
    })
    expect(servesService(claire, 'le-mazurel')).toBe(true)
    expect(servesService(claire, 'l-ancrive')).toBe(false)
    // Sans service connu, on ne peut rien affirmer : on ne propose pas.
    expect(servesService(claire, null)).toBe(false)
    expect(practitionerAudienceKeys(claire)).toEqual(['la-couturelle', 'le-mazurel'])
  })

  it('ne dédouble ni ne désordonne les unités', () => {
    const p = faire({
      id: 'p',
      name: 'P',
      audience: 'services',
      serviceIds: ['le-mesnil', 'la-couturelle', 'le-mesnil'],
    })
    expect(practitionerAudience(p).serviceIds).toEqual(['la-couturelle', 'le-mesnil'])
  })

  it('rattaché à aucune unité, ne sert personne', () => {
    const p = faire({ id: 'p', name: 'P', audience: 'services', serviceIds: [] })
    expect(servesService(p, 'le-mazurel')).toBe(false)
  })
})

describe('qui un patient peut demander à voir', () => {
  const gens: Practitioner[] = [
    faire({ id: 'lemaire', name: 'Docteur Lemaire', kindId: 'psychiatre' }),
    faire({
      id: 'ada',
      name: 'Ada',
      kindId: 'psychiatre',
      audience: 'services',
      serviceIds: ['le-mazurel'],
    }),
    faire({
      id: 'bruno',
      name: 'Bruno',
      kindId: 'psychiatre',
      audience: 'services',
      serviceIds: ['l-ancrive'],
    }),
    faire({ id: 'claire', name: 'Claire', kindId: 'psychologue' }),
    faire({ id: 'parti', name: 'Parti', kindId: 'psychiatre', isActive: false }),
  ]

  it('ne propose que le bon motif, en poste, et qui passe dans son unité', () => {
    const noms = requestablePractitioners(gens, 'psychiatre', 'le-mazurel').map((p) => p.name)
    expect(noms).toEqual(['Ada', 'Docteur Lemaire'])
  })

  it('ne propose personne d’une autre unité', () => {
    expect(requestablePractitioners(gens, 'psychiatre', 'l-escalette').map((p) => p.id)).toEqual([
      'lemaire',
    ])
  })

  it('ne propose rien sans motif', () => {
    expect(requestablePractitioners(gens, '', 'le-mazurel')).toEqual([])
  })

  it('trie par nom, pour que la liste ne bouge pas sous le doigt', () => {
    const noms = requestablePractitioners(gens, 'psychiatre', null).map((p) => p.name)
    expect(noms).toEqual(['Docteur Lemaire'])
  })
})

describe('ce que l’écran du patient en dit', () => {
  it('se tait quand il n’y a personne à proposer', () => {
    expect(practitionerChoiceNotice(0)).toBeNull()
  })

  it('parle au singulier comme au pluriel', () => {
    expect(practitionerChoiceNotice(1)).toContain('cette personne')
    expect(practitionerChoiceNotice(3)).toContain('en particulier')
  })
})
