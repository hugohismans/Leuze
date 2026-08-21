/**
 * Catalogue de démonstration, modifiable en mémoire.
 *
 * Il existe parce que l'écran d'administration doit pouvoir ajouter un lieu ou un service
 * et que le changement se voie immédiatement côté patient. Les tableaux du seed ne sont
 * jamais modifiés : ils servent de point de départ, et cet état-ci fait autorité pendant
 * la session.
 *
 * ⚠️ Ce module doit rester dans le **même fragment** que les deux adapters mock, sinon
 * chacun en recevrait une copie et les écritures de l'un seraient invisibles à l'autre.
 * C'est la raison d'être de `mock/index.ts`, qui les charge ensemble.
 */
import type { CatalogKind } from '../../domain/catalog'
import type { Category, Location, Practitioner, Service } from '../../domain/types'
import { categoriesSeed } from '../seed/categories.seed'
import { locationsSeed } from '../seed/locations.seed'
import { practitionersSeed } from '../seed/practitioners.seed'
import { servicesSeed } from '../seed/services.seed'

const locations = new Map<string, Location>(locationsSeed.map((l) => [l.id, { ...l }]))
const services = new Map<string, Service>(servicesSeed.map((s) => [s.id, { ...s }]))
const categories = new Map<string, Category>(categoriesSeed.map((c) => [c.id, { ...c }]))
const practitioners = new Map<string, Practitioner>(practitionersSeed.map((p) => [p.id, { ...p }]))

type Entree = Location | Service | Category | Practitioner

function tableDe(kind: CatalogKind): Map<string, Entree> {
  if (kind === 'location') return locations as Map<string, Entree>
  if (kind === 'service') return services as Map<string, Entree>
  if (kind === 'category') return categories as Map<string, Entree>
  return practitioners as Map<string, Entree>
}

export const mockCatalog = {
  // Tout est renvoyé, y compris ce qui a été retiré : sinon une séance déjà programmée
  // perdrait le nom de son lieu. Le tri se fait au moment de proposer un choix.
  locations: (): Location[] => [...locations.values()],
  services: (): Service[] => [...services.values()],
  categories: (): Category[] => [...categories.values()],
  practitioners: (): Practitioner[] => [...practitioners.values()],

  remove(kind: CatalogKind, id: string): void {
    tableDe(kind).delete(id)
  },

  deactivate(kind: CatalogKind, id: string): void {
    const table = tableDe(kind)
    const entree = table.get(id)
    if (entree !== undefined) table.set(id, { ...entree, isActive: false })
  },

  saveLocation(location: Location): void {
    locations.set(location.id, { ...locations.get(location.id), ...location })
  },
  saveService(service: Service): void {
    services.set(service.id, { ...services.get(service.id), ...service })
  },
  saveCategory(category: Category): void {
    categories.set(category.id, { ...categories.get(category.id), ...category })
  },
  savePractitioner(practitioner: Practitioner): void {
    practitioners.set(practitioner.id, { ...practitioners.get(practitioner.id), ...practitioner })
  },
}
