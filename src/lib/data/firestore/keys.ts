/**
 * Le prénom du patient est la seule chose que l'application garde dans le navigateur :
 * il n'est pas dans le jeton, et la fiche `patients/` n'est pas lisible côté client.
 *
 * La clé vit ici, dans un module minuscule, parce que deux adapters l'écrivent :
 * l'échange du code côté patient, et « Voir à leur place » côté administrateur.
 */
export const FIRST_NAME_KEY = 'leuze.prenom'
