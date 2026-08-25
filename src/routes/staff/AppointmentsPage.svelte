<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { proposed } from '../../lib/domain/catalog'
  import {
    PREFERENCE_LABELS,
    appointmentWho,
    kindIcon,
    kindName,
    pastScheduled,
    pendingFirst,
    upcomingScheduled,
    waitingDays,
    waitingLabel,
  } from '../../lib/domain/appointments'
  import {
    appointmentAccessNotice,
    seesEveryAppointment,
  } from '../../lib/domain/appointmentAccess'
  import { availabilityLabel, availabilityWarning } from '../../lib/domain/availability'
  import { leaveWarning } from '../../lib/domain/leave'
  import UnitFilter from './UnitFilter.svelte'
  import { firstBookableDay } from '../../lib/domain/agenda'
  import AppointmentAgenda from './AppointmentAgenda.svelte'
  import { AUTO_DURATION_MIN, AUTO_HORIZON_DAYS } from '../../lib/domain/autoAccept'
  import { enClair } from '../../lib/erreurs'
  import { isoWeekdayOf } from '../../lib/domain/time'
  import {
    addMinutes,
    formatDayLabel,
    formatFullWhen,
    formatTime,
    instantOf,
    todayLocalDate,
  } from '../../lib/domain/time'
  import type { Appointment, LocalDate, LocalTime } from '../../lib/domain/types'

  /**
   * La file des demandes de rendez-vous.
   *
   * Faute de notification, la seule chose qui protège d'un oubli est que l'attente se
   * voie : les demandes les plus anciennes sont en tête, et leur ancienneté est écrite
   * en toutes lettres. Une demande qui traîne doit sauter aux yeux.
   */
  /**
   * Qui regarde. Un intervenant ne voit que son agenda et ne fixe que pour lui-même ;
   * l'administrateur voit tout et répartit les demandes. La règle vit dans le domaine,
   * et les règles Firestore appliquent la même chose sur le jeton — ceci n'accorde que
   * l'interface.
   */
  const moi = $derived({
    role: staffStore.identity.role,
    practitionerId: staffStore.identity.practitionerId,
  })
  const toutVoir = $derived(seesEveryAppointment(moi))
  const avis = $derived(appointmentAccessNotice(moi))
  const monIntervenant = $derived(store.practitionerOf(staffStore.identity.practitionerId ?? ''))
  const sansAgenda = $derived(!toutVoir && staffStore.identity.practitionerId === null)

  const kinds = $derived(store.appointmentKinds)
  /*
    Tout ce qui suit part des rendez-vous **de l'unité** et non de tout l'hôpital.

    Une bulle fixe les rendez-vous de ses patients ; ceux des sept autres unités
    n'allongeaient la file que pour la rendre illisible. Rien n'est retiré à personne :
    la case « Voir toutes les unités » rend l'ensemble, et le compte de ce qui n'est pas
    affiché est écrit en toutes lettres au-dessus.
  */
  const enAttente = $derived(pendingFirst(staffStore.appointmentsOfUnit))
  /**
   * Ce qui est prévu, et ce qui a eu lieu.
   *
   * Les deux étaient mélangés, et la liste s'allongeait sans fin : on y cherchait « ce
   * qui vient » au milieu de ce qui était déjà passé. Le passé ne disparaît pas — un
   * rendez-vous manqué se retrouve — il attend derrière une case à cocher.
   */
  const aVenir = $derived(upcomingScheduled(staffStore.appointmentsOfUnit))
  const passes = $derived(pastScheduled(staffStore.appointmentsOfUnit))
  let voirLePasse = $state(false)

  /** Ce que le filtre par unité laisse de côté, pour pouvoir le dire au lieu de le taire. */
  const ecartes = $derived(staffStore.appointments.length - staffStore.appointmentsOfUnit.length)

  const DUREES = [15, 30, 45, 60]

  /**
   * L'acceptation automatique : chacun la décide pour lui, sur sa propre page.
   *
   * Elle n'a de sens qu'avec des plages déclarées — sans elles, il n'y a aucune place à
   * retenir, et l'écran le dit au lieu de proposer un réglage sans effet.
   */
  const mesPlages = $derived(monIntervenant?.availability ?? [])
  const autoActive = $derived(monIntervenant?.autoAccept === true)
  let bascule = $state(false)
  let erreurReglage = $state<string | null>(null)

  async function basculerAutoAccept(valeur: boolean): Promise<void> {
    const id = staffStore.identity.practitionerId
    if (id === null || bascule) return
    bascule = true
    erreurReglage = null
    try {
      await staffStore.setAutoAccept(id, valeur)
    } catch (error) {
      erreurReglage = enClair(error)
    } finally {
      bascule = false
    }
  }

  let ouvert = $state<string | null>(null)
  /*
    Les deux formulaires s'ouvrent sur demain, pas sur aujourd'hui.

    Un rendez-vous posé dans deux heures est un rendez-vous manqué : personne n'a été
    prévenu, et la personne est peut-être déjà en atelier. Rien n'est interdit — la date
    reste un champ, et l'on écrit aujourd'hui si c'est ce qu'on veut. C'est ce que
    l'application propose d'elle-même qui commence demain, ici comme dans l'agenda croisé.
  */
  let date = $state<LocalDate>(firstBookableDay(todayLocalDate()))
  let heure = $state<LocalTime>('10:00')
  let duree = $state(30)
  let avecQui = $state('')
  /**
   * L'intervenant à qui la demande est confiée.
   *
   * Il manquait : une demande fixée depuis la file n'était reliée à personne, et le
   * rendez-vous n'apparaissait donc dans l'agenda d'aucun professionnel — pas même celui
   * qui devait le tenir.
   */
  let intervenantFile = $state('')
  let lieu = $state('')
  let busy = $state(false)

  const patient = (uid: string) => staffStore.patients.find((p) => p.uid === uid)

  /**
   * Fixer un rendez-vous sans demande préalable.
   *
   * Beaucoup de patients ne se serviront jamais de l'application : ils en parlent à un
   * soignant, qui note. Ne pas le permettre reviendrait à réserver l'agenda à ceux qui
   * ont un téléphone — exactement l'inverse de ce que cette application doit faire.
   */
  let formulaireOuvert = $state(false)
  /**
   * Pour qui. Un patient de l'hôpital, ou une personne extérieure.
   *
   * Certains soignants reçoivent des gens qui ne sont plus hospitalisés — d'anciens
   * patients, le plus souvent. Ces rendez-vous occupent une vraie place dans un agenda,
   * et les tenir hors de l'application, c'est proposer des créneaux déjà pris.
   */
  const EXTERIEURE = 'personne-exterieure'
  let quiUid = $state('')
  let nomExterieur = $state('')
  const pourUnExterieur = $derived(quiUid === EXTERIEURE)
  let quelKind = $state('')
  let dateDirecte = $state<LocalDate>(firstBookableDay(todayLocalDate()))
  let heureDirecte = $state<LocalTime>('10:00')
  let dureeDirecte = $state(30)
  let avecQuiDirecte = $state('')
  let intervenantDirect = $state('')
  let lieuDirecte = $state('')

  // Les personnes sont groupées par service : c'est ainsi qu'un soignant les cherche.
  const patientsParService = $derived(
    proposed(store.services)
      .map((service) => ({
        service,
        patients: staffStore.patientsOfUnit
          .filter((p) => p.serviceId === service.id)
          .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr')),
      }))
      .filter((groupe) => groupe.patients.length > 0),
  )

  /*
    Le motif proposé d'office.

    À un intervenant, le sien : Claire est psychologue, ses rendez-vous sont « Le
    psychologue ». L'écran retirait déjà le menu des intervenants « parce que le
    rendez-vous est le vôtre » ; le motif doit suivre la même logique. Il proposait
    « Le psychiatre » — la première entrée du catalogue — à tout le monde, et le patient
    lisait une phrase qui se contredit : « Le psychiatre … avec Claire ».

    `motifSeme` est un `let` ordinaire, non réactif : le lire et l'écrire dans le même
    effet en ferait une dépendance de cet effet, qui se relancerait aussitôt.
  */
  let motifSeme = false
  /*
    La personne choisie est-elle encore à l'écran ?

    Décocher « Voir toutes les unités » après avoir choisi quelqu'un d'une autre unité
    vidait le menu — plus aucune ligne sélectionnée — mais l'application gardait la
    personne en mémoire : le bouton restait actif, et l'appui créait un vrai rendez-vous
    pour quelqu'un qu'on ne voyait plus, sous un message qui promettait qu'il s'affichait.
  */
  const choisiEstVisible = $derived(
    quiUid === '' ||
      pourUnExterieur ||
      patientsParService.some((groupe) => groupe.patients.some((p) => p.uid === quiUid)),
  )

  /** Le formulaire est complet quand quelqu'un est désigné, d'une façon ou de l'autre. */
  const quelquUnEstDesigne = $derived(
    pourUnExterieur ? nomExterieur.trim().length > 0 : quiUid !== '' && choisiEstVisible,
  )

  $effect(() => {
    if (motifSeme || kinds.length === 0) return
    /*
      On attend le catalogue des intervenants avant de semer.

      Les motifs arrivent en une lecture, les intervenants en quatre : le semis se
      déclenchait donc le plus souvent alors que `monIntervenant` valait encore `null`,
      retombait sur la première entrée du catalogue — « Le psychiatre » — et ne se
      relançait plus jamais, puisqu'il se verrouille au premier passage. Le motif proposé
      d'office n'était le sien qu'une fois sur deux.

      Un compte qui n'est relié à aucun intervenant n'a rien à attendre : pour lui, la
      première entrée est le bon défaut, et l'attendre laisserait le menu vide.
    */
    const lien = staffStore.identity.practitionerId
    if (lien !== null && lien !== undefined && store.practitioners.length === 0) return
    motifSeme = true
    const mien = monIntervenant?.kindId ?? ''
    const propose = kinds.find((k) => k.id === mien) ?? kinds[0]!
    quelKind = propose.id
  })

  /**
   * Les intervenants correspondant au motif viennent en tête : choisir « psychiatre »
   * propose d'abord les psychiatres. Les autres restent proposés — un remplaçant, un
   * intervenant sans motif attitré.
   */
  const intervenantsProposes = $derived(
    [...proposed(store.practitioners)].sort((a, b) => {
      const rang = (i: typeof a) => (i.kindId === quelKind ? 0 : 1)
      return rang(a) - rang(b) || a.name.localeCompare(b.name, 'fr')
    }),
  )

  /*
    Changer de motif propose l'intervenant correspondant.

    Cet effet lisait `intervenantDirect` en même temps qu'il l'écrivait, et c'est le piège
    que le projet a déjà payé trois fois : choisir « Le psychiatre — sans préciser qui »
    remettait la valeur à vide, l'effet se relançait, voyait un champ vide, et reposait le
    psychiatre attitré. L'entrée était affichée et pourtant inatteignable. Symétriquement,
    une fois un intervenant posé, changer de motif ne changeait plus rien — la condition
    `intervenantDirect === ''` n'était jamais vraie.

    Il ne dépend donc plus que du motif, et se souvient de celui qu'il a déjà semé dans un
    `let` ordinaire, non réactif.
  */
  let intervenantSemePour: string | null = null
  $effect(() => {
    // Un intervenant ne choisit pas : le rendez-vous est le sien, forcément.
    if (!toutVoir) {
      intervenantDirect = staffStore.identity.practitionerId ?? ''
      avecQuiDirecte = monIntervenant?.name ?? ''
      return
    }
    const motif = quelKind
    if (motif === '' || motif === intervenantSemePour) return
    /*
      On ne sème pas sur un catalogue vide.

      Au rechargement de la page, l'écran se monte pendant que les lectures partent : le
      motif arrivait avant les intervenants. L'effet marquait alors le motif comme semé
      sans avoir rien trouvé, et ne repassait jamais — le formulaire restait sur « sans
      préciser qui », sans agenda croisé, jusqu'à ce qu'on change de motif à la main.
    */
    if (store.practitioners.length === 0) return
    intervenantSemePour = motif
    const attitre = store.practitioners.find((i) => i.kindId === motif && i.isActive)
    intervenantDirect = attitre?.id ?? ''
    avecQuiDirecte = attitre?.name ?? kinds.find((k) => k.id === motif)?.name ?? ''
  })

  /**
   * Choisir « sans préciser qui » : le nom que le patient lira redevient le motif.
   *
   * Sans cela, le champ gardait « Docteur Lemaire » : le patient lisait ce nom, et le
   * rendez-vous n'entrait dans l'agenda de personne. C'est le nom d'un professionnel
   * promis à quelqu'un qui ne l'attend pas.
   */
  function changerIntervenantDirect(id: string): void {
    intervenantDirect = id
    const choisi = store.practitionerOf(id)
    avecQuiDirecte = choisi?.name ?? kinds.find((k) => k.id === quelKind)?.name ?? ''
  }

  /*
    Annuler un rendez-vous, ou retirer une demande de la file, se confirme.

    Les deux boutons partaient au premier appui, sans nommer ce qui allait disparaître —
    et le patient, lui, n'en saurait rien : les motifs enregistrés étaient faux. « Le
    rendez-vous a été déplacé » alors que rien n'a été déplacé ; « Rendez-vous annulé »
    pour une demande à laquelle aucun rendez-vous n'avait jamais été fixé.
  */
  let annulation = $state<{ id: string; quoi: 'rendez-vous' | 'demande'; qui: string } | null>(null)

  /*
    Le motif est demandé, et il est écrit pour la personne qui le lira.

    Un seul motif était enregistré d'office — « Le rendez-vous n'aura pas lieu » —, qui
    n'apprenait rien : le patient lisait que son rendez-vous était annulé, puis qu'il
    n'aurait pas lieu. Il sait maintenant pourquoi, et c'est la seule chose qui lui
    permette de ne pas croire à un oubli.

    Les motifs courants sont proposés d'un appui, comme pour une séance annulée : taper
    au clavier sur une tablette, entre deux portes, ne se fait pas.

    Ils s'adressent à la personne — « vous », et non « la personne concernée ». C'est elle
    qui les lit, mot pour mot, sur son écran.
  */
  const MOTIFS_RENDEZ_VOUS = [
    'Le professionnel est absent ce jour-là',
    'Un imprévu dans le service',
    'Un autre rendez-vous vous sera proposé',
  ]
  const MOTIFS_DEMANDE = [
    'Un soignant vous en a parlé',
    'Cette demande avait été faite deux fois',
    'Le rendez-vous a été pris autrement',
  ]

  let saisieLibre = $state(false)
  let motifLibre = $state('')

  /** Ouvre la question, en repartant d'un motif vide : celui d'avant ne vaut que pour lui. */
  function demanderAConfirmer(geste: { id: string; quoi: 'rendez-vous' | 'demande'; qui: string }): void {
    annulation = geste
    saisieLibre = false
    motifLibre = ''
  }

  function refermerLaQuestion(): void {
    annulation = null
    saisieLibre = false
    motifLibre = ''
  }

  async function annulerVraiment(motif: string): Promise<void> {
    const geste = annulation
    if (geste === null || busy || motif.trim().length === 0) return
    busy = true
    refermerLaQuestion()
    await staffStore.cancelAppointment(geste.id, motif.trim())
    busy = false
  }

  /** Le même geste, depuis la file des demandes. */
  function changerIntervenantDeLaFile(id: string, kindId: string): void {
    intervenantFile = id
    const choisi = store.practitionerOf(id)
    avecQui = choisi?.name ?? kindName(kinds, kindId)
  }

  /**
   * « Est-il là ? » — la question qu'on se pose au moment de proposer une date, et à
   * laquelle il fallait jusqu'ici répondre de mémoire. L'application n'interdit rien :
   * une urgence se cale hors des plages. Elle prévient, on décide.
   */
  const intervenantChoisi = $derived(store.practitionerOf(intervenantDirect))
  const plagesDe = $derived(intervenantChoisi?.availability ?? [])
  const resumeDesPlages = $derived(availabilityLabel(plagesDe))
  const alerteDirecte = $derived(
    availabilityWarning(plagesDe, isoWeekdayOf(dateDirecte), heureDirecte, dureeDirecte, {
      ...(intervenantChoisi?.name === undefined ? {} : { name: intervenantChoisi.name }),
      isSelf: intervenantDirect !== '' && intervenantDirect === staffStore.identity.practitionerId,
    }),
  )
  /*
    Le congé passe avant la plage.

    Le formulaire ne connaissait que les plages : il écrivait « Docteur Lemaire reçoit :
    mardi de 09h00 à 12h00 » pour un mardi tombant en plein congé — une phrase qui rassure
    au moment où elle devrait alerter. Le rendez-vous s'enregistrait sans réserve, et
    c'est le patient qui l'apprenait devant une porte fermée : exactement ce que les
    congés devaient éviter.
  */
  const congeDirect = $derived(
    leaveWarning(
      staffStore.leavesOf(intervenantDirect),
      dateDirecte,
      intervenantChoisi?.name ?? 'Cette personne',
      intervenantDirect !== '' && intervenantDirect === staffStore.identity.practitionerId,
    ),
  )

  /**
   * L'agenda croisé : ce que l'intervenant annonce, ce qu'il a déjà, ce que le patient a
   * déjà, et le premier créneau qui convienne aux deux.
   *
   * Il est calculé par le serveur, jamais ici : croiser deux agendas depuis le navigateur
   * supposerait de lui donner celui d'un collègue. On ne reçoit que des heures, un état
   * libre ou pris, et une proposition.
   */
  /**
   * Le moment souhaité. Il vient de la demande du patient quand il y en a une ; sinon,
   * c'est le soignant qui le dit — le plus souvent « peu importe ».
   */
  let preferenceSouhaitee = $state<'matin' | 'apres-midi' | 'peu-importe'>('peu-importe')

  /** Le créneau proposé, posé dans le formulaire d'un clic. */
  function poserDansLeFormulaireDirect(localDate: LocalDate, time: LocalTime): void {
    dateDirecte = localDate
    heureDirecte = time
  }

  /** Le même geste, depuis la file des demandes. */
  function poserDansLaFile(localDate: LocalDate, time: LocalTime): void {
    date = localDate
    heure = time
  }

  /** Même question, pour une demande de la file qu'on est en train de fixer. */
  const intervenantDeLaFile = $derived(store.practitionerOf(intervenantFile))
  const alerteFile = $derived(
    availabilityWarning(intervenantDeLaFile?.availability ?? [], isoWeekdayOf(date), heure, duree, {
      ...(intervenantDeLaFile?.name === undefined ? {} : { name: intervenantDeLaFile.name }),
      isSelf: intervenantFile !== '' && intervenantFile === staffStore.identity.practitionerId,
    }),
  )
  const congeDeLaFile = $derived(
    leaveWarning(
      staffStore.leavesOf(intervenantFile),
      date,
      intervenantDeLaFile?.name ?? 'Cette personne',
      intervenantFile !== '' && intervenantFile === staffStore.identity.practitionerId,
    ),
  )

  async function fixerDirectement(): Promise<void> {
    if (busy || !quelquUnEstDesigne || quelKind === '' || avecQuiDirecte.trim().length === 0) return
    // Un rendez-vous daté d'hier ne sera vu par personne : le refuser vaut mieux que
    // d'annoncer « Le patient le voit dans son calendrier ».
    if (dateDirecte < todayLocalDate()) return
    busy = true
    const ok = await staffStore.createAppointment({
      // L'un ou l'autre, jamais les deux : c'est ce que les règles vérifient.
      ...(pourUnExterieur ? { externalName: nomExterieur.trim() } : { patientUid: quiUid }),
      kindId: quelKind,
      date: dateDirecte,
      time: heureDirecte,
      durationMin: dureeDirecte,
      withWhom: avecQuiDirecte.trim(),
      ...(intervenantDirect ? { practitionerId: intervenantDirect } : {}),
      ...(lieuDirecte ? { locationId: lieuDirecte } : {}),
    })
    if (ok) {
      formulaireOuvert = false
      quiUid = ''
      nomExterieur = ''
      lieuDirecte = ''
    }
    busy = false
  }

  function ouvrir(appointmentId: string, kindId: string, demandeId?: string): void {
    ouvert = appointmentId
    date = firstBookableDay(todayLocalDate())
    heure = '10:00'
    duree = 30
    /*
      La personne demandée par le patient l'emporte sur l'attitrée du motif.

      Il a nommé quelqu'un : le remplacer d'office par un collègue, sans le dire, ferait
      exactement le contraire de ce qu'il a demandé. Rien n'est verrouillé pour autant —
      la liste reste ouverte, et il arrive qu'il faille confier la demande à quelqu'un
      d'autre. Mais c'est alors un geste, pas un défaut.

      À défaut de nom, l'attitrée du motif : demander « le psychiatre » désigne le
      psychiatre, sans qu'on ait à le rechercher.
    */
    const choisi = !toutVoir
      ? // Un intervenant ne fixe que pour lui-même : les règles refusent le reste, et
        // proposer autre chose ferait échouer l'enregistrement sans qu'on sache pourquoi.
        (store.practitionerOf(staffStore.identity.practitionerId ?? '') ?? null)
      : ((demandeId === undefined || demandeId === ''
          ? null
          : (store.practitionerOf(demandeId) ?? null)) ??
        store.practitioners.find((i) => i.kindId === kindId && i.isActive) ??
        null)
    intervenantFile = choisi?.id ?? ''
    avecQui = choisi?.name ?? kindName(kinds, kindId)
    lieu = ''
  }

  async function fixer(appointmentId: string): Promise<void> {
    if (busy || avecQui.trim().length === 0) return
    if (date < todayLocalDate()) return
    busy = true
    await staffStore.scheduleAppointment(appointmentId, {
      date,
      time: heure,
      durationMin: duree,
      withWhom: avecQui.trim(),
      ...(intervenantFile ? { practitionerId: intervenantFile } : {}),
      ...(lieu ? { locationId: lieu } : {}),
    })
    ouvert = null
    busy = false
  }

  /*
    « min-w-0 » et « max-w-full » ne sont pas décoratifs.

    Sur iPhone, un champ « date » ou « heure » réclame une largeur intrinsèque supérieure
    à sa colonne ; sans cela il pousse la grille, et tout le formulaire déborde du cadre
    vers la droite. Un élément de grille a « min-width: auto » par défaut : il refuse de
    rétrécir sous son contenu tant qu'on ne le lui permet pas.
  */
  const champ =
    'w-full min-w-0 max-w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">
    {toutVoir ? 'Demandes de rendez-vous' : 'Mes rendez-vous'}
  </h1>
  <p class="mb-4 text-lg text-ink-soft">
    {toutVoir
      ? 'Les demandes les plus anciennes sont en tête. Consultez l’agenda, fixez la date, puis dites-le au patient : il le verra aussi dans son application.'
      : 'Vous fixez la date, puis vous le dites au patient : il le verra aussi dans son application.'}
  </p>

  {#if avis !== null}
    <p role="status" class="mb-5 rounded-xl bg-surface-soft p-3 text-lg text-ink">
      <span aria-hidden="true">🔒</span> {avis}
    </p>
  {/if}

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <!-- L'unité de rattachement du compte, et de quoi en sortir. -->
  <UnitFilter hidden={ecartes} singulier="demande" pluriel="demandes" />

  {#if monIntervenant !== null && monIntervenant !== undefined}
    <!--
      Le réglage personnel. Il vit ici, sur la page des rendez-vous, parce que c'est ici
      qu'on se pose la question — pas dans un écran de paramètres qu'on n'ouvre jamais.
    -->
    <section class="card mb-6 p-4">
      <h2 class="mb-1 text-2xl font-bold text-ink">Vos demandes de rendez-vous</h2>
      <p class="mb-3 text-lg text-ink-soft">
        Quand quelqu'un demande à vous voir, faut-il attendre que vous fixiez la date, ou
        peut-on retenir tout de suite la première place libre dans vos disponibilités ?
      </p>

      {#if erreurReglage !== null}
        <p role="alert" class="mb-3 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
          <span aria-hidden="true">⚠️</span> {erreurReglage}
        </p>
      {/if}

      {#if mesPlages.length === 0}
        <p role="status" class="rounded-xl bg-surface-soft p-3 text-lg text-ink">
          <span aria-hidden="true">🗓️</span>
          Vous n'avez déclaré aucune plage de disponibilité. Sans elles, il n'y a pas de
          place à retenir : les demandes continueront d'attendre votre réponse. Vos plages
          se déclarent dans « Le personnel », sur votre fiche.
        </p>
      {:else}
        <fieldset class="grid gap-2">
          <legend class="sr-only">Traitement des demandes qui vous concernent</legend>
          <label class="choix" class:choisi={!autoActive}>
            <input
              type="radio"
              name="acceptation"
              checked={!autoActive}
              disabled={bascule}
              onchange={() => basculerAutoAccept(false)}
            />
            <span>
              <strong>Je réponds moi-même à chaque demande.</strong>
              Elle attend dans la file jusqu'à ce que vous fixiez la date.
            </span>
          </label>
          <label class="choix" class:choisi={autoActive}>
            <input
              type="radio"
              name="acceptation"
              checked={autoActive}
              disabled={bascule}
              onchange={() => basculerAutoAccept(true)}
            />
            <span>
              <strong>La première place libre est retenue tout de suite.</strong>
              Un rendez-vous de {AUTO_DURATION_MIN} minutes, dans vos plages, à partir de
              demain et dans les {AUTO_HORIZON_DAYS} jours qui suivent. Le patient sait
              immédiatement quand il vous voit ; vous pouvez toujours le déplacer ou
              l'annuler.
            </span>
          </label>
        </fieldset>

        <p class="mt-3 text-base text-ink-soft">
          <span aria-hidden="true">🗓️</span>
          Vos disponibilités : {availabilityLabel(mesPlages)}.
        </p>
      {/if}
    </section>
  {/if}

  <!--
    Avant la file : c'est le geste le plus courant. La plupart des rendez-vous seront
    demandés de vive voix, pas par l'application.
  -->
  {#if sansAgenda}
    <!-- Sans lien vers une personne du personnel, il n'y a ni agenda ni rendez-vous à fixer. -->
  {:else if !formulaireOuvert}
    <button type="button" class="btn btn-primary mb-6" onclick={() => (formulaireOuvert = true)}>
      <span aria-hidden="true">＋</span> Fixer un rendez-vous
    </button>
  {:else}
    <form
      class="card mb-6 p-4"
      onsubmit={(event) => {
        event.preventDefault()
        void fixerDirectement()
      }}
    >
      <h2 class="mb-1 text-2xl font-bold text-ink">Fixer un rendez-vous</h2>
      <p class="mb-3 text-lg text-ink-soft">
        Pour une personne qui vous l'a demandé de vive voix. Elle n'a rien à faire dans
        l'application : le rendez-vous apparaîtra dans son calendrier.
      </p>

      <label for="qui" class="mb-2 block text-lg font-semibold text-ink">Pour qui</label>
      <select id="qui" bind:value={quiUid} class={champ} style="min-height: 56px;">
        <option value="">Choisissez une personne</option>
        {#each patientsParService as groupe (groupe.service.id)}
          <optgroup label={groupe.service.name}>
            {#each groupe.patients as personne (personne.uid)}
              <option value={personne.uid}>{personne.firstName}</option>
            {/each}
          </optgroup>
        {/each}
        <!--
          En dernier, et dans son propre groupe : c'est le cas rare, et le confondre avec
          la liste des patients ferait chercher un prénom qui n'y est pas.
        -->
        <optgroup label="Hors de l'hôpital">
          <option value={EXTERIEURE}>Une personne extérieure à l'hôpital</option>
        </optgroup>
      </select>

      {#if !choisiEstVisible}
        <!--
          La personne choisie n'est plus dans la liste : elle appartient à une autre unité
          et la case vient d'être décochée. Le menu se vidait en silence pendant que
          l'application gardait le choix ; l'écran le dit, et le bouton se désactive.
        -->
        <p role="status" class="mt-3 rounded-xl bg-surface-soft p-3 text-lg font-semibold text-ink">
          <span aria-hidden="true">⚠️</span>
          La personne choisie appartient à une autre unité et n'est plus dans la liste.
          Cochez « Voir toutes les unités » pour la retrouver, ou choisissez quelqu'un d'autre.
        </p>
      {/if}

      {#if pourUnExterieur}
        <label for="nom-exterieur" class="mt-4 mb-2 block text-lg font-semibold text-ink">
          Son prénom
        </label>
        <input
          id="nom-exterieur"
          bind:value={nomExterieur}
          class={champ}
          style="min-height: 56px;"
          autocomplete="off"
          maxlength="60"
        />
        <!--
          Le même garde-fou que pour un patient d'ici, dont l'application n'enregistre
          jamais que le prénom. Il est écrit, et pas seulement respecté par le code : un
          champ libre finit par recevoir ce qu'on n'a pas dit de ne pas y mettre.
        -->
        <p class="mt-1 text-base text-ink-soft">
          Un prénom suffit. N'écrivez ni nom de famille, ni adresse, ni raison du
          rendez-vous. Cette personne n'a pas l'application : c'est vous qui la prévenez.
        </p>
      {/if}

      <label for="motif" class="mt-4 mb-2 block text-lg font-semibold text-ink">
        {toutVoir ? 'Avec quel professionnel' : 'À quel titre'}
      </label>
      <select id="motif" bind:value={quelKind} class={champ} style="min-height: 56px;">
        {#each kinds as genre (genre.id)}
          <option value={genre.id}>{genre.icon} {genre.name}</option>
        {/each}
      </select>

      <div class="mt-4 grid gap-4 sm:grid-cols-3">
        <div class="min-w-0">
          <label for="jour" class="mb-2 block text-lg font-semibold text-ink">Le jour</label>
          <!--
            `min` sur aujourd'hui : un rendez-vous daté d'hier s'enregistrait sans un mot,
            et l'écran annonçait « Le patient le voit dans son calendrier ». Le navigateur
            refuse la saisie ; la phrase juste en dessous dit pourquoi si elle passe.
          -->
          <input
            id="jour"
            type="date"
            min={todayLocalDate()}
            bind:value={dateDirecte}
            class={champ}
            style="min-height: 56px;"
          />
          {#if dateDirecte < todayLocalDate()}
            <p class="mt-1 text-base font-semibold text-ink">
              <span aria-hidden="true">⚠️</span>
              Ce jour est passé. Choisissez aujourd'hui ou un jour à venir.
            </p>
          {/if}
        </div>
        <div class="min-w-0">
          <label for="quand" class="mb-2 block text-lg font-semibold text-ink">À quelle heure</label>
          <input id="quand" type="time" bind:value={heureDirecte} class={champ} style="min-height: 56px;" />
        </div>
        <div class="min-w-0">
          <label for="combien" class="mb-2 block text-lg font-semibold text-ink">Combien de temps</label>
          <select id="combien" bind:value={dureeDirecte} class={champ} style="min-height: 56px;">
            {#each DUREES as minutes (minutes)}
              <option value={minutes}>{minutes} minutes</option>
            {/each}
          </select>
        </div>
      </div>

      {#if toutVoir}
        <label for="nom" class="mt-4 mb-2 block text-lg font-semibold text-ink">
          Quel intervenant — le patient lira son nom
        </label>
        <select
          id="nom"
          class={champ}
          style="min-height: 56px;"
          value={intervenantDirect}
          onchange={(event) => changerIntervenantDirect(event.currentTarget.value)}
        >
          <option value="">{kindName(kinds, quelKind)} — sans préciser qui</option>
          {#each intervenantsProposes as intervenant (intervenant.id)}
            <option value={intervenant.id}>{intervenant.name} — {intervenant.role}</option>
          {/each}
        </select>
      {:else}
        <!-- Pas de menu : le rendez-vous est le vôtre. On le dit, on ne le fait pas deviner. -->
        <p class="mt-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
          <span aria-hidden="true">👤</span>
          Ce rendez-vous sera à votre nom : <strong>{monIntervenant?.name ?? 'vous'}</strong>.
          C'est ce que le patient lira.
        </p>
      {/if}

      {#if resumeDesPlages !== ''}
        <p class="mt-3 rounded-xl bg-surface-soft p-3 text-lg text-ink">
          <span aria-hidden="true">🗓️</span>
          {intervenantChoisi?.name ?? 'Cette personne'} reçoit : {resumeDesPlages}.
        </p>
      {/if}

      <!--
        Le moment souhaité, quand le patient l'a dit de vive voix. Il ne sert qu'à la
        proposition : rien n'empêche de choisir une autre heure ensuite.
      -->
      <fieldset class="mt-4">
        <legend class="mb-2 text-lg font-semibold text-ink">Moment souhaité</legend>
        <div class="flex flex-wrap gap-2">
          <!--
            Le choix retenu porte une coche, et non la seule teinte du bouton :
            « information portée par la couleur seule » est un critère de refus en revue.
          -->
          {#each [['peu-importe', 'Peu importe'], ['matin', 'Le matin'], ['apres-midi', "L'après-midi"]] as [valeur, libelle] (valeur)}
            <button
              type="button"
              class="btn"
              class:btn-primary={preferenceSouhaitee === valeur}
              class:btn-secondary={preferenceSouhaitee !== valeur}
              aria-pressed={preferenceSouhaitee === valeur}
              onclick={() => (preferenceSouhaitee = valeur as typeof preferenceSouhaitee)}
            >
              <span aria-hidden="true">{preferenceSouhaitee === valeur ? '✓' : '·'}</span>
              {libelle}
            </button>
          {/each}
        </div>
      </fieldset>

      <AppointmentAgenda
        practitionerId={intervenantDirect}
        patientUid={pourUnExterieur ? '' : quiUid}
        preference={preferenceSouhaitee}
        durationMin={dureeDirecte}
        practitionerName={intervenantChoisi?.name ?? 'la personne'}
        patientFirstName={pourUnExterieur || quiUid === '' ? '' : (patient(quiUid)?.firstName ?? '')}
        validationLabel="Enregistrer ce rendez-vous"
        onchoisir={poserDansLeFormulaireDirect}
      />
      {#if congeDirect !== null}
        <p role="status" class="mt-3 rounded-xl bg-amber-50 p-3 text-lg font-semibold text-ink">
          <span aria-hidden="true">🌴</span> {congeDirect}
        </p>
      {/if}
      {#if alerteDirecte !== null}
        <p role="status" class="mt-3 rounded-xl bg-amber-50 p-3 text-lg font-semibold text-ink">
          <span aria-hidden="true">⚠️</span> {alerteDirecte}
        </p>
      {/if}

      <label for="ou" class="mt-4 mb-2 block text-lg font-semibold text-ink">Où — facultatif</label>
      <select id="ou" bind:value={lieuDirecte} class={champ} style="min-height: 56px;">
        <option value="">Non précisé</option>
        {#each proposed(store.locations) as endroit (endroit.id)}
          <option value={endroit.id}>{endroit.name}</option>
        {/each}
      </select>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          class="btn btn-primary"
          disabled={busy ||
            !quelquUnEstDesigne ||
            avecQuiDirecte.trim().length === 0 ||
            dateDirecte < todayLocalDate()}
        >
          {busy ? 'Un instant…' : 'Enregistrer ce rendez-vous'}
        </button>
        <button type="button" class="btn btn-secondary" onclick={() => (formulaireOuvert = false)}>
          Annuler
        </button>
      </div>
    </form>
  {/if}

  <!--
    La file, pour l'administrateur comme pour l'intervenant.

    Elle était réservée à l'administrateur, et c'était juste tant qu'une demande ne
    nommait personne : un intervenant n'avait rien à y voir. Depuis que le patient peut
    demander quelqu'un en particulier, la demande porte un nom dès le départ — et la
    personne nommée doit pouvoir fixer elle-même, sans attendre la bulle.

    Le compteur du menu, lui, comptait déjà ces demandes : il annonçait « 1 » devant un
    écran qui n'en montrait aucune. Un compteur qui fait chercher ce qui n'est pas
    affiché est pire que pas de compteur du tout.

    Il n'y a rien à filtrer ici : un intervenant ne reçoit que les rendez-vous qui
    portent son identifiant — les règles le disent, et la requête aussi.
  -->
  <h2 class="mb-3 text-2xl font-bold text-ink">
    {toutVoir ? 'En attente' : 'Demandes qui vous attendent'}
    {enAttente.length > 0 ? `(${enAttente.length})` : ''}
  </h2>

  {#if enAttente.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      {toutVoir
        ? 'Aucune demande en attente.'
        : 'Aucune demande ne vous attend. Quand quelqu’un demandera à vous voir, la demande apparaîtra ici.'}
    </p>
  {:else}
    <ul class="grid gap-4">
      {#each enAttente as demande (demande.id)}
        {@const jours = waitingDays(demande)}
        {@const personne = demande.patientUid === undefined ? undefined : patient(demande.patientUid)}
        <li class="card p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-xl font-bold text-ink">
              <span aria-hidden="true">{kindIcon(kinds, demande.kindId)}</span>
              {appointmentWho(demande, (uid) => patient(uid)?.firstName)} — {kindName(kinds, demande.kindId)}
            </h3>
            <!-- L'attente est doublée d'un mot : jamais la couleur seule. -->
            <span class="badge" class:font-bold={jours >= 3} style="background: var(--color-surface-soft); color: var(--color-ink);">
              {#if jours >= 3}<span aria-hidden="true">⏳</span>{/if}
              {waitingLabel(jours)}
            </span>
          </div>

          <p class="text-base text-ink-soft">
            {store.serviceOf(personne?.serviceId ?? null)?.name ?? 'Service inconnu'}
            · {PREFERENCE_LABELS[demande.preference]}
          </p>

          <!--
            Le nom demandé, quand le patient en a donné un. Écrit noir sur blanc : c'est
            une information qui change la réponse, et la découvrir une fois le rendez-vous
            fixé serait le découvrir trop tard.
          -->
          {#if demande.practitionerId !== undefined}
            <p class="text-base font-semibold text-ink">
              <span aria-hidden="true">🙋</span>
              A demandé à voir {store.practitionerOf(demande.practitionerId)?.name ?? 'quelqu’un en particulier'}.
            </p>
          {/if}

          {#if ouvert === demande.id}
            <div class="mt-3 rounded-xl border-2 border-line p-4">
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="min-w-0">
                  <label for="date" class="mb-2 block text-lg font-semibold text-ink">Date</label>
                  <input
                    id="date"
                    type="date"
                    min={todayLocalDate()}
                    bind:value={date}
                    class={champ}
                    style="min-height: 56px;"
                  />
                  {#if date < todayLocalDate()}
                    <p class="mt-1 text-base font-semibold text-ink">
                      <span aria-hidden="true">⚠️</span>
                      Ce jour est passé. Choisissez aujourd'hui ou un jour à venir.
                    </p>
                  {/if}
                </div>
                <div class="min-w-0">
                  <label for="heure" class="mb-2 block text-lg font-semibold text-ink">Heure</label>
                  <input id="heure" type="time" bind:value={heure} class={champ} style="min-height: 56px;" />
                </div>
                <div class="min-w-0">
                  <label for="duree" class="mb-2 block text-lg font-semibold text-ink">Durée</label>
                  <select id="duree" bind:value={duree} class={champ} style="min-height: 56px;">
                    {#each DUREES as minutes (minutes)}
                      <option value={minutes}>{minutes} minutes</option>
                    {/each}
                  </select>
                </div>
                <div class="min-w-0">
                  <label for="avecqui" class="mb-2 block text-lg font-semibold text-ink">
                    Avec qui — le patient lira ce nom
                  </label>
                  <input id="avecqui" bind:value={avecQui} class={champ} style="min-height: 56px;" />
                </div>
              </div>

              <!--
                Répartir est le geste de la bulle. Un intervenant, lui, fixe pour
                lui-même : les règles refusent qu'il attribue à un collègue le rendez-vous
                qui porte son nom, et proposer la liste reviendrait à annoncer une porte
                que le serveur referme. La phrase dit ce qui va se passer, à la place.
              -->
              {#if toutVoir}
                <label for="quel-intervenant" class="mt-4 mb-2 block text-lg font-semibold text-ink">
                  Quel intervenant — c'est ce qui met le rendez-vous dans son agenda
                </label>
                <select
                  id="quel-intervenant"
                  class={champ}
                  style="min-height: 56px;"
                  value={intervenantFile}
                  onchange={(event) =>
                    changerIntervenantDeLaFile(event.currentTarget.value, demande.kindId)}
                >
                  <!--
                    « Sans préciser qui » : le patient lira le motif, et non le nom d'un
                    professionnel qui ne l'attend pas. Le champ « Avec qui » suit.
                  -->
                  <option value="">{kindName(kinds, demande.kindId)} — sans préciser qui</option>
                  {#each proposed(store.practitioners) as intervenant (intervenant.id)}
                    <option value={intervenant.id}>{intervenant.name} — {intervenant.role}</option>
                  {/each}
                </select>
              {:else}
                <p class="mt-4 text-lg text-ink">
                  <span aria-hidden="true">🩺</span>
                  Ce rendez-vous ira dans votre agenda. Pour le confier à quelqu'un d'autre,
                  demandez à un administrateur.
                </p>
              {/if}

              {#if availabilityLabel(intervenantDeLaFile?.availability ?? []) !== ''}
                <p class="mt-3 rounded-xl bg-surface-soft p-3 text-lg text-ink">
                  <span aria-hidden="true">🗓️</span>
                  {intervenantDeLaFile?.name} reçoit :
                  {availabilityLabel(intervenantDeLaFile?.availability ?? [])}.
                </p>
              {/if}

              <!--
                Le même agenda croisé que pour un rendez-vous fixé sans demande. Ici, le
                moment souhaité n'est pas à choisir : la personne l'a déjà dit en faisant
                sa demande, et c'est lui qui guide la proposition.
              -->
              <AppointmentAgenda
                practitionerId={intervenantFile}
                patientUid={demande.patientUid}
                preference={demande.preference}
                durationMin={duree}
                practitionerName={intervenantDeLaFile?.name ?? 'la personne'}
                patientFirstName={personne?.firstName ?? ''}
                validationLabel="Fixer le rendez-vous"
                onchoisir={poserDansLaFile}
              />

              {#if congeDeLaFile !== null}
                <p role="status" class="mt-3 rounded-xl bg-amber-50 p-3 text-lg font-semibold text-ink">
                  <span aria-hidden="true">🌴</span> {congeDeLaFile}
                </p>
              {/if}
              {#if alerteFile !== null}
                <p role="status" class="mt-3 rounded-xl bg-amber-50 p-3 text-lg font-semibold text-ink">
                  <span aria-hidden="true">⚠️</span> {alerteFile}
                </p>
              {/if}

              <label for="lieu" class="mt-4 mb-2 block text-lg font-semibold text-ink">Où — facultatif</label>
              <select id="lieu" bind:value={lieu} class={champ} style="min-height: 56px;">
                <option value="">Non précisé</option>
                {#each proposed(store.locations) as l (l.id)}
                  <option value={l.id}>{l.name}</option>
                {/each}
              </select>

              <div class="mt-4 flex flex-wrap gap-2">
                <!--
                  Désactivé plutôt que muet : le bouton restait actif et chaque appui ne
                  produisait rien — ni enregistrement, ni message, ni champ signalé. On
                  appuyait trois fois avant de chercher ailleurs. La phrase juste en
                  dessous dit ce qui manque.
                -->
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy || avecQui.trim().length === 0 || date < todayLocalDate()}
                  onclick={() => fixer(demande.id)}
                >
                  Fixer le rendez-vous
                </button>
                <button type="button" class="btn btn-secondary" onclick={() => (ouvert = null)}>Annuler</button>
              </div>
              {#if avecQui.trim().length === 0}
                <p class="mt-2 text-base font-semibold text-ink">
                  <span aria-hidden="true">⚠️</span>
                  Écrivez le nom que le patient lira dans « Avec qui », plus haut.
                </p>
              {/if}
            </div>
          {:else}
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn btn-primary" onclick={() => ouvrir(demande.id, demande.kindId, demande.practitionerId)}>
                Fixer le rendez-vous
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                onclick={() =>
                  demanderAConfirmer({
                    id: demande.id,
                    quoi: 'demande',
                    qui: appointmentWho(demande, (uid) => patient(uid)?.firstName),
                  })}
              >
                Retirer de la file
              </button>
            </div>
            {#if annulation !== null && annulation.id === demande.id}
              {@render question()}
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!--
    La question posée avant d'annuler. Elle nomme la personne, dit ce qu'elle lira, et
    laisse revenir en arrière : les deux boutons partaient jusqu'ici au premier appui.
  -->
  {#snippet question()}
    {#if annulation !== null}
      {@const rendezVous = annulation.quoi === 'rendez-vous'}
      {@const motifs = rendezVous ? MOTIFS_RENDEZ_VOUS : MOTIFS_DEMANDE}
      <div class="mt-3 rounded-xl border-2 border-line p-4">
        <p class="text-lg text-ink">
          {#if rendezVous}
            Annuler le rendez-vous de {annulation.qui} ? Il restera visible sur son écran,
            barré, avec le motif que vous choisissez ci-dessous.
          {:else}
            Retirer la demande de {annulation.qui} de la file ? Aucun rendez-vous n'avait
            été fixé ; cette personne lira le motif que vous choisissez ci-dessous.
          {/if}
        </p>

        <!--
          Le motif d'abord, le geste ensuite — un appui fait les deux.

          C'est la forme du bouton « Annuler cette séance », et pour la même raison : sur
          une tablette, entre deux portes, on ne tape pas au clavier. Un motif écrit à la
          main reste possible, et c'est là que la mise en garde compte.
        -->
        <p class="mt-3 text-base font-semibold text-ink" id={`motif-titre-${annulation.id}`}>
          Pourquoi ? {annulation.qui} lira cette phrase.
        </p>
        <div
          class="mt-2 flex flex-col gap-2"
          role="group"
          aria-labelledby={`motif-titre-${annulation.id}`}
        >
          {#each motifs as motif (motif)}
            <button
              type="button"
              class="btn btn-secondary w-full"
              disabled={busy}
              onclick={() => annulerVraiment(motif)}
            >
              {busy ? 'Un instant…' : motif}
            </button>
          {/each}

          {#if saisieLibre}
            <!--
              La mise en garde est ici, au bord du seul champ libre de cet écran : ce
              texte part tel quel sur l'écran du patient. La règle du projet est sans
              exception — aucune donnée de santé.
            -->
            <label class="mt-1 text-base font-semibold text-ink" for={`motif-${annulation.id}`}>
              Autre motif — {annulation.qui} le lira. N'écrivez rien qui touche à sa santé.
            </label>
            <input
              id={`motif-${annulation.id}`}
              bind:value={motifLibre}
              maxlength={120}
              autocomplete="off"
              class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
              style="min-height: 56px;"
            />
            <button
              type="button"
              class="btn btn-primary w-full"
              disabled={busy || motifLibre.trim().length === 0}
              onclick={() => annulerVraiment(motifLibre)}
            >
              {busy ? 'Un instant…' : rendezVous ? 'Annuler le rendez-vous' : 'Retirer la demande'}
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-secondary w-full"
              onclick={() => (saisieLibre = true)}
            >
              Autre motif…
            </button>
          {/if}

          <button type="button" class="btn btn-secondary w-full" onclick={refermerLaQuestion}>
            Revenir en arrière
          </button>
        </div>
      </div>
    {/if}
  {/snippet}

  <!--
    Une seule ligne, écrite une fois, servie aux deux listes. Le bouton « Annuler » ne
    suit pas dans le passé : proposer d'annuler ce qui a déjà eu lieu n'a pas de sens, et
    le motif enregistré serait faux.
  -->
  {#snippet ligne(rendezVous: Appointment, annulable: boolean)}
    <li class="card p-4">
      <p class="text-lg font-bold text-ink">
        <span aria-hidden="true">{kindIcon(kinds, rendezVous.kindId)}</span>
        {appointmentWho(rendezVous, (uid) => patient(uid)?.firstName)} — {rendezVous.withWhom}
      </p>
      {#if rendezVous.localDate && rendezVous.start && rendezVous.end}
        <p class="text-base text-ink">
          {formatFullWhen(rendezVous.localDate, rendezVous.start, rendezVous.end)}
          {#if rendezVous.locationId}· {store.locationOf(rendezVous.locationId)?.name}{/if}
        </p>
      {/if}
      {#if rendezVous.autoAccepted === true}
        <!--
          Personne n'a posé ce rendez-vous à la main : il faut que cela se lise, sans
          quoi on se demanderait qui l'a mis là. C'est aussi la façon la plus simple
          de repérer que le réglage fait ce qu'on croit.
        -->
        <p class="text-base font-semibold text-ink-soft">
          <span aria-hidden="true">⚡</span> Fixé automatiquement, à la demande du patient
        </p>
      {/if}
      {#if annulable}
        <button
          type="button"
          class="btn btn-secondary mt-2"
          onclick={() =>
            demanderAConfirmer({
              id: rendezVous.id,
              quoi: 'rendez-vous',
              qui: appointmentWho(rendezVous, (uid) => patient(uid)?.firstName),
            })}
        >
          Annuler ce rendez-vous
        </button>
      {/if}
      {#if annulation !== null && annulation.id === rendezVous.id}
        {@render question()}
      {/if}
    </li>
  {/snippet}

  <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">
    {toutVoir ? 'Rendez-vous à venir' : 'Mes rendez-vous à venir'}
  </h2>
  {#if aVenir.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      {toutVoir
        ? 'Aucun rendez-vous à venir pour le moment.'
        : 'Aucun rendez-vous à venir à votre nom.'}
    </p>
  {:else}
    <ul class="grid gap-3">
      <!--
        La clef est l'identifiant du rendez-vous, et non son rang.

        Sur le rang, la ligne dont le formulaire est ouvert changeait de rendez-vous dès
        qu'une autre était fixée au-dessus : l'agenda affiché n'était plus celui de la
        personne qu'on lisait. Un identifiant en double arrêterait le rendu — mais ces
        listes viennent d'une lecture unique, où chaque rendez-vous ne figure qu'une fois.
      -->
      {#each aVenir as rendezVous (rendezVous.id)}
        {@render ligne(rendezVous, true)}
      {/each}
    </ul>
  {/if}

  <!--
    Le passé reste consultable, mais il ne s'impose pas. Le nombre est écrit sur la case :
    on sait ce qu'on va ouvrir avant de l'ouvrir.
  -->
  {#if passes.length > 0}
    <label class="mt-4 flex items-center gap-3" style="min-height: 56px;">
      <input type="checkbox" class="h-6 w-6" bind:checked={voirLePasse} />
      <span class="text-lg text-ink">
        Voir aussi les rendez-vous passés ({passes.length})
      </span>
    </label>

    {#if voirLePasse}
      <ul class="mt-2 grid gap-3">
        {#each passes as rendezVous (rendezVous.id)}
          {@render ligne(rendezVous, false)}
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  /*
    Un choix se prend au doigt, pas à la loupe : toute la ligne est cliquable, le point
    de sélection est grand, et le choix retenu est doublé d'un cadre épais — jamais la
    couleur seule.
  */
  .choix {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    min-height: 56px;
    padding: 0.9rem 1rem;
    border: 2px solid var(--color-line);
    border-radius: 0.85rem;
    background: var(--color-surface);
    font-size: 1.0625rem;
    line-height: 1.45;
    color: var(--color-ink);
    cursor: pointer;
  }
  .choix:hover {
    background: var(--color-surface-soft);
  }
  .choix.choisi {
    border-width: 3px;
    border-color: var(--color-brand-500);
    background: var(--color-brand-100);
  }
  .choix input {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    margin-top: 0.15rem;
    accent-color: var(--color-brand-900);
  }
  /* Le focus clavier doit se voir : il porte sur la ligne entière, pas sur le point. */
  .choix:focus-within {
    outline: 3px solid var(--color-brand-500);
    outline-offset: 2px;
  }
</style>
