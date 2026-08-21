import { randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Codes d'accès patients.
 *
 * Un code court est un secret faible : 6 caractères, environ un milliard de
 * combinaisons, ce qu'un ordinateur épuise en quelques minutes hors ligne. Trois
 * protections, décrites dans PLAN.md §4.5 :
 *   1. le code n'est jamais stocké en clair — l'identifiant du document `patientCodes`
 *      est son empreinte ;
 *   2. l'empreinte est dérivée par scrypt avec un poivre secret, ce qui rend une
 *      attaque par dictionnaire hors de portée même si la base fuit ;
 *   3. l'échange d'un code contre une session est limité en débit (voir `rateLimit.ts`).
 */

/** Crockford base32 : ni I, ni L, ni O, ni U — rien qui se confonde à la lecture. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const CODE_LENGTH = 6

export function generateCode(length: number = CODE_LENGTH): string {
  let code = ''
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/**
 * Tolère la façon dont un code est réellement saisi : minuscules, espaces, tirets,
 * et les confusions classiques entre O et 0, I/L et 1.
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

function pepper(): string {
  const value = process.env.CODE_PEPPER
  if (value && value.length > 0) return value
  // L'émulateur n'a pas de secret configuré ; en production, l'absence est une erreur.
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'test') {
    return 'poivre-de-developpement-sans-valeur'
  }
  throw new Error('CODE_PEPPER manquant : les codes patients ne peuvent pas être dérivés.')
}

/** Empreinte déterministe et coûteuse à calculer : c'est l'identifiant du document. */
export function hashCode(code: string): string {
  return scryptSync(normalizeCode(code), pepper(), 32, { N: 16384, r: 8, p: 1 }).toString('hex')
}

export function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Identifiant du patient, indépendant du code : révoquer un code ne détruit pas
 * ses inscriptions, et en délivrer un nouveau ne change pas son identité.
 */
export function newPatientUid(): string {
  return `p_${randomUUID().replace(/-/g, '')}`
}

/** Groupes de trois caractères : « 4KT-9RM » se lit et se recopie sans erreur. */
export function formatCodeForPrint(code: string): string {
  return code.replace(/(.{3})(?=.)/g, '$1-')
}
