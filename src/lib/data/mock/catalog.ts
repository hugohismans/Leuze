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
import type { Category, Location, Service } from '../../domain/types'
import { categoriesSeed } from '../seed/categories.seed'
import { locationsSeed } from '../seed/locations.seed'
import { servicesSeed } from '../seed/services.seed'

const locations = new Map<string, Location>(locationsSeed.map((l) => [l.id, { ...l }]))
const services = new Map<string, Service>(servicesSeed.map((s) => [s.id, { ...s }]))
const categories = new Map<string, Category>(categoriesSeed.map((c) => [c.id, { ...c }]))

export const mockCatalog = {
  locations: (): Location[] => [...locations.values()].filter((l) => l.isActive),
  services: (): Service[] => [...services.values()].filter((s) => s.isActive),
  categories: (): Category[] => [...categories.values()],

  saveLocation(location: Location): void {
    locations.set(location.id, { ...locations.get(location.id), ...location })
  },
  saveService(service: Service): void {
    services.set(service.id, { ...services.get(service.id), ...service })
  },
  saveCategory(category: Category): void {
    categories.set(category.id, { ...categories.get(category.id), ...category })
  },
}
