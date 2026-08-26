import { describe, expect, it } from 'vitest'
import { RETOUR_PAR_DEFAUT, backTarget } from './retour'

/**
 * Le bouton « Retour » ramène vers le calendrier, jamais vers un frère.
 *
 * Il a d'abord mené toujours au calendrier — ce qui faisait perdre sa semaine pour avoir
 * simplement regardé une fiche. Puis il a suivi l'écran précédent, quel qu'il soit — et
 * cela enfermait : « Mes inscriptions » et « Ma semaine » devenaient le retour l'un de
 * l'autre, et le calendrier n'était plus atteignable.
 *
 * Ce qu'on garde des deux : une hiérarchie. On revient d'où l'on vient **quand cela
 * remonte**, et au calendrier sinon.
 */
const FICHE = '/activite/atelier-cuisine_20260826T1000'
const ECRANS = ['/ma-semaine', '/mes-inscriptions', '/proposer', '/rendez-vous', FICHE]
const VENUES = [null, '/', '/ma-semaine', '/mes-inscriptions', '/rendez-vous', '/proposer', FICHE]

describe('où ramène le bouton « Retour »', () => {
  it('ramène à sa semaine quand on a ouvert la fiche depuis sa semaine', () => {
    expect(backTarget(FICHE, '/ma-semaine')).toEqual({
      to: '/ma-semaine',
      label: 'Retour à ma semaine',
    })
  })

  it('ramène à ses inscriptions quand on a ouvert la fiche depuis ses inscriptions', () => {
    expect(backTarget(FICHE, '/mes-inscriptions')).toEqual({
      to: '/mes-inscriptions',
      label: 'Retour à mes inscriptions',
    })
  })

  it('ramène au calendrier depuis une fiche ouverte depuis le calendrier', () => {
    expect(backTarget(FICHE, '/')).toEqual(RETOUR_PAR_DEFAUT)
    expect(backTarget(FICHE, null)).toEqual(RETOUR_PAR_DEFAUT)
  })

  it('laisse la demande de rendez-vous revenir d’où elle vient', () => {
    // Le bouton existe sur le calendrier et dans « Mes inscriptions » : les deux mènent ici.
    expect(backTarget('/rendez-vous', '/mes-inscriptions').to).toBe('/mes-inscriptions')
    expect(backTarget('/rendez-vous', '/')).toEqual(RETOUR_PAR_DEFAUT)
  })

  /*
    Le test qui aurait attrapé le défaut.

    « Mes inscriptions » puis « Ma semaine » puis « Mes inscriptions » : le bouton faisait
    l'aller-retour entre les deux, sans fin. On vérifie donc ce qui compte vraiment — non
    pas telle destination, mais le fait qu'on **sorte**.
  */
  it('ne peut pas enfermer : depuis n’importe quel écran, on atteint le calendrier', () => {
    for (const depart of ECRANS) {
      for (const venue of VENUES) {
        let ecran = depart
        let precedent = venue
        const vus: string[] = []
        let pas = 0
        while (ecran !== '/' && pas < 10) {
          vus.push(ecran)
          const cible = backTarget(ecran, precedent)
          expect(cible.to, `${ecran} (venu de ${precedent}) revient sur lui-même`).not.toBe(ecran)
          precedent = ecran
          ecran = cible.to
          pas += 1
        }
        expect(ecran, `enfermé au départ de ${depart} (venu de ${venue}) : ${vus.join(' → ')}`).toBe(
          '/',
        )
      }
    }
  })

  it('atteint le calendrier en deux appuis au maximum', () => {
    for (const depart of ECRANS) {
      for (const venue of VENUES) {
        let ecran = depart
        let precedent = venue
        let appuis = 0
        /*
          La borne n'est pas une politesse : sans elle, ce test **se fige** au lieu
          d'échouer sur un enchaînement qui boucle. C'est arrivé en écrivant celui-ci,
          sur la version d'avant — deux minutes d'attente et aucun message. Un test qui
          ne rend pas la main ne dit rien à personne.
        */
        while (ecran !== '/' && appuis < 10) {
          const cible = backTarget(ecran, precedent)
          precedent = ecran
          ecran = cible.to
          appuis += 1
        }
        expect(ecran, `${depart} (venu de ${venue}) n’aboutit pas au calendrier`).toBe('/')
        expect(appuis, `${depart} (venu de ${venue}) demande ${appuis} appuis`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('annonce toujours où il mène, en toutes lettres', () => {
    for (const ecran of ECRANS) {
      for (const venue of VENUES) {
        expect(backTarget(ecran, venue).label.startsWith('Retour ')).toBe(true)
      }
    }
  })
})
