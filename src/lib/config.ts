/**
 * Décisions de produit encore ouvertes, isolées ici pour être basculées sans toucher au code.
 * Les valeurs par défaut sont celles argumentées dans PLAN.md §6.
 */
export const config = {
  /**
   * Vue mois côté patient. Le brief la demande (§5), elle est donc active.
   * Ma recommandation reste de la réserver au personnel (PLAN.md §6.1) :
   * passer cette valeur à `false` la retire de l'interface patient, sans autre changement.
   */
  patientMonthView: true,
  /** Nombre exact de places restantes côté patient. Par défaut : formulation qualitative (§6.7). */
  patientShowsExactPlaces: false,
  /** En dessous de ce seuil, on affiche « Dernières places ». */
  lastPlacesThreshold: 3,
  /** L'unité de soins n'est jamais affichée sur un écran patient (§6.5). */
  showUnitToPatient: false,
  /** Retour au calendrier public après inactivité, en mode borne partagée (§6.3). */
  kioskIdleTimeoutSeconds: 90,
  /** Fenêtre de matérialisation des occurrences, en semaines. */
  generationWindowWeeks: 12,
  /** Purge des inscriptions et des identifiants patients. */
  retentionDays: 90,
} as const
