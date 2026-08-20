/** Routeur minimal par ancre. Deux niveaux de profondeur, pas plus. */
class Router {
  path = $state(readPath())

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
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
