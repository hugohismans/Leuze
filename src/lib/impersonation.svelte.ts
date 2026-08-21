/**
 * « Voir à leur place » : l'état du détour, et le chemin du retour.
 *
 * Firebase ne tient qu'une session par navigateur. Prendre la place de quelqu'un remplace
 * donc la sienne, pour de bon : c'est la seule façon de voir exactement ce qu'il voit,
 * règles Firestore comprises. Il faut alors deux choses — un bandeau qui empêche de se
 * croire chez soi, et un bouton pour revenir.
 *
 * Le billet de retour est un jeton pour son propre compte. Il ne donne rien de plus que
 * ce qu'on avait déjà, il vit une heure, et il est rangé dans le `sessionStorage` : il
 * disparaît avec l'onglet. C'est délibérément modeste — cet écran est un outil de mise
 * au point, pas une porte dérobée, et il se retire en supprimant un fichier.
 */
import { createStaffApp } from './data'
import type { AccountKind } from './domain/impersonation'

const CLE = 'leuze.aLaPlaceDe'

type Detour = { label: string; kind: AccountKind; back: string }

function lire(): Detour | null {
  try {
    const brut = sessionStorage.getItem(CLE)
    if (brut === null) return null
    const valeur = JSON.parse(brut) as Partial<Detour>
    if (typeof valeur.label !== 'string' || typeof valeur.back !== 'string') return null
    return { label: valeur.label, kind: valeur.kind === 'patient' ? 'patient' : 'staff', back: valeur.back }
  } catch {
    // Onglet privé, stockage refusé, contenu abîmé : on n'est simplement à la place de
    // personne. Jamais une erreur — l'application doit continuer de s'afficher.
    return null
  }
}

class Impersonation {
  /** Le détour en cours, ou `null` quand on est chez soi. */
  detour = $state<Detour | null>(typeof window === 'undefined' ? null : lire())
  /** Un message quand le retour échoue — le jeton n'ayant qu'une heure de validité. */
  message = $state<string | null>(null)

  readonly active = $derived(this.detour !== null)

  /** Note le détour. La session, elle, a déjà été ouverte par l'adapter. */
  start(detour: Detour): void {
    this.detour = detour
    this.message = null
    try {
      sessionStorage.setItem(CLE, JSON.stringify(detour))
    } catch {
      // Sans stockage, le bandeau disparaît au prochain rechargement. Le détour
      // fonctionne quand même : mieux vaut cela qu'un écran qui refuse de s'ouvrir.
    }
  }

  /** Revient à son propre compte, puis recharge la page pour repartir sur des bases nettes. */
  async stop(): Promise<void> {
    const detour = this.detour
    if (detour === null) return
    const application = await createStaffApp()
    const resultat = await application.superAdmin.resume(detour.back)
    this.oublie()
    if (!resultat.ok) {
      this.message = resultat.message
      window.location.hash = '/soignant'
    } else {
      window.location.hash = '/soignant/a-leur-place'
    }
    // Tout l'état de l'application — calendrier, inscriptions, catalogue — appartenait à
    // la personne dont on vient de sortir. Le recharger à la main serait une longue liste
    // à tenir à jour ; recharger la page ne se trompe pas.
    window.location.reload()
  }

  oublie(): void {
    this.detour = null
    try {
      sessionStorage.removeItem(CLE)
    } catch {
      // Voir plus haut : l'absence de stockage ne doit jamais arrêter quoi que ce soit.
    }
  }
}

export const impersonation = new Impersonation()
