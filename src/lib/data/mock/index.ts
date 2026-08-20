/**
 * Point d'entrée unique des adapters de démonstration.
 *
 * Les deux adapters partagent un état — le catalogue modifiable, notamment. Les charger
 * par ce module garantit qu'ils vivent dans le même fragment JavaScript, donc qu'ils
 * partagent bien la même instance : chargés séparément, chacun en recevrait une copie.
 */
export { createMockRepository, type MockRepository } from './mockRepository'
export { createMockStaffApp } from './staffRepository'
