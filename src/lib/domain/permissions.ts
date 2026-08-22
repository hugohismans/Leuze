/**
 * Ce que les patients ont le droit de faire.
 *
 * L'application propose quatre gestes à un patient : s'inscrire à une activité, s'en
 * retirer, demander un rendez-vous, proposer une activité. Rien n'oblige un service à
 * les ouvrir tous, ni à les ouvrir tout de suite.
 *
 * C'est une décision d'organisation, pas de logiciel. Une unité peut vouloir commencer en
 * lecture seule — les patients regardent le programme, la réunion du lundi inscrit, comme
 * sur le papier qu'elle remplace — puis ouvrir l'inscription individuelle quand tout le
 * monde a pris ses marques. Une autre peut préférer que les rendez-vous se demandent de
 * vive voix. Aucune de ces décisions ne devrait demander un développeur.
 *
 * Deux principes gouvernent ce module.
 *
 * **Ouvert par défaut.** Une configuration absente, illisible ou à moitié écrite laisse
 * tout ouvert. Un réglage qu'on n'arrive pas à lire ne doit jamais fermer une porte :
 * quelqu'un se retrouverait devant un bouton disparu sans que personne ne l'ait décidé.
 *
 * **Fermer n'est pas cacher.** Un bouton qui disparaît sans explication se lit comme une
 * panne. Chaque geste fermé a donc sa phrase, qui dit ce qui se passe à la place — et
 * jamais « vous n'avez pas le droit », qui ne renseigne sur rien.
 */

/** Les quatre gestes qu'un patient peut faire dans l'application. */
export type PatientAction = 'register' | 'unregister' | 'requestAppointment' | 'proposeActivity'

export type PatientPermissions = Record<PatientAction, boolean>

export const PATIENT_ACTIONS: readonly PatientAction[] = [
  'register',
  'unregister',
  'requestAppointment',
  'proposeActivity',
]

/** Tout ouvert : c'est l'état par défaut, et celui d'avant ce réglage. */
export const OPEN_TO_PATIENTS: PatientPermissions = {
  register: true,
  unregister: true,
  requestAppointment: true,
  proposeActivity: true,
}

/**
 * Lit une configuration venue de la base, quelle qu'en soit la forme.
 *
 * Seul un `false` explicite ferme un geste. Tout le reste — champ absent, document vide,
 * valeur d'un autre type, lecture échouée qui rend `null` — laisse ouvert. C'est
 * volontairement asymétrique : se tromper en fermant prive quelqu'un d'un geste sans que
 * personne ne l'ait voulu, se tromper en ouvrant ne fait que rendre l'application telle
 * qu'elle était.
 */
export function readPermissions(raw: unknown): PatientPermissions {
  if (raw === null || typeof raw !== 'object') return { ...OPEN_TO_PATIENTS }
  const brut = raw as Record<string, unknown>
  const lues = {} as PatientPermissions
  for (const action of PATIENT_ACTIONS) lues[action] = brut[action] !== false
  return lues
}

export function isAllowed(permissions: PatientPermissions, action: PatientAction): boolean {
  return permissions[action] !== false
}

/**
 * Ce que le patient lit quand un geste est fermé.
 *
 * Chaque phrase dit ce qui se passe à la place, parce que la question qu'on se pose
 * devant un bouton absent n'est pas « pourquoi » mais « alors comment je fais ». Aucune
 * ne reproche quoi que ce soit, et aucune ne parle de droits.
 */
export function refusalFor(action: PatientAction): string {
  switch (action) {
    case 'register':
      return 'Les inscriptions se prennent avec un soignant, à la réunion du début de semaine. Parlez-lui de cette activité.'
    case 'unregister':
      return 'Pour ne plus venir à une activité, dites-le à un soignant. Il vous retirera de la liste.'
    case 'requestAppointment':
      return 'Les rendez-vous se demandent à un soignant. Il en parlera avec la personne concernée.'
    case 'proposeActivity':
      return 'Les idées d’activité se disent à un soignant pour le moment. La vôtre sera écoutée.'
  }
}

/** Le libellé de l'interrupteur, côté administration. */
export function actionLabel(action: PatientAction): string {
  switch (action) {
    case 'register':
      return 'S’inscrire à une activité'
    case 'unregister':
      return 'Se retirer d’une activité'
    case 'requestAppointment':
      return 'Demander un rendez-vous'
    case 'proposeActivity':
      return 'Proposer une activité'
  }
}

/** Ce que l'administrateur doit savoir avant de fermer : ce qui se passe alors. */
export function actionConsequence(action: PatientAction): string {
  switch (action) {
    case 'register':
      return 'Fermé, les patients voient le programme mais ne s’inscrivent plus eux-mêmes. Les inscriptions se prennent en réunion, comme avant l’application.'
    case 'unregister':
      return 'Fermé, une personne inscrite ne peut plus se retirer seule. Pensez-y : elle devra trouver un soignant pour le faire, et une inscription qu’on ne peut pas défaire décourage de s’inscrire.'
    case 'requestAppointment':
      return 'Fermé, les demandes de rendez-vous se font de vive voix. Celles déjà en attente restent visibles et se traitent normalement.'
    case 'proposeActivity':
      return 'Fermé, le bouton disparaît du calendrier. Les idées déjà déposées restent dans votre file et attendent votre réponse.'
  }
}

/**
 * Le réglage particulier d'une personne, quand il y en a un.
 *
 * Un service fixe une règle générale ; une personne peut demander une exception, dans un
 * sens comme dans l'autre. Quelqu'un qui s'inscrit à tout puis ne vient pas, et à qui
 * l'équipe préfère reparler de vive voix. Quelqu'un à qui l'on ouvre l'inscription en
 * premier, pour essayer, alors que le service attend encore.
 *
 * Un geste absent de cet objet **suit la règle du service**, et continue de la suivre
 * quand elle change. C'est le point qui compte : recopier la règle générale sur chaque
 * personne au moment de créer son compte donnerait quarante réglages figés, et fermer un
 * geste pour le service n'aurait alors aucun effet sur personne.
 */
export type PatientActionOverrides = Partial<Record<PatientAction, boolean>>

/** Lit un réglage particulier venu de la base. Ne retient que les booléens qu'on connaît. */
export function readOverrides(raw: unknown): PatientActionOverrides {
  if (raw === null || typeof raw !== 'object') return {}
  const brut = raw as Record<string, unknown>
  const lues: PatientActionOverrides = {}
  for (const action of PATIENT_ACTIONS) {
    if (typeof brut[action] === 'boolean') lues[action] = brut[action] as boolean
  }
  return lues
}

/**
 * Ce qu'une personne peut faire, tout compte fait : la règle du service, sauf là où un
 * réglage particulier la remplace.
 */
export function effectivePermissions(
  service: PatientPermissions,
  overrides: PatientActionOverrides,
): PatientPermissions {
  const finales = {} as PatientPermissions
  for (const action of PATIENT_ACTIONS) {
    finales[action] = overrides[action] ?? service[action] !== false
  }
  return finales
}

/** Vrai quand cette personne a au moins un réglage qui la distingue du service. */
export function hasOverrides(overrides: PatientActionOverrides): boolean {
  return PATIENT_ACTIONS.some((action) => overrides[action] !== undefined)
}

/**
 * Ce que l'écran écrit sous chaque interrupteur d'une fiche patient : d'où vient la
 * valeur, et si elle suivra le service quand il changera.
 */
export function overrideOrigin(
  action: PatientAction,
  overrides: PatientActionOverrides,
): string {
  const particulier = overrides[action]
  if (particulier === undefined) return 'Comme le service. Suivra le service s’il change.'
  return particulier
    ? 'Ouvert pour cette personne, même si le service ferme ce geste.'
    : 'Fermé pour cette personne, même si le service l’ouvre.'
}

/** Vrai quand tout est ouvert : l'état par défaut, qu'on n'a pas besoin de commenter. */
export function allOpen(permissions: PatientPermissions): boolean {
  return PATIENT_ACTIONS.every((action) => permissions[action] !== false)
}

/** Ce que l'écran d'administration résume en une phrase, sans avoir à tout relire. */
export function permissionsSummary(permissions: PatientPermissions): string {
  const fermes = PATIENT_ACTIONS.filter((action) => permissions[action] === false)
  if (fermes.length === 0) return 'Les patients peuvent tout faire depuis l’application.'
  if (fermes.length === PATIENT_ACTIONS.length) {
    return 'Les patients consultent le programme, sans rien pouvoir faire d’autre depuis l’application.'
  }
  const liste = fermes.map((action) => actionLabel(action).toLocaleLowerCase('fr')).join(', ')
  return fermes.length === 1 ? `Un geste est fermé : ${liste}.` : `${fermes.length} gestes sont fermés : ${liste}.`
}
