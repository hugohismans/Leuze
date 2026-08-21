/**
 * Le pont entre la règle du domaine et le navigateur.
 *
 * `domain/errors.ts` décide quoi dire ; il ne connaît ni `navigator`, ni le navigateur —
 * c'est la règle du projet, et c'est ce qui le rend testable. Ce module minuscule lui
 * apporte la seule chose qu'il ne peut pas savoir : si l'appareil a du réseau.
 */
import { friendlyError } from './domain/errors'

export function enClair(error: unknown): string {
  const brut = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return friendlyError(brut, typeof navigator === 'undefined' ? true : navigator.onLine)
}
