/**
 * État de l'espace soignant. Comme pour le patient, ne connaît que les ports.
 */
import { createStaffApp } from './data'
import type {
  NewPatientCode,
  ActivityDraft,
  GenerationReport,
  RosterLine,
  StaffApp,
  StaffIdentity,
  AppointmentPlanning,
  StaffPatient,
  TimeConflict,
} from './data/staffPorts'
import { describeGeneration } from './data/generation'
import type { Account } from './domain/impersonation'
import type { PatientPlanning } from './data/staffPorts'
import type { CatalogKind, CatalogRemoval } from './domain/catalog'
import { store } from './appState.svelte'
import { countsOf, undoToggle, withToggled } from './domain/roster'
import { todayLocalDate, weekDays } from './domain/time'
import { enClair } from './erreurs'
import type {
  Activity,
  Appointment,
  AvailabilityWindow,
  LocalDate,
  LocalTime,
  Occurrence,
} from './domain/types'

const SIGNED_OUT: StaffIdentity = {
  uid: null,
  email: null,
  firstName: null,
  role: null,
  practitionerId: null,
}

class StaffStore {
  /** Chargé à la demande, comme l'adapter patient : voir `data/index.ts`. */
  private readonly loading$: Promise<StaffApp> = createStaffApp()
  private application: StaffApp | null = null

  private async app$(): Promise<StaffApp> {
    if (this.application === null) this.application = await this.loading$
    return this.application
  }

  identity = $state<StaffIdentity>(SIGNED_OUT)
  activities = $state<Activity[]>([])
  occurrences = $state<Occurrence[]>([])
  date = $state<LocalDate>(todayLocalDate())
  /** Les patients, pour la réunion du lundi. Prénom et service uniquement. */
  patients = $state<StaffPatient[]>([])
  /** Demandes de rendez-vous, les plus anciennes d'abord. */
  appointments = $state<Appointment[]>([])
  /** Inscrits de l'activité ouverte pendant la réunion. */
  roster = $state<RosterLine[]>([])
  /**
   * Le service sur lequel le programme est filtré, ou `null` pour tout voir.
   *
   * Il vit ici et non dans un écran : filtrer sur « La Couturelle » puis passer à
   * l'impression doit donner la feuille de La Couturelle, sans avoir à le redire.
   */
  programmeServiceId = $state<string | null>(null)
  /** Message de compte rendu affiché après une action, en français simple. */
  message = $state<string | null>(null)
  /**
   * Un compte rendu appartient à l'écran qui l'a provoqué : il disparaît dès qu'on
   * change d'onglet. Seule exception, une action qui **navigue** après coup — enregistrer
   * une activité renvoie à la semaine, et le message doit y arriver.
   */
  #survitAuProchainChangement = false
  loading = $state(false)
  /**
   * Une relecture est en cours alors que la semaine est déjà à l'écran. On le dit sans
   * rien retirer : un écran vidé et un écran qui se met à jour ne se ressemblent pas.
   */
  rafraichit = $state(false)

  readonly signedIn = $derived(this.identity.role !== null)
  readonly isAdmin = $derived(this.identity.role === 'admin')

  readonly week = $derived(weekDays(this.date))

  readonly today = $derived(
    this.occurrences
      .filter((o) => o.localDate === this.date)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  )

  async signIn(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
    const result = await (await this.app$()).session.signIn(email, password)
    this.identity = (await this.app$()).session.current()
    // Le catalogue n'est lisible qu'une fois connecté : il faut le (re)charger ici.
    // Après connexion, le catalogue devient lisible : il faut le relire, même s'il a
    // déjà été demandé (sans succès) avant l'authentification.
    if (result.ok) {
      /*
        On n'attend que le programme — ce qui s'affiche en premier. Le reste arrive
        derrière, chacun à son rythme : la liste des patients et les rendez-vous passent
        par des fonctions appelables, qui mettent plusieurs secondes quand elles dormaient.
        Les attendre toutes, c'était laisser le bouton « Se connecter » tourner une demi-
        minute pour un écran qui n'en avait besoin d'aucune.
      */
      void store.loadCatalog(true)
      void store.loadAppointmentKinds()
      void this.loadPatients()
      void this.loadAppointments()
      await this.refresh()
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message }
  }

  /** Les comptes auxquels un administrateur peut se substituer, pour vérifier ce qu'ils voient. */
  async listAccounts(): Promise<Account[]> {
    return (await this.app$()).superAdmin.listAccounts()
  }

  /** Ouvre la session de quelqu'un d'autre. La page est rechargée juste après. */
  async impersonate(uid: string) {
    return (await this.app$()).superAdmin.impersonate(uid)
  }

  async signOut(): Promise<void> {
    await (await this.app$()).session.signOut()
    this.identity = (await this.app$()).session.current()
    this.activities = []
    this.occurrences = []
    this.#dejaAffiche = false
  }

  /** Rafraîchit la session au démarrage : Firebase la restaure de façon asynchrone. */
  async restore(): Promise<void> {
    await this.refresh()
    this.identity = (await this.app$()).session.current()
    if (this.identity.role !== null) {
      // Comme à la connexion : rien de tout cela ne doit retenir l'affichage.
      void store.loadCatalog(true)
      void store.loadAppointmentKinds()
      void this.loadPatients()
      void this.loadAppointments()
    }
  }

  /** Numéro de la dernière demande : une réponse plus ancienne n'écrase jamais l'écran. */
  #versionProgramme = 0
  /** Vrai dès qu'une semaine a été affichée une fois. Volontairement non réactif. */
  #dejaAffiche = false

  async refresh(): Promise<void> {
    const version = (this.#versionProgramme += 1)
    /*
      La semaine reste à l'écran pendant qu'on la relit.

      « Chargement… » remplaçait les sept jours à chaque flèche, sur le geste le plus
      fréquent de l'écran principal. On ne vide donc que s'il n'y a rien à garder ; sinon
      la semaine d'avant reste lisible et se remplace à l'arrivée de la nouvelle.
    */
    // Non réactif, comme côté patient : `refresh()` peut être appelé depuis un effet, et
    // y lire un état que l'on modifie ensuite ferait boucler la page. Voir `appState`.
    this.loading = !this.#dejaAffiche
    this.rafraichit = true
    const jours = weekDays(this.date)
    const [activities, occurrences] = await Promise.all([
      (await this.app$()).repository.listActivities().catch(() => []),
      (await this.app$()).repository.listOccurrences(jours[0]!, jours[6]!).catch(() => []),
    ])
    // Une flèche plus récente est partie entre-temps : cette réponse ne vaut plus rien.
    if (version !== this.#versionProgramme) return
    this.activities = activities
    this.occurrences = occurrences
    this.#dejaAffiche = occurrences.length > 0
    /*
      Le programme relu écrasait le nombre d'inscrits de la séance ouverte.

      Pendant la réunion, le compteur du serveur a toujours un train de retard : une
      relecture partie avant un clic revient après lui. On voyait alors quatre prénoms
      cochés et « 3 personnes notées » juste en dessous — deux chiffres pour un même
      fait, dont l'un venait du passé. La liste qu'on a sous les yeux tranche.
    */
    if (this.rosterOf !== null) this.accorderLeCompteur(this.rosterOf, this.roster)
    this.loading = false
    this.rafraichit = false
  }

  async createPatient(firstName: string, serviceId: string): Promise<NewPatientCode> {
    const code = await (await this.app$()).repository.createPatient(firstName, serviceId)
    await this.loadPatients()
    this.message = null
    return code
  }

  async regenerateCode(patientUid: string): Promise<NewPatientCode> {
    const code = await (await this.app$()).repository.regenerateCode(patientUid)
    await this.loadPatients()
    return code
  }

  async endStay(patientUid: string): Promise<void> {
    try {
      const resultat = await (await this.app$()).repository.endStay(patientUid)
      this.message = resultat.message
    } catch (error) {
      // Un refus du serveur doit se lire à l'écran, pas finir dans la console.
      this.message =
        enClair(error)
    }
    await this.loadPatients()
  }

  async loadAppointments(): Promise<void> {
    this.appointments = await (await this.app$()).repository.listAppointments().catch(() => [])
  }

  async scheduleAppointment(
    appointmentId: string,
    rendezVous: {
      date: LocalDate
      time: LocalTime
      durationMin: number
      withWhom: string
      practitionerId?: string
      locationId?: string
    },
  ): Promise<string> {
    const resultat = await (await this.app$()).repository.scheduleAppointment(appointmentId, rendezVous)
    await this.loadAppointments()
    this.message = resultat.message
    return resultat.message
  }

  /** Un rendez-vous fixé d'emblée, pour qui n'a pas fait la demande dans l'application. */
  async createAppointment(rendezVous: {
    patientUid: string
    kindId: string
    date: LocalDate
    time: LocalTime
    durationMin: number
    withWhom: string
    practitionerId?: string
    locationId?: string
  }): Promise<boolean> {
    const resultat = await (await this.app$()).repository.createAppointment(rendezVous)
    await this.loadAppointments()
    this.message = resultat.message
    return resultat.ok
  }

  /**
   * La semaine croisée d'un intervenant et d'un patient, avec un créneau proposé.
   * C'est le serveur qui croise : l'écran ne reçoit que des heures et un état.
   */
  async appointmentPlanning(query: {
    practitionerId: string
    patientUid?: string
    preference?: 'matin' | 'apres-midi' | 'peu-importe'
    durationMin?: number
    from?: LocalDate
  }): Promise<AppointmentPlanning | null> {
    try {
      return await (await this.app$()).repository.appointmentPlanning(query)
    } catch {
      // Un agenda qu'on ne peut pas lire ne doit pas empêcher de fixer un rendez-vous :
      // l'écran continue sans la suggestion, et le soignant choisit son heure.
      return null
    }
  }

  async cancelAppointment(appointmentId: string, reason: string): Promise<void> {
    const resultat = await (await this.app$()).repository.cancelAppointment(appointmentId, reason)
    await this.loadAppointments()
    this.message = resultat.message
  }

  async loadPatients(): Promise<void> {
    this.patients = await (await this.app$()).repository.listPatients().catch(() => [])
  }

  /** Vrai quand la personne connectée a le droit de faire l'appel de l'activité ouverte. */
  canMarkAttendance = $state<boolean>(false)

  /** Réveille la fonction d'inscription, sans rien inscrire. Voir le port. */
  async warmRegistration(): Promise<void> {
    await (await this.app$()).repository.warmRegistration().catch(() => undefined)
  }

  /** Même chose pour l'appel, demandé en ouvrant la feuille de présence. */
  async warmAttendance(): Promise<void> {
    await (await this.app$()).repository.warmAttendance().catch(() => undefined)
  }

  /**
   * Deux compteurs qui protègent l'affichage immédiat des réponses en retard.
   *
   * Une relecture partie avant un clic revient après lui, et rapporte l'état d'avant :
   * le prénom qu'on venait de retirer se remettait tout seul, et le nombre d'inscrits
   * disait autre chose que l'écran. C'est le prix de l'affichage optimiste, et il se
   * paie en ordonnant les réponses plutôt qu'en les appliquant à l'aveugle.
   *
   * `#versionRoster` compte les modifications locales : une réponse préparée sous une
   * version plus ancienne est périmée, on la jette. `#ecrituresEnCours` compte les
   * inscriptions parties et pas encore revenues : tant qu'il en reste, aucune relecture
   * ne fait autorité — le serveur n'a pas fini d'appliquer ce qu'on lui a demandé.
   */
  #versionRoster = 0
  #ecrituresEnCours = 0
  /** L'activité dont la liste est demandée : une réponse pour une autre ne vaut rien. */
  #rosterDe: string | null = null
  /**
   * L'activité dont la liste est effectivement à l'écran, ou `null` quand on n'a pas pu
   * la lire. Elle seule fait foi pour le nombre d'inscrits affiché.
   */
  rosterOf = $state<string | null>(null)
  /**
   * Vrai quand la dernière lecture de la liste a échoué. L'écran doit le dire : une liste
   * vide et une liste illisible se ressemblent, et l'on n'inscrit pas les mêmes gens
   * selon qu'on croit l'une ou l'autre.
   */
  rosterIllisible = $state(false)

  async openRoster(occurrenceId: string): Promise<void> {
    const version = this.#versionRoster
    this.#rosterDe = occurrenceId
    // On change d'activité : les prénoms de la précédente n'ont plus rien à faire là.
    // Une relecture de la même activité, elle, ne vide rien — sinon l'écran clignoterait.
    if (this.rosterOf !== occurrenceId) {
      this.roster = []
      this.rosterOf = null
    }

    /*
      Une lecture qui échoue ne dit pas « personne ». Elle ne dit rien.

      On rendait une liste vide en cas d'erreur : un réseau qui hoquette affichait alors
      « 0 inscrit » sur une activité complète, et l'on réinscrivait tout le monde. On
      garde donc ce qui est à l'écran, et l'on réessaie au prochain passage.
    */
    const resultat = await (await this.app$()).repository.roster(occurrenceId).catch(() => null)

    // Périmée : on a cliqué entre-temps, ou une écriture est encore en route, ou l'on
    // regarde déjà une autre activité. Dans les trois cas, l'écran a raison, pas nous.
    if (version !== this.#versionRoster || this.#ecrituresEnCours > 0) return
    if (this.#rosterDe !== occurrenceId) return
    if (resultat === null) {
      this.rosterIllisible = true
      return
    }

    this.rosterIllisible = false
    this.roster = resultat.lines
    this.canMarkAttendance = resultat.canMarkAttendance
    this.rosterOf = occurrenceId
    this.accorderLeCompteur(occurrenceId, resultat.lines)
  }

  /**
   * Le nombre d'inscrits d'une séance, recompté sur la liste affichée.
   *
   * Un même fait ne doit avoir qu'une source. La liste des prénoms et le compteur de la
   * séance venaient de deux endroits différents, mis à jour à deux moments différents :
   * ils finissaient toujours par se contredire à l'écran, et c'est le genre de
   * contradiction qui fait douter de tout le reste.
   */
  private accorderLeCompteur(occurrenceId: string, lignes: RosterLine[]): void {
    const compte = countsOf(lignes)
    this.occurrences = this.occurrences.map((occurrence) =>
      occurrence.id === occurrenceId ? { ...occurrence, ...compte } : occurrence,
    )
  }

  /**
   * L'appel. Inscrit d'office la personne qui se présente sans l'être.
   *
   * La coche bouge dans le geste, comme le prénom en réunion : on coche dix ou quinze
   * lignes à la suite, et attendre le serveur à chaque fois rendait la feuille plus lente
   * que le papier qu'elle remplace. La vérité revient derrière, et un refus remet cette
   * ligne-là — et elle seule — dans son état d'avant.
   *
   * Le programme de la semaine n'est plus relu : `openRoster` accorde déjà le nombre
   * d'inscrits de la séance, et c'est la seule chose que l'appel puisse changer.
   */
  async markAttendance(
    occurrenceId: string,
    patientUid: string,
    attendance: 'present' | 'absent' | null,
  ): Promise<string> {
    const repository = (await this.app$()).repository
    const avant = this.roster.find((ligne) => ligne.patientUid === patientUid) ?? null
    const rangAvant = this.roster.findIndex((ligne) => ligne.patientUid === patientUid)
    const personne = this.patients.find((p) => p.uid === patientUid)

    // Une personne qui n'était pas sur la liste y entre : c'est le geste « quelqu'un
    // s'est présenté », et il doit se voir tout de suite lui aussi.
    const base: RosterLine = avant ?? {
      patientUid,
      firstName: personne?.firstName ?? 'Cette personne',
      serviceId: personne?.serviceId ?? null,
      status: 'confirmed' as const,
      position: null,
    }
    const { attendance: _sansPresence, ...sansLaCoche } = base
    const apres: RosterLine = attendance === null ? sansLaCoche : { ...base, attendance }

    this.#versionRoster += 1
    this.#ecrituresEnCours += 1
    if (avant === null) this.ajusterCompteur(occurrenceId, 1)
    this.roster = withToggled(this.roster, apres, false)

    let resultat
    try {
      resultat = await repository.markAttendance(occurrenceId, patientUid, attendance)
    } finally {
      this.#ecrituresEnCours -= 1
    }

    if (!resultat.ok) {
      this.#versionRoster += 1
      if (avant === null) this.ajusterCompteur(occurrenceId, -1)
      this.roster = undoToggle(this.roster, patientUid, avant, rangAvant)
    }

    if (this.#ecrituresEnCours === 0) void this.openRoster(occurrenceId)
    return resultat.message
  }

  /**
   * Le nombre d'inscrits affiché suit le clic, comme la liste.
   *
   * Sans cela, l'écran se contredisait : le prénom passait en vert, et « 8 inscrits sur
   * 12 » restait à 8 jusqu'à la relecture. La vraie valeur revient du serveur derrière.
   */
  private ajusterCompteur(occurrenceId: string, delta: number): void {
    this.occurrences = this.occurrences.map((occurrence) =>
      occurrence.id === occurrenceId
        ? { ...occurrence, confirmedCount: Math.max(0, occurrence.confirmedCount + delta) }
        : occurrence,
    )
  }

  isRegistered(patientUid: string): boolean {
    return this.roster.some((ligne) => ligne.patientUid === patientUid)
  }

  /**
   * Le geste de la réunion : on clique sur un prénom, il est inscrit ; on reclique,
   * il est retiré. Rien d'autre à faire — le patient retrouvera l'activité dans son
   * calendrier s'il ouvre l'application.
   */
  /**
   * Inscrire ou désinscrire quelqu'un depuis la réunion.
   *
   * Rend le résultat entier et non le seul message : un chevauchement d'horaire revient
   * du serveur avec la liste de ce qui tombe en même temps, et l'écran doit pouvoir la
   * montrer avant de redemander la même inscription.
   */
  async togglePatient(
    occurrenceId: string,
    patientUid: string,
    /**
     * `overCapacity` : le dépassement du nombre de places est assumé.
     * `overrideConflict` : le chevauchement d'horaire l'est aussi.
     */
    options: { overCapacity?: boolean; overrideConflict?: boolean } = {},
  ): Promise<{ message: string; conflicts?: TimeConflict[] }> {
    const repository = (await this.app$()).repository
    const inscrit = this.isRegistered(patientUid)

    /*
      Le prénom change d'état tout de suite, avant la réponse du serveur.

      L'inscription passe par une fonction appelable — la capacité et la liste d'attente
      se décident dans une transaction, et un navigateur n'a pas le droit d'écrire là.
      Cet aller-retour prend une à deux secondes, parfois plus quand la fonction dormait :
      on cliquait, il ne se passait rien, on recliquait. Autant de doubles inscriptions
      évitées de justesse, et une réunion qui traîne.

      On affiche donc ce qui va se passer, puis on le vérifie. En cas de refus — activité
      complète, rendez-vous à la même heure, réseau coupé — ce prénom-là seul revient
      dans l'état d'avant, et le message dit pourquoi. C'est ce que fait n'importe quelle
      application qui « répond du tac au tac » : elle n'attend pas le serveur pour se
      redessiner.
    */
    const personne = this.patients.find((p) => p.uid === patientUid)
    const ligneAvant = this.roster.find((ligne) => ligne.patientUid === patientUid) ?? null
    // Son rang, pour la remettre à sa place si le serveur refuse.
    const rangAvant = this.roster.findIndex((ligne) => ligne.patientUid === patientUid)
    // Toute modification locale périme les relectures déjà parties.
    this.#versionRoster += 1
    this.#ecrituresEnCours += 1
    this.ajusterCompteur(occurrenceId, inscrit ? -1 : 1)
    this.roster = withToggled(
      this.roster,
      ligneAvant ?? {
        patientUid,
        firstName: personne?.firstName ?? 'Cette personne',
        serviceId: personne?.serviceId ?? null,
        status: 'confirmed' as const,
        position: null,
      },
      inscrit,
    )

    let resultat
    try {
      resultat = inscrit
        ? await repository.unregisterPatient(occurrenceId, patientUid)
        : await repository.registerPatient(occurrenceId, patientUid, options)
    } finally {
      this.#ecrituresEnCours -= 1
    }

    /*
      Refusé : on défait ce prénom-là, et rien d'autre.

      On remettait la liste entière telle qu'elle était avant le clic. Pendant une réunion
      on en clique dix à la suite : la photographie prise avant le premier ne connaissait
      pas les neuf suivants, et un refus arrivé en retard les effaçait tous d'un coup. Ils
      revenaient à la relecture — d'où des prénoms qui se décochaient puis se recochaient
      seuls. Une réponse ne doit jamais défaire un geste qu'elle n'a pas vu.
    */
    if (!resultat.ok) {
      this.#versionRoster += 1
      this.ajusterCompteur(occurrenceId, inscrit ? 1 : -1)
      this.roster = undoToggle(this.roster, patientUid, inscrit ? ligneAvant : null, rangAvant)
    }

    /*
      La vérité vient ensuite, sans faire attendre — mais seulement quand plus rien n'est
      en route. Relire pendant qu'une autre inscription est partie rapporterait un état
      déjà dépassé, et ferait clignoter l'écran.

      Seule la liste est relue. Recharger tout le programme de la semaine à chaque prénom,
      c'était la plus grosse lecture de l'application répétée dix fois en deux minutes —
      pour un chiffre que la liste donne déjà. `openRoster` accorde le compteur au passage.
    */
    if (this.#ecrituresEnCours === 0) void this.openRoster(occurrenceId)
    // La désinscription ne rend jamais de chevauchement : le champ n'existe que sur
    // l'autre chemin, d'où la vérification plutôt qu'un accès direct.
    const conflits = (resultat as { conflicts?: TimeConflict[] }).conflicts
    return { message: resultat.message, ...(conflits === undefined ? {} : { conflicts: conflits }) }
  }

  /** Appelé à chaque changement d'écran par `StaffApp`. */
  clearMessageOnNavigation(): void {
    if (this.#survitAuProchainChangement) {
      this.#survitAuProchainChangement = false
      return
    }
    this.message = null
  }

  activityOf(activityId: string): Activity | null {
    return this.activities.find((a) => a.id === activityId) ?? null
  }

  async getActivity(activityId: string): Promise<Activity | null> {
    return (await this.app$()).repository.getActivity(activityId)
  }

  private report(prefix: string, report: GenerationReport): void {
    this.message = `${prefix} ${describeGeneration(report)}`
    // Le formulaire renvoie ensuite à la semaine ou à la liste : le message suit.
    this.#survitAuProchainChangement = true
  }

  async saveActivity(draft: ActivityDraft): Promise<string> {
    const { activityId, report } = await (await this.app$()).repository.saveActivity(draft)
    await this.refresh()
    this.report('Activité enregistrée.', report)
    return activityId
  }

  /**
   * Mettre au programme, ou en retirer.
   *
   * L'étiquette de l'activité change tout de suite. Le geste demandait jusqu'à cinq
   * allers-retours — écrire, relire, régénérer les séances, puis relire tout le
   * programme — pendant lesquels rien ne bougeait à l'écran et rien n'empêchait de
   * recliquer. Le compte rendu détaillé (« 12 séances créées ») arrive derrière, quand
   * la génération a fini : c'est une information, pas une confirmation.
   */
  async setActive(activityId: string, isActive: boolean): Promise<void> {
    const avant = this.activities.find((a) => a.id === activityId)?.isActive
    this.activities = this.activities.map((a) => (a.id === activityId ? { ...a, isActive } : a))
    this.message = isActive ? 'Activité remise au programme.' : 'Activité retirée du programme.'
    try {
      const report = await (await this.app$()).repository.setActivityActive(activityId, isActive)
      this.report(isActive ? 'Activité remise au programme.' : 'Activité retirée du programme.', report)
    } catch (error) {
      // Refusé : l'étiquette revient à ce qu'elle était, et l'on dit pourquoi.
      if (avant !== undefined) {
        this.activities = this.activities.map((a) => (a.id === activityId ? { ...a, isActive: avant } : a))
      }
      this.message = enClair(error)
      return
    }
    void this.refresh()
  }

  /**
   * Copier une activité. La copie apparaît dans la liste tout de suite.
   *
   * Rien ne bougeait à l'écran pendant trois allers-retours — relire l'activité qu'on
   * avait déjà, écrire la copie, relire tout le programme — et rien n'empêchait de
   * recliquer, donc de créer trois copies.
   */
  async duplicate(activityId: string): Promise<string> {
    const source = this.activityOf(activityId)
    const nouvelId = await (await this.app$()).repository.duplicateActivity(
      activityId,
      ...(source === null ? [] : ([source] as const)),
    )
    if (source !== null) {
      // Telle que le serveur vient de l'écrire : en brouillon, avec sa propre série.
      this.activities = [
        ...this.activities,
        { ...source, id: nouvelId, seriesId: `serie-${nouvelId}`, title: `${source.title} (copie)`, isActive: false },
      ]
    }
    this.message = 'Copie créée. Elle est en brouillon : relisez-la, puis mettez-la au programme.'
    void this.refresh()
    return nouvelId
  }

  /**
   * Annuler une séance, avec son motif. La séance est barrée à l'écran dans le geste.
   *
   * Le panneau du motif se refermait avant d'attendre le serveur : pendant une à deux
   * secondes l'écran était revenu exactement à son état d'avant, comme si le clic n'avait
   * rien fait — et rien n'empêchait de recommencer.
   */
  async cancelOccurrence(occurrenceId: string, reason: string): Promise<void> {
    const avant = this.occurrences.find((o) => o.id === occurrenceId) ?? null
    this.occurrences = this.occurrences.map((o) =>
      o.id === occurrenceId ? { ...o, status: 'cancelled' as const, cancellationReason: reason } : o,
    )
    this.message = 'Séance annulée. Les patients la voient barrée, avec le motif.'
    try {
      await (await this.app$()).repository.cancelOccurrence(occurrenceId, reason)
    } catch (error) {
      if (avant !== null) {
        this.occurrences = this.occurrences.map((o) => (o.id === occurrenceId ? avant : o))
      }
      this.message = enClair(error)
      return
    }
    void this.refresh()
  }

  /** Les plannings de la semaine affichée, pour tout un service. */
  async weekPlannings(serviceId?: string): Promise<PatientPlanning[]> {
    const jours = this.week
    return (await this.app$()).repository.weekPlannings(jours[0]!, jours[6]!, serviceId)
  }

  /** Rétablir une séance annulée. Même principe : elle cesse d'être barrée tout de suite. */
  async restoreOccurrence(occurrenceId: string): Promise<void> {
    const avant = this.occurrences.find((o) => o.id === occurrenceId) ?? null
    this.occurrences = this.occurrences.map((o) => {
      if (o.id !== occurrenceId) return o
      const { cancellationReason: _motif, ...sansMotif } = o
      return { ...sansMotif, status: 'scheduled' as const }
    })
    this.message = 'Séance rétablie.'
    try {
      await (await this.app$()).repository.restoreOccurrence(occurrenceId)
    } catch (error) {
      if (avant !== null) {
        this.occurrences = this.occurrences.map((o) => (o.id === occurrenceId ? avant : o))
      }
      this.message = enClair(error)
      return
    }
    void this.refresh()
  }

  async saveLocation(location: {
    id: string
    name: string
    accessNotes?: string
    building?: string
    isActive: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveLocation(location)
    await store.loadCatalog(true)
    this.message = `Lieu enregistré : ${location.name}.`
  }

  async saveService(service: { id: string; name: string; isActive: boolean }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveService(service)
    await store.loadCatalog(true)
    this.message = `Service enregistré : ${service.name}.`
  }

  /**
   * Retirer une entrée du catalogue. Le serveur décide entre supprimer et retirer des
   * listes selon ce qui l'utilise ; on répète sa phrase telle quelle, elle explique ce
   * qui vient de se passer.
   */
  /** Supprime l'activité, ou la retire du programme si quelqu'un s'y est déjà inscrit. */
  /**
   * `force` supprime tout, inscriptions comprises et sans retour : réservé à ce qui
   * n'aurait jamais dû exister. Sans lui, le serveur retire seulement du programme dès
   * qu'une inscription existe.
   */
  async removeActivity(
    activityId: string,
    options: { force?: boolean } = {},
  ): Promise<CatalogRemoval> {
    const plan = await (await this.app$()).repository.deleteActivity(activityId, options)
    await this.refresh()
    this.message = plan.message
    // Rendu à l'écran : c'est lui qui décide s'il propose d'aller plus loin.
    return plan
  }

  /** Supprime une séance et ses inscriptions. L'activité et les autres semaines restent. */
  async removeOccurrence(occurrenceId: string): Promise<string> {
    const resultat = await (await this.app$()).repository.deleteOccurrence(occurrenceId)
    await this.refresh()
    this.message = resultat.message
    return resultat.message
  }

  async removeCatalogEntry(kind: CatalogKind, id: string): Promise<string[]> {
    const plan = await (await this.app$()).catalogAdmin.removeEntry(kind, id)
    await store.loadCatalog(true)
    this.message = plan.message
    return plan.activityTitles ?? []
  }

  async saveCategory(category: {
    id: string
    name: string
    icon: string
    colorToken: string
    isActive?: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveCategory(category)
    await store.loadCatalog(true)
    this.message = `Catégorie enregistrée : ${category.name}.`
  }

  async createStaffAccount(email: string, practitionerId: string): Promise<string | null> {
    const resultat = await (await this.app$()).catalogAdmin.createStaffAccount(email, practitionerId)
    this.message = resultat.message
    return resultat.password ?? null
  }

  async savePractitioner(practitioner: {
    id: string
    name: string
    role: string
    kindId?: string
    isActive: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.savePractitioner(practitioner)
    await store.loadCatalog(true)
    this.message = `Intervenant enregistré : ${practitioner.name}.`
  }

  async saveAppointmentKind(kind: {
    id: string
    name: string
    icon: string
    isActive: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveAppointmentKind(kind)
    // Les motifs sont chargés une fois pour toutes : après un ajout, il faut les relire.
    await store.loadAppointmentKinds(true)
    this.message = `Motif de rendez-vous enregistré : ${kind.name}.`
  }

  /** Les plages où quelqu'un reçoit. Chacun tient les siennes ; l'administrateur, toutes. */
  async saveAvailability(practitionerId: string, windows: AvailabilityWindow[]): Promise<void> {
    await (await this.app$()).catalogAdmin.saveAvailability(practitionerId, windows)
    await store.loadCatalog(true)
    this.message = 'Disponibilités enregistrées.'
  }

  /**
   * Donne ou retire les droits d'administrateur. La personne devra se reconnecter :
   * c'est le jeton qui porte le rôle, et il ne se réécrit pas à distance.
   */
  async setStaffRole(
    uid: string,
    role: 'staff' | 'admin',
    options: { practitionerId?: string; firstName?: string } = {},
  ): Promise<boolean> {
    const resultat = await (await this.app$()).catalogAdmin.setStaffRole(uid, role, options)
    this.message = resultat.message
    return resultat.ok
  }

  /**
   * L'acceptation automatique des demandes de rendez-vous. Chacun décide pour lui ;
   * l'administrateur peut le faire pour n'importe qui, comme pour les plages.
   */
  async setAutoAccept(practitionerId: string, autoAccept: boolean): Promise<void> {
    await (await this.app$()).catalogAdmin.setAutoAccept(practitionerId, autoAccept)
    await store.loadCatalog(true)
    this.message = autoAccept
      ? 'Les demandes qui vous concernent seront acceptées automatiquement.'
      : 'Vous validerez vous-même chaque demande.'
  }

  /** Le catalogue est partagé avec l'écran patient : mêmes lieux, mêmes catégories. */
  get catalog() {
    return {
      categories: store.categories,
      locations: store.locations,
      services: store.services,
      practitioners: store.practitioners,
    }
  }
}

export const staffStore = new StaffStore()
