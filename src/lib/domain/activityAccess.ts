/**
 * Qui peut modifier quelle activité, et au nom de qui.
 *
 * Le principe est le même que pour l'agenda : un membre du personnel n'atteint que ce
 * qui le concerne directement. Il crée des activités — c'est le cœur de son métier — mais
 * elles sont les siennes : il les anime. Désigner quelqu'un d'autre relève de
 * l'organisation du service, donc de l'administrateur.
 *
 * Le programme, lui, reste visible par tous : c'est un calendrier partagé, affiché au mur
 * de l'unité. Voir n'est pas modifier.
 *
 * Rien ici n'accorde de droit : les règles Firestore appliquent la même chose sur le
 * jeton. Ceci ne fait qu'accorder l'interface.
 */
import { animePar, type Anime } from './animation'

export type ActivityActor = {
  role: 'staff' | 'admin' | null
  /** L'intervenant auquel ce compte est relié. Sans lui, on n'anime rien. */
  practitionerId?: string | null
}

/** Vrai pour l'administrateur seul : lui seul choisit qui anime. */
export function canChooseFacilitator(actor: ActivityActor): boolean {
  return actor.role === 'admin'
}

function lienDe(actor: ActivityActor): string | null {
  const lien = actor.practitionerId
  return lien === undefined || lien === null || lien === '' ? null : lien
}

/**
 * L'intervenant que portera l'activité. Un administrateur garde son choix ; pour tout
 * autre, c'est lui-même — quoi qu'il ait pu être envoyé.
 */
export function facilitatorFor(actor: ActivityActor, chosen: string | null): string | null {
  if (canChooseFacilitator(actor)) return chosen
  return lienDe(actor)
}

/**
 * Peut-on modifier cette activité ? L'administrateur, toujours. Un intervenant,
 * seulement celles qu'il anime déjà — reprendre celle d'un collègue reviendrait à la lui
 * retirer, et une activité sans personne désignée relève de l'organisation du service.
 */
export function canEditActivity(actor: ActivityActor, activity: Anime | null): boolean {
  if (canChooseFacilitator(actor)) return true
  if (actor.role !== 'staff') return false
  const lien = lienDe(actor)
  if (lien === null) return false
  // Une activité qui n'existe pas encore sera la sienne : c'est le cas de la création.
  if (activity === null) return true
  // Chacun de ceux qui animent : à deux, le second ne pouvait pas modifier sa propre
  // activité — ni corriger l'heure, ni annuler une séance qu'il tient lui-même.
  return animePar(activity, lien)
}

/** Ce que l'écran explique quand la modification est refusée. `null` quand elle ne l'est pas. */
export function activityEditRefusal(
  actor: ActivityActor,
  activity: (Anime & { facilitator?: string }) | null,
): string | null {
  if (canEditActivity(actor, activity)) return null
  if (actor.role !== 'staff') return 'Cet écran est réservé au personnel soignant.'
  if (lienDe(actor) === null) {
    return "Votre compte n'est relié à aucune personne du personnel : vous ne pouvez pas encore créer d'activité. Demandez à un administrateur de faire le lien."
  }
  const qui = activity?.facilitator
  return qui === undefined || qui === ''
    ? "Cette activité n'est animée par personne en particulier : seul un administrateur peut la modifier."
    : `Cette activité est animée par ${qui}. Seul un administrateur peut la modifier.`
}
