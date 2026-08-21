import { describe, expect, it } from 'vitest'
import {
  bannerLabel,
  canImpersonate,
  impersonationRefusal,
  matchAccounts,
  sortAccounts,
  type Account,
} from './impersonation'

const camille: Account = {
  uid: 'p_camille',
  label: 'Camille',
  detail: 'Le Mazurel',
  kind: 'patient',
}
const lemaire: Account = {
  uid: 's_lemaire',
  label: 'Docteur Lemaire',
  detail: 'Psychiatre',
  kind: 'staff',
}

describe('qui peut se mettre à la place de qui', () => {
  it('accorde à l’administrateur la place de n’importe qui', () => {
    expect(canImpersonate({ uid: 'admin', role: 'admin' }, camille)).toBe(true)
    expect(canImpersonate({ uid: 'admin', role: 'admin' }, lemaire)).toBe(true)
  })

  it('refuse à un soignant ordinaire', () => {
    expect(canImpersonate({ uid: 's_marc', role: 'staff' }, camille)).toBe(false)
    expect(impersonationRefusal({ uid: 's_marc', role: 'staff' }, camille)).toMatch(/administrateur/)
  })

  it('refuse à qui n’est pas connecté', () => {
    expect(canImpersonate({ uid: null, role: null }, camille)).toBe(false)
  })

  it('refuse de se prendre soi-même pour cible', () => {
    expect(canImpersonate({ uid: 's_lemaire', role: 'admin' }, lemaire)).toBe(false)
    expect(impersonationRefusal({ uid: 's_lemaire', role: 'admin' }, lemaire)).toBe(
      'Vous êtes déjà à votre place.',
    )
  })

  it('ne donne aucun motif quand c’est possible', () => {
    expect(impersonationRefusal({ uid: 'admin', role: 'admin' }, camille)).toBeNull()
  })
})

describe('trouver un compte dans la liste', () => {
  const tous = [camille, lemaire, { ...camille, uid: 'p_lucien', label: 'Lucien', detail: 'La Ferme' }]

  it('ne filtre rien quand la recherche est vide', () => {
    expect(matchAccounts(tous, '   ')).toHaveLength(3)
  })

  it('ignore les majuscules et les accents', () => {
    expect(matchAccounts(tous, 'LEMAIRE').map((a) => a.uid)).toEqual(['s_lemaire'])
    expect(matchAccounts(tous, 'mazurél').map((a) => a.uid)).toEqual(['p_camille'])
  })

  it('cherche aussi dans le poste et le service', () => {
    expect(matchAccounts(tous, 'psychiatre').map((a) => a.uid)).toEqual(['s_lemaire'])
  })

  it('rend une liste vide plutôt que tout, quand rien ne correspond', () => {
    expect(matchAccounts(tous, 'zzz')).toEqual([])
  })
})

describe('ordre d’affichage', () => {
  it('met le personnel avant les patients, puis classe par nom', () => {
    const desordre: Account[] = [
      { ...camille, uid: 'p_zoe', label: 'Zoé' },
      lemaire,
      camille,
      { ...lemaire, uid: 's_claire', label: 'Claire' },
    ]
    expect(sortAccounts(desordre).map((a) => a.label)).toEqual([
      'Claire',
      'Docteur Lemaire',
      'Camille',
      'Zoé',
    ])
  })

  it('ne modifie pas la liste reçue', () => {
    const liste = [camille, lemaire]
    sortAccounts(liste)
    expect(liste[0]).toBe(camille)
  })
})

describe('le bandeau', () => {
  it('nomme la personne, et dit que ce n’est pas soi', () => {
    expect(bannerLabel(camille)).toBe("Vous voyez l'application à la place du patient Camille.")
    expect(bannerLabel(lemaire)).toBe("Vous voyez l'application à la place de Docteur Lemaire.")
  })
})
