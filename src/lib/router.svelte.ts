/** Routeur minimal par ancre. Deux niveaux de profondeur, pas plus. */
class Router {
  path = $state(readPath())

  /**
   * D'où l'on vient, pour que « Retour » y ramène.
   *
   * Le bouton menait toujours au calendrier. Depuis que les lignes de « Ma semaine »
   * s'ouvrent, cela veut dire perdre sa semaine pour avoir regardé une activité — et
   * devoir refaire le chemin. Le bouton ne bouge pas de place ; seule sa destination
   * suit celle qu'on attend.
   *
   * Écrit dans l'écouteur d'événement, jamais dans un effet : le lire et l'écrire dans
   * le même effet le relancerait sans fin.
   */
  previous = $state<string | null>(null)

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.previous = this.path
        this.path = readPath()
        window.scrollTo({ top: 0 })
      })
    }
  }
}

function readPath(): string {
  if (typeof window === 'undefined') return '/'
  return window.location.hash.slice(1) || '/'
}

export function navigate(path: string): void {
  window.location.hash = path
}

export const router = new Router()
