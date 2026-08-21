import type { Practitioner } from '../../domain/types'

/**
 * Intervenants fictifs de la démonstration.
 *
 * TODO : ces personnes n'existent pas. En service, elles sont créées depuis le catalogue.
 * Ce ne sont pas des comptes : personne ne se connecte avec ceci.
 */
export const practitionersSeed: Practitioner[] = [
  { id: 'docteur-lemaire', name: 'Docteur Lemaire', role: 'Psychiatre', kindId: 'psychiatre', isActive: true },
  { id: 'claire', name: 'Claire', role: 'Psychologue', kindId: 'psychologue', isActive: true },
  { id: 'julien', name: 'Julien', role: 'Kinésithérapeute', kindId: 'kinesitherapeute', isActive: true },
  { id: 'marc', name: 'Marc', role: 'Éducateur sportif', isActive: true },
  { id: 'sophie', name: 'Sophie', role: 'Ergothérapeute', isActive: true },
  { id: 'nadia', name: 'Nadia', role: 'Animatrice', isActive: true },
]
