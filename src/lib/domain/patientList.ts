/**
 * La liste des personnes, telle qu'un soignant la lit.
 *
 * Deux questions se posent chaque fois qu'on affiche cette liste, et l'écran s'était
 * trompé sur les deux.
 *
 * **Sous quel service ranger quelqu'un dont le service a été retiré du catalogue ?**
 * L'écran groupait par services *proposés* : retirer « L'Escalette » des listes faisait
 * disparaître Yannick, sans un mot, alors que le catalogue venait de promettre « rien
 * n'a été effacé ». On ne pouvait plus lui délivrer de code ni clôturer son séjour.
 * Un service retiré cesse d'être proposé pour une nouvelle personne ; il continue de
 * ranger celles qui y sont.
 *
 * **Que faire de deux personnes du même prénom ?** L'hôpital n'enregistre pas les noms
 * de famille, et ce n'est pas négociable. On ne peut donc pas les distinguer — mais on
 * peut au moins le dire, plutôt que de laisser deux cartes rigoureusement identiques
 * côte à côte, avec les mêmes boutons.
 *
 * Fonctions pures : ce module ne lit rien et n'écrit rien.
 */

export type ListedService = { id: string; name: string; isActive?: boolean }

export type ServiceGroup<P> = {
  serviceId: string
  name: string
  /** Vrai quand ce service n'est plus proposé : les personnes y restent, l'écran le dit. */
  retired: boolean
  patients: P[]
}

/**
 * Range les personnes par service, sans en perdre une seule.
 *
 * Les services proposés viennent d'abord, dans l'ordre du catalogue ; ceux qui ont été
 * retirés ferment la marche. Un service inconnu du catalogue — effacé pour de bon — garde
 * ses personnes sous un intitulé qui le dit.
 */
export function groupByService<P extends { serviceId: string }>(
  patients: P[],
  services: ListedService[],
): ServiceGroup<P>[] {
  const groupes = new Map<string, P[]>()
  for (const patient of patients) {
    const liste = groupes.get(patient.serviceId) ?? []
    liste.push(patient)
    groupes.set(patient.serviceId, liste)
  }

  const rang = new Map(services.map((service, index) => [service.id, index]))
  return [...groupes.entries()]
    .map(([serviceId, liste]) => {
      const service = services.find((s) => s.id === serviceId)
      return {
        serviceId,
        name: service?.name ?? 'Service inconnu',
        retired: service === undefined || service.isActive === false,
        patients: liste,
      }
    })
    .sort((a, b) => {
      // Les services encore proposés d'abord, puis ceux qui ne le sont plus.
      if (a.retired !== b.retired) return a.retired ? 1 : -1
      const ra = rang.get(a.serviceId) ?? Number.MAX_SAFE_INTEGER
      const rb = rang.get(b.serviceId) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name, 'fr')
    })
}

/** Deux prénoms se comparent sans tenir compte de la casse ni des espaces autour. */
function clef(firstName: string): string {
  return firstName.trim().toLocaleLowerCase('fr')
}

/**
 * Les prénoms portés par plus d'une personne dans le même service.
 *
 * Rendu sous forme de clés « service|prénom » : deux Camille dans deux unités
 * différentes ne posent aucun problème — on ne les voit jamais côte à côte.
 */
export function sharedFirstNames<P extends { serviceId: string; firstName: string }>(
  patients: P[],
): Set<string> {
  const comptes = new Map<string, number>()
  for (const patient of patients) {
    const cle = `${patient.serviceId}|${clef(patient.firstName)}`
    comptes.set(cle, (comptes.get(cle) ?? 0) + 1)
  }
  return new Set([...comptes.entries()].filter(([, n]) => n > 1).map(([cle]) => cle))
}

/** Vrai quand cette personne partage son prénom avec une autre, dans le même service. */
export function sharesFirstName(
  partages: Set<string>,
  patient: { serviceId: string; firstName: string },
): boolean {
  return partages.has(`${patient.serviceId}|${clef(patient.firstName)}`)
}

/** Combien de personnes portent chaque prénom, service par service. */
export function firstNameCounts<P extends { serviceId: string; firstName: string }>(
  patients: P[],
): Map<string, number> {
  const comptes = new Map<string, number>()
  for (const patient of patients) {
    const cle = `${patient.serviceId}|${clef(patient.firstName)}`
    comptes.set(cle, (comptes.get(cle) ?? 0) + 1)
  }
  return comptes
}

/**
 * L'avertissement porté par la carte d'une personne, quand une autre porte son prénom.
 *
 * La carte disait « Une autre personne de ce service porte le même prénom » quel que
 * soit leur nombre, tandis que l'avertissement du formulaire, écrit le même jour,
 * comptait juste. Trois Camille dans une unité, c'est justement le cas où le soignant a
 * le plus besoin de savoir combien.
 */
export function sameNameNotice(
  comptes: Map<string, number>,
  patient: { serviceId: string; firstName: string },
): string | null {
  const combien = (comptes.get(`${patient.serviceId}|${clef(patient.firstName)}`) ?? 0) - 1
  if (combien <= 0) return null
  const qui =
    combien === 1
      ? 'Une autre personne de ce service porte le même prénom.'
      : `${combien} autres personnes de ce service portent le même prénom.`
  return `${qui} Vérifiez avant de délivrer un code ou de clôturer un séjour.`
}

/**
 * L'avertissement à écrire avant de créer une personne dont le prénom existe déjà.
 *
 * Il n'empêche rien : deux Camille peuvent parfaitement séjourner dans la même unité, et
 * l'application n'a pas à le refuser. Il demande seulement de le faire exprès.
 */
export function sameNameWarning<P extends { serviceId: string; firstName: string }>(
  patients: P[],
  firstName: string,
  serviceId: string,
  serviceName: string,
): string | null {
  const nom = firstName.trim()
  if (nom === '') return null
  const combien = patients.filter(
    (p) => p.serviceId === serviceId && clef(p.firstName) === clef(nom),
  ).length
  if (combien === 0) return null
  return combien === 1
    ? `Une personne s'appelle déjà ${nom} dans ${serviceName}. Sans nom de famille, les deux se ressembleront à l'écran.`
    : `${combien} personnes s'appellent déjà ${nom} dans ${serviceName}. Sans nom de famille, elles se ressembleront à l'écran.`
}

/**
 * La longueur maximale d'un prénom.
 *
 * Sans limite, un mot de soixante-neuf lettres étirait toutes les cartes de la liste à
 * mille pixels : sur une tablette, les boutons « Nouveau code » et « Fin de séjour » de
 * *chaque* personne sortaient de l'écran. Trente caractères tiennent tous les prénoms
 * qu'on écrit vraiment.
 */
export const FIRST_NAME_MAX = 30
