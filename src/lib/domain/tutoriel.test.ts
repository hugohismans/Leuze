import { describe, expect, it } from 'vitest'
import {
  SEEN_MAX,
  hasSeen,
  progressLabel,
  rememberSeen,
  shouldOfferTutorial,
  tutorialSteps,
  type TutorialStep,
} from './tutoriel'

/**
 * Le petit tour est le premier texte que lit une personne qui découvre l'application.
 *
 * S'il est fautif, long, ou plein de mots d'informatique, il fait exactement l'inverse de
 * ce pour quoi il existe. Ces tests gardent ce qui a été décidé avec l'équipe : des
 * phrases courtes, le vouvoiement, aucune abréviation, et les boutons nommés tels qu'ils
 * sont écrits à l'écran.
 */
describe('le petit tour', () => {
  const etapes = tutorialSteps('La Couturelle')
  const toutLeTexte = (pas: TutorialStep[]): string =>
    pas.map((e) => `${e.title} ${e.lines.join(' ')}`).join(' ')

  it('tient en six écrans, dans l’ordre', () => {
    expect(etapes.map((e) => e.id)).toEqual([
      'bienvenue',
      'programme',
      'activite',
      'ma-semaine',
      'mes-inscriptions',
      'fin',
    ])
  })

  it('accueille en nommant le service', () => {
    const bienvenue = etapes[0]!
    expect(bienvenue.title).toContain('Bienvenue')
    expect(bienvenue.lines.join(' ')).toContain('La Couturelle')
    // « votre service » : c'est son programme à elle, pas celui de l'hôpital entier.
    expect(bienvenue.lines.join(' ')).toContain('votre service')
  })

  it('reste lisible quand le service est inconnu', () => {
    /*
      Le service arrive après la session : pendant un instant, il vaut `null`. Le texte
      ne doit ni afficher « null », ni se retrouver avec un blanc au milieu d'une phrase.
    */
    for (const vide of [null, '', '   ']) {
      const bienvenue = tutorialSteps(vide)[0]!
      const texte = bienvenue.lines.join(' ')
      expect(texte).toContain('de votre service')
      expect(texte).not.toContain('null')
      expect(texte).not.toMatch(/\s,/)
      expect(texte).not.toMatch(/\s{2}/)
    }
  })

  it('nomme les boutons tels qu’ils sont écrits à l’écran', () => {
    /*
      C'est la règle qui fait tenir le reste : la personne doit reconnaître, mot pour mot,
      ce qu'elle vient de lire. Ces libellés sont ceux des vrais boutons — les changer
      d'un côté sans l'autre casse ce test, et c'est le but.
    */
    const texte = toutLeTexte(etapes)
    for (const bouton of [
      '« Jour »',
      '« Semaine »',
      '« Je m’inscris »',
      '« Voir ma semaine »',
      '« Mes inscriptions »',
    ]) {
      expect(texte).toContain(bouton)
    }
  })

  it('dit qu’on peut se retirer : c’est ce qui décide quelqu’un à essayer', () => {
    const texte = toutLeTexte(etapes)
    expect(texte).toContain('vous retirer')
    expect(texte).toContain('Rien n’est définitif')
  })

  it('renvoie vers un soignant plutôt que vers une aide en ligne', () => {
    expect(toutLeTexte(etapes)).toContain('demandez à un soignant')
  })

  /*
    Un mot entier, accents compris.

    « \b » de JavaScript ne connaît que l'alphabet sans accent : « ê » y est une frontière
    de mot, si bien que « vous êtes » contenait « tes » et faisait échouer la recherche du
    tutoiement. On borne donc sur les lettres, au sens d'Unicode.
  */
  const contientLeMot = (texte: string, mot: string): boolean =>
    new RegExp(`(?<!\\p{L})${mot}(?!\\p{L})`, 'u').test(texte)

  it('vouvoie, du premier mot au dernier', () => {
    const texte = toutLeTexte(etapes).toLocaleLowerCase('fr')
    for (const tutoiement of ['tu', 'ton', 'ta', 'tes', 'toi']) {
      expect(contientLeMot(texte, tutoiement)).toBe(false)
    }
    // Et le vouvoiement, lui, est bien là.
    expect(contientLeMot(texte, 'vous')).toBe(true)
  })

  it('n’emploie ni abréviation ni mot d’informatique', () => {
    const texte = toutLeTexte(etapes).toLocaleLowerCase('fr')
    for (const interdit of [
      'appli',
      'clic',
      'cliquer',
      'cliquez',
      'onglet',
      'rdv',
      'ok',
      'valider',
      'interface',
      'etc',
    ]) {
      expect(contientLeMot(texte, interdit)).toBe(false)
    }
    // « application » est un mot français ordinaire : c'est « appli » qui est proscrit.
    expect(texte).toContain('application')
  })

  it('garde des phrases courtes : trois lignes au plus, et pas de tartine', () => {
    for (const etape of etapes) {
      expect(etape.lines.length).toBeGreaterThan(0)
      expect(etape.lines.length).toBeLessThanOrEqual(3)
      for (const ligne of etape.lines) {
        // Cent trente caractères : au-delà, la phrase se relit deux fois.
        expect(ligne.length).toBeLessThanOrEqual(130)
      }
    }
  })

  it('porte une image sur chaque écran, et un titre qui suffit sans elle', () => {
    for (const etape of etapes) {
      expect(etape.emoji.length).toBeGreaterThan(0)
      // Le titre ne dépend jamais de l'image : elle est décorative.
      expect(etape.title.trim().length).toBeGreaterThan(0)
      expect(etape.title).not.toContain(etape.emoji)
    }
  })
})

describe('où l’on en est dans le petit tour', () => {
  it('le dit en toutes lettres, et non par une couleur', () => {
    expect(progressLabel(0, 6)).toBe('Étape 1 sur 6')
    expect(progressLabel(5, 6)).toBe('Étape 6 sur 6')
  })

  it('ne sort jamais des bornes, quoi qu’on lui passe', () => {
    expect(progressLabel(-3, 6)).toBe('Étape 1 sur 6')
    expect(progressLabel(99, 6)).toBe('Étape 6 sur 6')
  })
})

/**
 * Se souvenir de qui a déjà vu le petit tour.
 *
 * La liste vit dans le navigateur : une tablette posée dans une unité sert à tout le
 * monde, et c'est bien « cette personne, sur cet appareil » que l'on retient. Quelqu'un
 * qui ouvre l'application sur son téléphone reverra le petit tour — ce n'est pas grave,
 * et c'est même plutôt bien.
 */
describe('se souvenir de qui a vu le petit tour', () => {
  it('reconnaît un compte déjà passé, et lui seul', () => {
    const vus = ['p1', 'p2']
    expect(hasSeen(vus, 'p1')).toBe(true)
    expect(hasSeen(vus, 'p3')).toBe(false)
    expect(hasSeen(vus, null)).toBe(false)
    expect(hasSeen(vus, '  ')).toBe(false)
  })

  it('ajoute sans jamais compter deux fois la même personne', () => {
    expect(rememberSeen(['p1'], 'p2')).toEqual(['p2', 'p1'])
    expect(rememberSeen(['p1', 'p2'], 'p1')).toEqual(['p1', 'p2'])
    expect(rememberSeen(['p1', 'p2'], 'p1')).toHaveLength(2)
  })

  it('ne retient rien d’un compte vide', () => {
    expect(rememberSeen(['p1'], '')).toEqual(['p1'])
    expect(rememberSeen(['p1'], '   ')).toEqual(['p1'])
  })

  it('ne grossit pas sans fin sur une tablette partagée', () => {
    let vus: string[] = []
    for (let i = 0; i < SEEN_MAX + 10; i += 1) vus = rememberSeen(vus, `p${i}`)
    expect(vus).toHaveLength(SEEN_MAX)
    // Le dernier arrivé est gardé, le plus ancien s'en va.
    expect(vus[0]).toBe(`p${SEEN_MAX + 9}`)
    expect(vus).not.toContain('p0')
  })
})

/**
 * Quand le petit tour s'ouvre-t-il tout seul ?
 *
 * C'est la décision la plus discrète du lot, et celle qui se trompe le plus facilement :
 * une tablette posée dans une unité voit passer plusieurs personnes sans jamais recharger
 * la page. Un simple « déjà fait » aurait privé du petit tour tous ceux qui passent après
 * le premier — c'est-à-dire tout le monde, sauf une personne par jour.
 */
describe('faut-il ouvrir le petit tour tout seul ?', () => {
  it('oui, à quelqu’un qui arrive pour la première fois', () => {
    expect(shouldOfferTutorial('p1', null, [])).toBe(true)
  })

  it('non, à quelqu’un qui l’a déjà vu sur cet appareil', () => {
    expect(shouldOfferTutorial('p1', null, ['p1'])).toBe(false)
  })

  it('non, deux fois de suite à la même personne', () => {
    // Sinon, le refermer le rouvrirait au calcul suivant.
    expect(shouldOfferTutorial('p1', 'p1', [])).toBe(false)
  })

  it('oui, à la personne suivante sur la même tablette, sans rechargement', () => {
    /*
      Le cas qui compte. « p1 » vient de fermer son accès, « p2 » entre son code : la page
      n'a pas bougé, et c'est pourtant une première connexion.
    */
    expect(shouldOfferTutorial('p2', 'p1', ['p1'])).toBe(true)
  })

  it('non, tant que personne n’est connecté', () => {
    expect(shouldOfferTutorial(null, null, [])).toBe(false)
    expect(shouldOfferTutorial('   ', null, [])).toBe(false)
  })
})
