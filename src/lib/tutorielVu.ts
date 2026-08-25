import { rememberSeen } from './domain/tutoriel'

/**
 * Qui a déjà vu le petit tour, sur cet appareil.
 *
 * Rangé dans le navigateur, et non sur le serveur, pour trois raisons.
 *
 * **Aucune écriture cliente sur `patients`.** C'est la règle n° 2 du projet, et il n'y a
 * pas de raison d'ouvrir une Cloud Function pour un drapeau d'affichage.
 *
 * **C'est bien « cette personne, sur cet appareil » qui compte.** Une tablette posée dans
 * une unité sert à tout le monde : chacun doit voir le petit tour une fois sur cette
 * tablette-là. Quelqu'un qui ouvre ensuite l'application sur son téléphone le reverra,
 * et ce n'est pas un défaut — un écran nouveau, un rappel.
 *
 * **Rien n'est perdu si le stockage manque.** Navigation privée, stockage refusé, mode
 * dégradé : le petit tour reparaît, et c'est tout. Aucune lecture ni aucune écriture ne
 * doit pouvoir empêcher l'application de s'ouvrir — d'où les `try` de chaque côté.
 *
 * `localStorage` et non `sessionStorage` : le petit tour ne doit pas revenir à chaque
 * fois qu'on ferme l'onglet.
 */
const CLE = 'leuze.tuto.vus'

function lire(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const brut = localStorage.getItem(CLE)
    if (brut === null) return []
    const lu: unknown = JSON.parse(brut)
    return Array.isArray(lu) ? lu.filter((x): x is string => typeof x === 'string') : []
  } catch {
    // Un contenu illisible — un ancien format, une main qui a écrit dans la console — ne
    // doit pas empêcher l'application de s'ouvrir. On repart d'une liste vide.
    return []
  }
}

/** Les comptes retenus, tels quels : la décision d'ouvrir se prend dans le domaine. */
export function comptesAyantVuLeTutoriel(): string[] {
  return lire()
}

/** Le petit tour a été montré : on ne le proposera plus tout seul à ce compte. */
export function retenirTutorielVu(patientUid: string | null): void {
  if (patientUid === null || patientUid.trim() === '') return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(CLE, JSON.stringify(rememberSeen(lire(), patientUid)))
  } catch {
    // Sans stockage, le petit tour reparaîtra à la prochaine ouverture. Ce n'est pas
    // une erreur, et cela ne vaut pas la peine d'inquiéter qui que ce soit.
  }
}
