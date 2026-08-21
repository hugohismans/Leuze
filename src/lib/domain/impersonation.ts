/**
 * « Voir à leur place » — un outil de mise au point, pas une fonctionnalité de soin.
 *
 * Quand on prépare l'application, on crée des patients et des membres du personnel, puis
 * on veut vérifier ce que chacun voit **vraiment** : le calendrier d'un patient du
 * Mazurel n'est pas celui d'un patient de la Ferme, et l'appel n'est ouvert qu'à la
 * personne qui anime l'activité. Retenir autant de mots de passe est intenable ; se
 * mettre à leur place en un clic l'est beaucoup moins.
 *
 * Ce module ne contient que les décisions, pures et testées. Ouvrir la session est
 * l'affaire du serveur, qui vérifie à nouveau le rôle : rien ici ne donne un droit.
 */

export type AccountKind = 'patient' | 'staff'

/** Un compte auquel on peut se substituer, tel qu'il s'affiche à l'écran. */
export type Account = {
  uid: string
  /** Ce qui l'identifie pour un humain : un prénom, un nom. */
  label: string
  /** Ce qui le précise : le service pour un patient, le poste ou l'adresse pour le personnel. */
  detail: string
  kind: AccountKind
}

export type Actor = { uid: string | null; role: 'staff' | 'admin' | null }

/**
 * Seul l'administrateur peut se mettre à la place de quelqu'un, et jamais à la sienne.
 * Le serveur revérifie : ceci n'accorde rien, cela accorde seulement l'interface.
 */
export function canImpersonate(actor: Actor, account: Account): boolean {
  if (actor.role !== 'admin') return false
  return account.uid !== actor.uid
}

/** Pourquoi c'est refusé, en toutes lettres. `null` quand c'est possible. */
export function impersonationRefusal(actor: Actor, account: Account): string | null {
  if (actor.role !== 'admin') {
    return "Seul un administrateur peut voir l'application à la place de quelqu'un."
  }
  if (account.uid === actor.uid) return 'Vous êtes déjà à votre place.'
  return null
}

/**
 * Comparaison indulgente : ni accents, ni majuscules, ni espaces en trop. On cherche
 * « lemaire » et on trouve « Docteur Lemaire ».
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Filtre la liste sur ce qui est tapé. Une recherche vide ne filtre rien. */
export function matchAccounts(accounts: Account[], query: string): Account[] {
  const cherche = fold(query)
  if (cherche.length === 0) return accounts
  return accounts.filter(
    (account) => fold(account.label).includes(cherche) || fold(account.detail).includes(cherche),
  )
}

/**
 * Ordre d'affichage : le personnel d'abord — c'est lui qu'on essaie le plus souvent —
 * puis les patients, chacun par ordre alphabétique.
 */
export function sortAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'staff' ? -1 : 1
    return a.label.localeCompare(b.label, 'fr')
  })
}

/** La phrase du bandeau, celle qui empêche de se croire chez soi. */
export function bannerLabel(target: { label: string; kind: AccountKind }): string {
  const quoi = target.kind === 'patient' ? 'du patient' : 'de'
  return `Vous voyez l'application à la place ${quoi} ${target.label}.`
}
