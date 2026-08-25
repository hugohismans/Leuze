<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { proposed } from '../../lib/domain/catalog'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff, isPublished } from '../../lib/domain/audience'
  import { staffCapacityLabel } from '../../lib/domain/capacity'
  import {
    formatDuration,
    formatLongDayLabel,
    formatTimeRange,
    todayLocalDate,
  } from '../../lib/domain/time'
  import CancelButton from './CancelButton.svelte'
  import type { Activity, IsoWeekday, LocalDate, LocalTime } from '../../lib/domain/types'
  import type { RosterLine } from '../../lib/data/staffPorts'
  import {
    activityEditRefusal,
    canChooseFacilitator,
    facilitatorFor,
  } from '../../lib/domain/activityAccess'
  import { deletionConsequences } from '../../lib/domain/catalog'
  import { leaveClashes } from '../../lib/domain/leave'
  import { findOccurrence } from '../../lib/domain/recurrence'
  import { isoWeekdayOf } from '../../lib/domain/time'
  import { navigate } from '../../lib/router.svelte'

  let { activityId, date }: { activityId: string; date?: string } = $props()

  const JOURS: Array<{ valeur: IsoWeekday; libelle: string }> = [
    { valeur: 1, libelle: 'Lundi' },
    { valeur: 2, libelle: 'Mardi' },
    { valeur: 3, libelle: 'Mercredi' },
    { valeur: 4, libelle: 'Jeudi' },
    { valeur: 5, libelle: 'Vendredi' },
    { valeur: 6, libelle: 'Samedi' },
    { valeur: 7, libelle: 'Dimanche' },
  ]

  const DUREES = [30, 45, 60, 90, 120]

  // Valeurs par défaut choisies pour qu'une activité hebdomadaire se crée en quelques
  // secondes : il ne reste qu'à saisir un titre, un jour et une heure.
  let titre = $state('')
  let description = $state('')
  let categoryId = $state('')
  let locationId = $state('')
  let facilitator = $state('')
  let facilitatorId = $state('')
  /** L'activité est animée par un patient, seul : pas d'appel. Voir `domain/attendance`. */
  let animeParUnPatient = $state(false)
  /**
   * La grande majorité des activités sont **ponctuelles** : le programme se refait
   * chaque semaine selon les disponibilités. La récurrence existe pour les quelques
   * rendez-vous fixes, mais ce n'est pas le cas courant — d'où le choix par défaut.
   */
  let repetition = $state<'une-fois' | 'chaque-semaine'>('une-fois')
  let dateUnique = $state<LocalDate>(todayLocalDate())
  let jours = $state<IsoWeekday[]>([])
  let heure = $state<LocalTime>('14:00')
  let duree = $state(60)
  let pourTous = $state(true)
  let serviceIds = $state<string[]>([])
  let placesLimitees = $state(false)
  let capacite = $state(8)
  let listeAttente = $state(true)
  let auProgramme = $state(true)
  let seriesId = $state<string | undefined>(undefined)
  /**
   * Ce que la règle de récurrence porte déjà, et que le formulaire ne montre pas.
   *
   * Le formulaire ne demande que les jours, l'heure et la durée. Il réécrivait donc le
   * reste à neuf : `from` repartait d'aujourd'hui, `until` et `skipDates` étaient perdus.
   *
   * Conséquence constatée : enregistrer une activité hebdomadaire **sans rien y changer**
   * annulait la séance déjà passée de la semaine en cours, avec ses inscrits. La fenêtre
   * de génération commence au lundi de la semaine ; la règle, elle, repartait du jour
   * même. La séance du lundi tombait entre les deux et se retrouvait « annulée —
   * l'activité a été modifiée ». Une date de fin et des jours sautés disparaissaient de
   * la même façon, sans que rien ne le dise.
   */
  let recurrenceDepart = $state<LocalDate | null>(null)
  let recurrenceFin = $state<LocalDate | null>(null)
  let recurrenceSautees = $state<LocalDate[]>([])

  let chargee = $state(false)
  /** L'activité déjà demandée au serveur : on ne la demande jamais deux fois. */
  let demandee: string | null = null
  let erreur = $state<string | null>(null)
  let busy = $state(false)

  const nouvelle = $derived(activityId === 'nouvelle')
  /** L'idée dont cette activité est issue, quand on arrive depuis « Les idées ». */
  const venuDUneIdee = $derived(nouvelle ? staffStore.propositionAConvertir : null)
  /**
   * On revient d'où l'on vient : posée depuis la semaine, l'activité y ramène ;
   * ouverte depuis la liste, elle ramène à la liste.
   */
  const retour = $derived(date !== undefined ? '/soignant' : '/soignant/activites')

  $effect(() => {
    if (chargee) return
    const categories = staffStore.catalog.categories
    const lieux = staffStore.catalog.locations
    if (categories.length === 0 || lieux.length === 0) return

    if (nouvelle) {
      /*
        Le public par défaut suit l'unité du compte.

        Une activité créée depuis la bulle de La Couturelle s'adresse d'abord à La
        Couturelle : l'ouvrir à tout l'hôpital par défaut la faisait apparaître dans le
        calendrier de deux cents personnes qui ne pouvaient pas y aller. Le choix reste
        entier — deux boutons juste en dessous, et l'écran dit à qui l'activité s'adresse
        avant qu'on l'enregistre.

        On attend que l'unité ait été **lue** : `unitId` vaut `null` aussi bien avant la
        lecture qu'en l'absence d'unité, et sans cette distinction on ouvrirait à tous
        une activité qui devait être réservée.
      */
      if (!staffStore.unitLoaded) return
      categoryId = categories[0]!.id
      locationId = lieux[0]!.id
      /*
        `accountUnit` et non `unit` : c'est la bulle où l'on travaille, pas ce qu'on
        regarde en ce moment. Cocher « Voir toutes les unités » pour jeter un œil au
        programme d'à côté vidait `unit` : l'activité créée ensuite s'ouvrait à tout
        l'hôpital, à rebours de ce que ce paragraphe dit faire.
      */
      if (staffStore.accountUnit !== null) {
        pourTous = false
        serviceIds = [staffStore.accountUnit]
      }
      // La date vient de la case de la semaine sur laquelle le soignant a cliqué.
      /*
        Une date passée, venue de la semaine qu'on feuillette, ne sert à rien.

        « ＋ Ajouter » depuis une semaine passée — un geste courant pour relire le
        programme — pré-remplissait une date qui ne produirait aucune séance, et
        l'enregistrement la refusait ensuite. On propose aujourd'hui, qui marche.
      */
      if (date !== undefined) dateUnique = date < todayLocalDate() ? todayLocalDate() : date

      /*
        L'activité née d'une idée de patient arrive avec son titre et sa description.

        Les recopier à la main serait long et fautif — et surtout, la personne qui a
        proposé doit retrouver ses mots.

        L'animateur, en revanche, n'est pas pré-rempli, même quand la personne s'est
        proposée pour animer. Ce champ désigne un compte du personnel : c'est lui qui
        donne le droit de faire l'appel, et il doit rester porté par quelqu'un de
        responsable. Que le patient anime avec lui est une chose à convenir de vive voix,
        pas un champ à remplir — l'écran le rappelle plus bas.
      */
      const idee = staffStore.propositionAConvertir
      if (idee !== null) {
        titre = idee.title
        description = idee.description
        /*
          La personne s'est proposée pour animer : on la met en animatrice, seule. C'est
          exactement ce qu'elle a demandé, et l'activité n'aura pas d'appel — ce que
          l'écran dit juste en dessous du choix. Il reste possible de désigner un membre
          du personnel à la place, d'un clic.
        */
        if (idee.wantsToLead && idee.patientFirstName) {
          animeParUnPatient = true
          facilitator = idee.patientFirstName
        }
        // Une activité née d'une idée n'est pas au programme d'emblée : il lui manque un
        // jour, une heure et un lieu, et c'est ce formulaire qui les demande.
        auProgramme = false
      }

      chargee = true
      return
    }

    /*
      L'activité n'est demandée qu'une fois, et sa réponse ne peut plus écraser une saisie.

      Cet effet se rejoue tant que le formulaire n'est pas rempli — et le catalogue, qui
      se recharge après la connexion, le relançait avant que la première réponse ne soit
      revenue. Deux lectures partaient donc, et la seconde arrivait après que le
      formulaire était affiché : si l'on avait commencé à taper entre-temps, elle
      remettait les anciennes valeurs par-dessus. On ne demande plus qu'une fois, et une
      réponse qui n'est plus celle du formulaire ouvert n'écrit rien.
    */
    if (demandee === activityId) return
    demandee = activityId
    const pour = activityId
    void staffStore.getActivity(activityId).then((activity: Activity | null) => {
      if (pour !== activityId || chargee) return
      if (activity === null) {
        erreur = "Cette activité n'a pas été trouvée."
        introuvable = true
        chargee = true
        return
      }
      titre = activity.title
      description = activity.description
      categoryId = activity.categoryId
      locationId = activity.locationId
      facilitator = activity.facilitator ?? ''
      facilitatorId = activity.facilitatorId ?? ''
      animeParUnPatient = activity.ledByPatient === true
      repetition = activity.recurrence === null ? 'une-fois' : 'chaque-semaine'
      // « date » peut être un identifiant de séance : on prend alors son jour à elle.
      dateUnique = activity.singleStart?.date ?? seance?.localDate ?? date ?? todayLocalDate()
      void 0
      jours = activity.recurrence?.byWeekday ?? []
      recurrenceDepart = activity.recurrence?.from ?? null
      recurrenceFin = activity.recurrence?.until ?? null
      recurrenceSautees = activity.recurrence?.skipDates ?? []
      heure = activity.recurrence?.startTime ?? activity.singleStart?.time ?? '14:00'
      duree = activity.recurrence?.durationMin ?? activity.singleStart?.durationMin ?? 60
      /*
        L'horaire tel qu'il était en arrivant, pour savoir si on l'a changé.

        Un `let` ordinaire, non réactif : le comparer à l'état courant dans un « derived »
        n'en ferait pas une dépendance, et l'écrire ici ne doit relancer aucun effet.
      */
      horaireInitial = `${repetition}|${jours.join(',')}|${dateUnique}|${heure}`
      pourTous = activity.audience === 'all'
      serviceIds = [...activity.serviceIds]
      placesLimitees = activity.capacity !== null
      capacite = activity.capacity ?? 8
      listeAttente = activity.waitlistEnabled
      auProgramme = activity.isActive
      seriesId = activity.seriesId
      chargee = true
    })
  })

  function basculerJour(jour: IsoWeekday): void {
    jours = jours.includes(jour) ? jours.filter((j) => j !== jour) : [...jours, jour].sort()
  }

  function basculerService(id: string): void {
    serviceIds = serviceIds.includes(id) ? serviceIds.filter((s) => s !== id) : [...serviceIds, id]
  }

  const apercuAudience = $derived(
    audienceLabelForStaff(
      { audience: pourTous ? 'all' : 'services', serviceIds },
      staffStore.catalog.services,
    ),
  )

  const publiee = $derived(isPublished({ audience: pourTous ? 'all' : 'services', serviceIds }))

  /**
   * Un soignant crée des activités, mais ce sont les siennes : il les anime. Choisir
   * quelqu'un d'autre relève de l'organisation du service, donc de l'administrateur —
   * qui seul peut aussi reprendre une activité déjà animée par un collègue.
   */
  const moi = $derived({
    role: staffStore.identity.role,
    practitionerId: staffStore.identity.practitionerId,
  })
  const choisitLAnimateur = $derived(canChooseFacilitator(moi))
  const monIntervenant = $derived(store.practitionerOf(staffStore.identity.practitionerId ?? ''))
  /**
   * L'activité relue est éclatée en champs : on la recompose pour la règle. Tant qu'elle
   * n'est pas chargée, on ne refuse rien — sans quoi l'écran accuserait avant de savoir.
   */
  const refusDeModifier = $derived(
    nouvelle || !chargee
      ? activityEditRefusal(moi, null)
      : activityEditRefusal(moi, {
          ...(facilitatorId === '' ? {} : { facilitatorId }),
          ...(facilitator === '' ? {} : { facilitator }),
        }),
  )

  /**
   * Sans animateur désigné, il n'y a pas d'appel : personne n'est responsable de ce qui
   * serait coché. On ne l'interdit pas — une activité peut très bien se passer de feuille
   * de présence — mais on le dit avant d'enregistrer, une fois, et on laisse le choix.
   *
   * L'avertissement s'affiche sur place, dans le formulaire : une fenêtre du navigateur
   * se ferme d'un réflexe et n'aurait rien appris à personne.
   */
  let avertissementAnimateur = $state(false)

  /**
   * Les jours de congé que cette activité viendrait heurter.
   *
   * L'autre sens du même oubli : on peut déclarer un congé après avoir posé un atelier,
   * mais on peut tout aussi bien poser un atelier après avoir déclaré un congé. Le second
   * ne disait rien — l'activité s'enregistrait, et l'on découvrait le lundi qu'elle
   * tombait en pleine absence.
   *
   * Rien n'est interdit : un collègue assure peut-être la séance, et l'application n'a
   * aucun moyen de le savoir. On le dit une fois, avant d'enregistrer, et l'on laisse
   * le choix — comme pour l'activité sans animateur désigné, juste au-dessus.
   */
  const congesHeurtes = $derived(
    facilitatorId === ''
      ? []
      : leaveClashes(
          staffStore.leavesOf(facilitatorId),
          repetition === 'une-fois' ? { dates: [dateUnique] } : { weekdays: jours },
          isoWeekdayOf,
          // Un congé déjà terminé faisait apparaître un avertissement sur une date
          // passée, et bloquait le premier enregistrement pour rien.
          todayLocalDate(),
        ),
  )
  /*
    L'activité demandée n'existe pas.

    Le formulaire s'ouvrait quand même, actif, intitulé « Modifier l'activité » — et
    l'enregistrer créait une activité vide sous un identifiant inventé. Une adresse
    fautive ou une activité effacée entre-temps suffisait.
  */
  let introuvable = $state(false)

  let avertissementConge = $state(false)

  /*
    Changer le jour ou l'heure d'une activité laisse les inscrits derrière.

    L'identifiant d'une séance porte sa date et son heure : déplacer l'activité d'une
    heure crée une séance neuve et vide, et l'ancienne — celle qui portait les
    inscriptions — est barrée. Rien ne le disait avant d'enregistrer, et le patient lisait
    « Cette activité a été annulée » pour une activité simplement déplacée.

    L'application ne déplace pas les inscriptions : elle prévient, et l'on décide. C'est
    une limite connue, pas un oubli.
  */
  let horaireInitial = ''
  const horaireCourant = $derived(`${repetition}|${jours.join(',')}|${dateUnique}|${heure}`)
  const horaireChange = $derived(
    !nouvelle && horaireInitial !== '' && horaireCourant !== horaireInitial,
  )
  let avertissementHoraire = $state(false)

  /**
   * Ce que porte le bouton d'enregistrement, écrit une seule fois.
   *
   * L'avertissement d'horaire disait « Appuyez de nouveau sur « Enregistrer » » pendant
   * que le bouton portait « Enregistrer sans appel » ou « Enregistrer malgré le congé » —
   * ce qui arrive dès qu'on change l'horaire d'une activité sans animateur désigné. On
   * cherchait alors un bouton qui n'existait pas.
   */
  const libelleEnregistrer = $derived(
    avertissementConge && congesHeurtes.length > 0
      ? 'Enregistrer malgré le congé'
      : avertissementAnimateur && facilitatorId === ''
        ? 'Enregistrer sans appel'
        : 'Enregistrer',
  )

  async function enregistrer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    erreur = null
    if (refusDeModifier !== null) {
      erreur = refusDeModifier
      return
    }
    if (titre.trim().length === 0) {
      erreur = 'Donnez un titre à l’activité.'
      return
    }
    if (repetition === 'chaque-semaine' && jours.length === 0) {
      erreur = 'Choisissez au moins un jour de la semaine.'
      return
    }
    if (repetition === 'une-fois' && !dateUnique) {
      erreur = 'Choisissez la date de l’activité.'
      return
    }
    /*
      Une activité ponctuelle datée d'hier ne produit aucune séance.

      Elle s'enregistrait quand même, figurait dans la liste comme les autres, avec sa
      date — et n'apparaissait jamais nulle part : ni dans la semaine du soignant, ni chez
      les patients. Le message, « Aucun changement dans le calendrier », ne se rattachait
      à rien de visible. On refuse, en disant pourquoi.
    */
    if (repetition === 'une-fois' && !/^[12]\d{3}-\d{2}-\d{2}$/.test(dateUnique)) {
      erreur = 'Cette date n’est pas lisible. Vérifiez le jour, le mois et l’année.'
      return
    }
    /*
      Le refus ne vaut que pour une activité qu'on CRÉE.

      Appliqué à la modification, il rendait impossible de toucher à une activité
      ponctuelle déjà passée — corriger une faute de frappe, changer un lieu, la retirer
      du programme : plus rien. Ce qui a eu lieu se relit et se corrige.
    */
    if (nouvelle && repetition === 'une-fois' && dateUnique < todayLocalDate()) {
      erreur =
        'Cette date est passée : aucune séance ne serait créée. Choisissez aujourd’hui ou un jour à venir.'
      return
    }
    /*
      L'heure vide s'enregistrait, et cassait tout ce qui affiche un programme.

      Un champ « time » se vide d'un geste, et le formulaire ne demandait rien. La séance
      naissait alors sans instant lisible, et le premier écran qui tentait de la placer
      dans une semaine levait une erreur — la semaine, aujourd'hui, l'impression, et le
      calendrier du patient. Une seule saisie suffisait à rendre l'application muette.

      Le format est vérifié, pas seulement la présence : un champ « time » rend « HH:mm »,
      mais rien n'oblige un navigateur à le faire.
    */
    if (!/^\d{2}:\d{2}$/.test(heure)) {
      erreur = 'Choisissez l’heure de début.'
      return
    }
    if (!(duree > 0)) {
      erreur = 'Choisissez la durée de l’activité.'
      return
    }
    /*
      Un nombre de places vide s'enregistrait comme « pas de limite ».

      L'activité était alors dite à places limitées côté soignant et annoncée « places non
      limitées » au patient : deux écrans qui se contredisent, et une salle de huit
      personnes ouverte à quarante.
    */
    if (placesLimitees && !(capacite > 0)) {
      erreur = 'Écrivez un nombre de places, au moins 1 — ou décochez « Places limitées ».'
      return
    }
    /*
      Le domaine tranche : pour qui ne choisit pas, l'activité est la sienne.

      Sauf quand un patient anime : là, le choix est fait et il est explicite. Laisser le
      domaine attribuer l'activité au soignant connecté reviendrait à défaire ce qu'on
      vient de demander, et à rouvrir un appel dont on a dit qu'il n'y en aurait pas.
    */
    if (animeParUnPatient) {
      facilitatorId = ''
      if (facilitator.trim().length === 0) {
        erreur = 'Donnez le prénom de la personne qui anime.'
        return
      }
    } else {
      const anime = facilitatorFor(moi, facilitatorId === '' ? null : facilitatorId)
      if (anime !== facilitatorId) {
        facilitatorId = anime ?? ''
        facilitator = store.practitionerOf(facilitatorId)?.name ?? ''
      }
      if (facilitatorId === '' && !avertissementAnimateur) {
        avertissementAnimateur = true
        return
      }
    }
    // Le congé se dit après l'animateur : l'un peut décider de l'autre, puisque les
    // congés lus sont ceux de la personne désignée.
    if (congesHeurtes.length > 0 && !avertissementConge) {
      avertissementConge = true
      return
    }
    if (horaireChange && !avertissementHoraire) {
      avertissementHoraire = true
      return
    }
    busy = true
    try {
      const nouvelIdentifiant = await staffStore.saveActivity({
        ...(nouvelle ? {} : { id: activityId }),
        ...(seriesId === undefined ? {} : { seriesId }),
        title: titre.trim(),
        description: description.trim(),
        categoryId,
        locationId,
        // Le nom est dénormalisé pour l'affichage, l'identifiant pour retrouver le
        // planning de la personne. Les deux voyagent ensemble.
        ...(facilitator.trim().length > 0 ? { facilitator: facilitator.trim() } : {}),
        ...(facilitatorId ? { facilitatorId } : {}),
        ...(animeParUnPatient ? { ledByPatient: true } : {}),
        audience: pourTous ? 'all' : 'services',
        serviceIds: pourTous ? [] : serviceIds,
        capacity: placesLimitees ? capacite : null,
        registrationRequired: placesLimitees,
        waitlistEnabled: placesLimitees && listeAttente,
        ...(repetition === 'une-fois'
          ? {
              recurrence: null,
              singleStart: { date: dateUnique, time: heure, durationMin: duree },
            }
          : {
              recurrence: {
                freq: 'weekly' as const,
                byWeekday: jours,
                startTime: heure,
                durationMin: duree,
                // Ce que le formulaire ne montre pas, il le rend intact.
                from: recurrenceDepart ?? todayLocalDate(),
                until: recurrenceFin,
                skipDates: recurrenceSautees,
              },
            }),
        isActive: auProgramme,
      })
      /*
        L'idée et l'activité se rejoignent ici.

        Sans ce rattachement, l'idée resterait dans « l'activité reste à créer » alors
        qu'elle vient de l'être, et quelqu'un la créerait une seconde fois.
      */
      const idee = staffStore.propositionAConvertir
      if (idee !== null && nouvelle) {
        staffStore.propositionAConvertir = null
        void staffStore.decideProposal(idee.id, 'accepted', { activityId: nouvelIdentifiant })
      }
      navigate(retour)
    } catch {
      erreur = "L'enregistrement n'a pas abouti. Réessayez dans un instant."
    }
    busy = false
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'

  /**
   * La séance sur laquelle le soignant a cliqué dans la semaine.
   *
   * Elle vaut plus que l'activité elle-même dans le cas courant : l'animateur prévient
   * le lundi qu'il sera absent jeudi. Jusqu'ici on ne pouvait annuler qu'une séance du
   * jour même, depuis « Aujourd'hui » — pas une séance à venir.
   *
   * Annuler la séance ne touche pas à l'activité : les autres semaines restent.
   */
  const seance = $derived(
    date === undefined || nouvelle
      ? null
      : /*
           Par identifiant d'abord, par jour ensuite.

           La semaine passe désormais l'identifiant : il désigne une séance et une seule.
           Le repli par jour reste pour les adresses écrites à la main et les anciens
           signets — mais il ne peut pas trancher entre deux séances du même jour, et
           c'est exactement ce qui arrivait après un changement d'heure : on cliquait la
           nouvelle séance, on ouvrait l'ancienne, barrée, et « Supprimer cette séance »
           effaçait celle qu'on n'avait pas choisie, avec ses inscrits.
        */
        findOccurrence(staffStore.occurrences, activityId, date),
  )

  /**
   * Les inscrits de cette séance, avec de quoi les désinscrire.
   *
   * On vient ici pour modifier une activité, et la première question qui se pose est
   * « qui est concerné ? » — changer l'heure d'une séance où six personnes sont inscrites
   * n'est pas le même geste que la déplacer quand elle est vide.
   *
   * La liste ne s'affiche que pour qui a le droit de toucher à l'activité : elle suit la
   * même règle que le formulaire, et le serveur la revérifie.
   */
  let inscritsCharges = $state<string | null>(null)
  let retirant = $state<string | null>(null)

  $effect(() => {
    const id = seance?.id
    if (id === undefined || refusDeModifier !== null) return
    if (inscritsCharges === id) return
    inscritsCharges = id
    void staffStore.openRoster(id)
  })

  const inscrits = $derived(
    seance === null || inscritsCharges !== seance.id
      ? []
      : staffStore.roster.filter((ligne) => ligne.status === 'confirmed'),
  )
  const enAttente = $derived(
    seance === null || inscritsCharges !== seance.id
      ? []
      : staffStore.roster.filter((ligne) => ligne.status === 'waitlist'),
  )

  /**
   * Supprimer la séance, à ne pas confondre avec l'annuler.
   *
   * Annuler laisse la séance visible, barrée, avec son motif : la personne inscrite
   * comprend pourquoi elle ne vient pas. Supprimer efface tout — c'est pour ce qui
   * n'aurait jamais dû être créé, quand il ne reste rien à expliquer et qu'une ligne
   * barrée dans un calendrier serait un mystère de plus.
   */
  let aSupprimerLaSeance = $state(false)

  /**
   * Ce que la suppression de cette séance ferait disparaître. Les présences sont déjà
   * sous les yeux — la liste des inscrits est juste au-dessus — mais les nommer une
   * dernière fois, au moment de décider, n'est pas de trop.
   */
  const consequencesDeLaSeance = $derived(
    seance === null
      ? []
      : deletionConsequences({
          registrations: inscrits.length + enAttente.length,
          sessions: 0,
          pastSessions: 0,
          attendances: staffStore.roster.filter((l) => l.attendance !== undefined).length,
        }),
  )

  async function supprimerLaSeance(): Promise<void> {
    if (seance === null || retirant !== null) return
    retirant = 'seance'
    await staffStore.removeOccurrence(seance.id)
    retirant = null
    aSupprimerLaSeance = false
    navigate(retour)
  }

  async function desinscrire(patientUid: string): Promise<void> {
    if (seance === null || retirant !== null) return
    retirant = patientUid
    try {
      await staffStore.togglePatient(seance.id, patientUid)
    } finally {
      retirant = null
    }
  }

  /**
   * Donner sa place à quelqu'un de la liste d'attente, sans attendre qu'elle se libère.
   *
   * C'est le cas du désistement annoncé de vive voix : la personne inscrite dit qu'elle
   * ne viendra pas, mais ne se désinscrit pas dans l'application. Sans ce bouton, la
   * place restait vide et la suivante attendait sans le savoir.
   */
  async function donnerLaPlace(patientUid: string): Promise<void> {
    if (seance === null || retirant !== null) return
    retirant = patientUid
    try {
      await staffStore.promotePatient(seance.id, patientUid)
    } finally {
      retirant = null
    }
  }
</script>

<section class="mx-auto max-w-3xl px-4 py-6">
  <h1 class="mb-4 text-3xl font-bold text-ink">
    {nouvelle ? 'Nouvelle activité' : "Modifier l'activité"}
  </h1>

  {#if erreur !== null}
    <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
      <span aria-hidden="true">⚠️</span> {erreur}
    </p>
  {/if}

  {#if introuvable}
    <!--
      Pas de formulaire du tout : il s'ouvrait actif, intitulé « Modifier l'activité »,
      et l'enregistrer créait une activité vide sous un identifiant inventé.
    -->
    <button type="button" class="btn btn-secondary" onclick={() => navigate('/soignant/activites')}>
      <span aria-hidden="true">←</span> Retour aux activités
    </button>
  {:else}

  <!--
    Avant le formulaire : on vient de cliquer sur une séance précise, et neuf fois sur
    dix c'est pour elle qu'on est là — pas pour modifier l'activité de toutes les semaines.
  -->
  {#if seance !== null}
    <div class="card mb-5 p-4">
      <h2 class="mb-1 text-2xl font-bold text-ink">Cette séance</h2>
      <p class="mb-3 text-lg text-ink">
        {formatLongDayLabel(seance.localDate)} · {formatTimeRange(seance.start, seance.end)}
        — {staffCapacityLabel(seance)}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <CancelButton occurrence={seance} />
        {#if refusDeModifier === null && !aSupprimerLaSeance}
          <button type="button" class="btn btn-secondary" onclick={() => (aSupprimerLaSeance = true)}>
            Supprimer cette séance
          </button>
        {/if}
      </div>
      <p class="mt-3 text-base text-ink-soft">
        Annuler cette séance ne change rien aux autres semaines. Les personnes inscrites
        la voient barrée, avec le motif.
      </p>

      {#if aSupprimerLaSeance}
        <div role="alert" class="mt-3 rounded-xl border-4 border-red-600 bg-red-50 p-4">
          <h3 class="text-xl font-bold text-red-900">
            <span aria-hidden="true">⚠️</span> Supprimer, ou annuler ?
          </h3>
          {#if consequencesDeLaSeance.length === 0}
            <p class="mt-2 text-lg text-ink">
              Cette séance disparaît complètement. Personne n'y est inscrit : il n'y a rien
              d'autre à perdre.
            </p>
          {:else}
            <p class="mt-2 text-lg font-semibold text-ink">
              Cette suppression est définitive. Voici ce qui disparaît :
            </p>
            <ul class="mt-2 list-disc pl-6 text-lg text-ink">
              {#each consequencesDeLaSeance as ligne (ligne)}
                <li class="mt-1">{ligne}</li>
              {/each}
            </ul>
          {/if}
          <p class="mt-3 text-lg text-ink">
            Pour prévenir plutôt qu'effacer, fermez ceci et utilisez « Annuler cette
            séance » : elle reste visible, barrée, avec la raison.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              disabled={retirant !== null}
              onclick={supprimerLaSeance}
            >
              {retirant === 'seance' ? 'Un instant…' : 'Oui, supprimer la séance'}
            </button>
            <!--
              « Non, garder la séance » et non « Annuler » : sur un écran où « annuler »
              veut déjà dire « annuler la séance », deux boutons « Annuler » de sens
              opposés se répondaient à quelques centimètres l'un de l'autre.
            -->
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => (aSupprimerLaSeance = false)}
            >
              Non, garder la séance
            </button>
          </div>
        </div>
      {/if}

      {#if refusDeModifier === null}
        {#snippet ligneInscrite(ligne: RosterLine, attente: boolean)}
          <li class="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
            <span class="text-lg text-ink">
              {ligne.firstName}
              <span class="text-base text-ink-soft">
                {store.serviceOf(ligne.serviceId)?.name ?? ''}
                {#if attente && ligne.position !== null} · {ligne.position}ᵉ sur la liste d'attente{/if}
              </span>
            </span>
            <span class="flex flex-wrap gap-2">
              {#if attente}
                <!--
                  Le désistement dit de vive voix. La liste d'attente n'avance d'elle-même
                  que si quelqu'un se désinscrit dans l'application ; « finalement je ne
                  viens pas », dit à la réunion, ne fait rien avancer. Ce bouton comble ce
                  trou-là — il donne la place sans attendre.
                -->
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={retirant !== null}
                  onclick={() => donnerLaPlace(ligne.patientUid)}
                >
                  {retirant === ligne.patientUid ? 'Un instant…' : 'Donner la place'}
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-secondary"
                disabled={retirant !== null}
                onclick={() => desinscrire(ligne.patientUid)}
              >
                {retirant === ligne.patientUid ? 'Un instant…' : 'Désinscrire'}
              </button>
            </span>
          </li>
        {/snippet}

        <h3 class="mt-5 text-xl font-bold text-ink">
          {inscrits.length === 0
            ? 'Personne n’est inscrit à cette séance'
            : inscrits.length === 1
              ? 'Une personne inscrite'
              : `${inscrits.length} personnes inscrites`}
        </h3>

        {#if inscrits.length > 0}
          <ul class="mt-1">
            {#each inscrits as ligne (ligne.patientUid)}{@render ligneInscrite(ligne, false)}{/each}
          </ul>
        {/if}

        {#if enAttente.length > 0}
          <h3 class="mt-4 text-xl font-bold text-ink">
            {enAttente.length === 1 ? 'Une personne en attente' : `${enAttente.length} personnes en attente`}
          </h3>
          <ul class="mt-1">
            {#each enAttente as ligne (ligne.patientUid)}{@render ligneInscrite(ligne, true)}{/each}
          </ul>
        {/if}

        <p class="mt-3 text-base text-ink-soft">
          Désinscrire quelqu'un libère sa place : la première personne en attente y passe
          aussitôt. Prévenez-la, elle ne le saura pas autrement.
        </p>
        {#if enAttente.length > 0}
          <p class="mt-1 text-base text-ink-soft">
            Quelqu'un vous a dit qu'il ne viendrait pas, sans se désinscrire ?
            « Donner la place » inscrit la personne en attente sans attendre.
          </p>
        {/if}
      {/if}
    </div>
  {/if}

  {#if refusDeModifier !== null}
    <p role="status" class="mb-5 rounded-xl bg-surface-soft p-4 text-lg text-ink">
      <span aria-hidden="true">🔒</span> {refusDeModifier}
    </p>
  {/if}

  <!--
    Cette activité vient d'une idée de patient : le dire, et dire ce qu'il reste à faire.

    Le titre et la description sont ceux de la personne — elle doit y retrouver ses mots.
    L'animateur, lui, reste un compte du personnel : c'est ce compte qui donne le droit de
    faire l'appel, et quelqu'un doit en être responsable. Qu'un patient anime avec lui se
    convient de vive voix ; ce n'est pas un champ de ce formulaire.
  -->
  {#if venuDUneIdee !== null}
    <div role="status" class="mb-5 rounded-xl border-2 border-brand-500 bg-brand-100 p-4">
      <p class="text-lg font-semibold text-ink">
        <span aria-hidden="true">💡</span>
        Cette activité vient d'une idée{venuDUneIdee.patientFirstName
          ? ` de ${venuDUneIdee.patientFirstName}`
          : ' de patient'}.
      </p>
      <p class="mt-1 text-lg text-ink">
        Le titre et la description sont les siens : gardez-les autant que possible.
        Il reste à choisir le jour, l'heure et le lieu.
      </p>
      {#if venuDUneIdee.wantsToLead}
        <!--
          Le conseil suivait le choix, et non l'inverse : « Désignez tout de même un
          soignant » s'affichait alors que l'écran venait lui-même de cocher « Un patient,
          seul ». Les deux se contredisaient sur la même page.
        -->
        <p class="mt-2 text-lg text-ink">
          <span aria-hidden="true">🙋</span>
          {venuDUneIdee.patientFirstName ?? 'La personne'} s'est proposé{venuDUneIdee.patientFirstName ? '' : 'e'}
          pour l'animer.
          {#if animeParUnPatient}
            C'est ce qui est coché plus bas : l'activité n'aura pas d'appel. Si un soignant
            doit en être responsable, choisissez-le à la place — et parlez-en avec
            {venuDUneIdee.patientFirstName ?? 'la personne'}.
          {:else if facilitatorId !== ''}
            Vous avez désigné {facilitator === '' ? 'un soignant' : facilitator} : c'est lui
            qui fera l'appel. Parlez-en avec {venuDUneIdee.patientFirstName ?? 'la personne'}.
          {:else}
            Désignez un soignant responsable plus bas — c'est lui qui fera l'appel — ou
            cochez « Un patient, seul » si {venuDUneIdee.patientFirstName ?? 'la personne'}
            l'anime sans appel.
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  <form onsubmit={enregistrer} class="grid gap-5">
    <div class="card p-4">
      <label for="titre" class="mb-2 block text-lg font-semibold text-ink">Titre</label>
      <input id="titre" bind:value={titre} class={champ} style="min-height: 56px;" placeholder="Atelier cuisine" />

      <label for="description" class="mt-4 mb-2 block text-lg font-semibold text-ink">
        Description — deux ou trois phrases, en français simple
      </label>
      <textarea id="description" bind:value={description} rows="3" class={champ}></textarea>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label for="categorie" class="mb-2 block text-lg font-semibold text-ink">Catégorie</label>
          <select id="categorie" bind:value={categoryId} class={champ} style="min-height: 56px;">
            {#each proposed(staffStore.catalog.categories) as categorie (categorie.id)}
              <option value={categorie.id}>{categorie.icon} {categorie.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="lieu" class="mb-2 block text-lg font-semibold text-ink">Lieu</label>
          <select id="lieu" bind:value={locationId} class={champ} style="min-height: 56px;">
            {#each proposed(staffStore.catalog.locations) as lieu (lieu.id)}
              <option value={lieu.id}>{lieu.name}</option>
            {/each}
          </select>
        </div>
      </div>

      {#if !choisitLAnimateur && refusDeModifier !== null}
        <!--
          L'activité est celle de quelqu'un d'autre : on nomme cette personne, et on se
          garde bien d'annoncer « vous animerez cette activité ». La phrase le faisait,
          juste sous celle qui disait le contraire — deux lignes qui se contredisaient à
          trois centimètres l'une de l'autre.
        -->
        <p class="mt-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
          <span aria-hidden="true">👤</span>
          {#if facilitator !== ''}
            Cette activité est animée par <strong>{facilitator}</strong>.
          {:else}
            Cette activité n'est animée par personne en particulier.
          {/if}
          Vous pouvez la lire, pas la modifier.
        </p>
      {:else if !choisitLAnimateur}
        <!-- Pas de menu : l'activité est la vôtre. On le dit, on ne le fait pas deviner. -->
        <p class="mt-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
          <span aria-hidden="true">👤</span>
          Vous animerez cette activité : <strong>{monIntervenant?.name ?? 'vous'}</strong>.
          Seul un administrateur peut en confier une à quelqu'un d'autre.
        </p>
      {:else}
      <fieldset class="mt-4">
        <legend class="mb-2 px-1 text-lg font-semibold text-ink">Qui anime</legend>

        <!--
          Deux situations, et elles ne se ressemblent pas.

          Un membre du personnel anime : son compte donne le droit de faire l'appel, et
          quelqu'un est responsable de ce qui est coché.

          Un patient anime, seul : il n'y a pas d'appel, et ce n'est pas un manque. Lui
          confier la présence de ses camarades serait lui confier autre chose que
          l'activité. On le dit ici, avant d'enregistrer, plutôt que de le découvrir
          devant une feuille d'appel qui refuse de s'ouvrir.
        -->
        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
            <input
              type="radio"
              name="qui-anime"
              checked={!animeParUnPatient}
              onchange={() => {
                animeParUnPatient = false
                facilitator = store.practitionerOf(facilitatorId)?.name ?? ''
              }}
              class="size-6"
            />
            Un membre du personnel
          </label>
          <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
            <input
              type="radio"
              name="qui-anime"
              checked={animeParUnPatient}
              onchange={() => {
                animeParUnPatient = true
                facilitatorId = ''
                /*
                  Le nom du soignant ne reste pas dans « Son prénom » : le champ demande
                  le prénom d'un patient, et l'y trouver pré-rempli avec « Marc » invite à
                  l'enregistrer tel quel.
                */
                facilitator = ''
              }}
              class="size-6"
            />
            Un patient, seul
          </label>
        </div>

        {#if animeParUnPatient}
          <label for="prenom-animateur" class="mt-3 mb-2 block text-lg font-semibold text-ink">
            Son prénom
          </label>
          <input
            id="prenom-animateur"
            bind:value={facilitator}
            class={champ}
            style="min-height: 56px;"
            maxlength="40"
            placeholder="Bernard"
            autocomplete="off"
          />
          <p class="mt-2 rounded-xl bg-surface-soft p-3 text-base text-ink">
            <span aria-hidden="true">ℹ️</span>
            Cette activité n'aura pas d'appel : personne ne notera les présences. Le prénom
            s'affichera sur le programme, comme pour tout animateur.
          </p>
        {:else}
          <!--
            Une étiquette, comme les menus « Catégorie », « Lieu » et « Durée ». Sans elle,
            un lecteur d'écran annonce un menu sans dire de quoi il parle.
          -->
          <label for="animateur" class="mt-3 mb-2 block text-lg font-semibold text-ink">
            Qui anime cette activité
          </label>
          <select
            id="animateur"
            class={champ}
            style="min-height: 56px;"
            value={facilitatorId}
            onchange={(event) => {
              facilitatorId = event.currentTarget.value
              // Le nom suit l'identifiant : c'est lui que le patient lira, et il reste juste
              // même si la personne est retirée du catalogue plus tard.
              facilitator = store.practitionerOf(facilitatorId)?.name ?? ''
            }}
          >
            <option value="">Personne en particulier</option>
            {#each proposed(store.practitioners) as intervenant (intervenant.id)}
              <option value={intervenant.id}>{intervenant.name} — {intervenant.role}</option>
            {/each}
          </select>
          {#if facilitatorId === '' && facilitator !== ''}
            <!-- Une activité créée avant le catalogue des intervenants garde son nom écrit
                 à la main : on l'affiche plutôt que de le perdre en silence. -->
            <p class="mt-2 text-base text-ink-soft">
              Actuellement : {facilitator}. Choisissez un intervenant pour le relier à son planning.
            </p>
          {/if}
        {/if}
      </fieldset>
      {/if}
    </div>

    <fieldset class="card p-4">
      <legend class="px-1 text-lg font-semibold text-ink">Quand</legend>

      <div class="mt-2 flex flex-col gap-2">
        <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input
            type="radio"
            name="repetition"
            checked={repetition === 'une-fois'}
            onchange={() => (repetition = 'une-fois')}
            class="size-6"
          />
          Une seule fois, à une date précise
        </label>
        <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input
            type="radio"
            name="repetition"
            checked={repetition === 'chaque-semaine'}
            onchange={() => (repetition = 'chaque-semaine')}
            class="size-6"
          />
          Chaque semaine, les mêmes jours
        </label>
      </div>

      {#if repetition === 'une-fois'}
        <label for="date" class="mt-4 mb-2 block text-lg font-semibold text-ink">Date</label>
        <!--
          Pas de `min` sur ce champ.

          Il y en avait un, et il gagnait contre le refus écrit plus haut : la validation
          du navigateur arrête la soumission avant que `enregistrer()` ne s'exécute, si
          bien que la phrase « Cette date est passée : aucune séance ne serait créée.
          Choisissez aujourd'hui ou un jour à venir. » n'était jamais affichée. À la
          place, le bouton ne faisait rien et le navigateur murmurait une bulle dans sa
          propre langue — ni française, ni écrite pour ces écrans.

          La date pré-remplie est déjà ramenée à aujourd'hui quand on arrive d'une semaine
          passée : il ne reste que la date tapée à la main, et celle-là reçoit une phrase.
        -->
        <input
          id="date"
          type="date"
          bind:value={dateUnique}
          class={champ}
          style="min-height: 56px;"
        />
        <!--
          Un champ « date » se vide d'un geste, et une chaîne vide n'est pas une date :
          la mettre en toutes lettres levait une exception à chaque rendu, et la phrase
          restait figée sur la date d'avant — elle affirmait donc un jour que le champ ne
          portait plus.
        -->
        <!--
          Une année à deux chiffres — « 0002-01-01 », tapée par mégarde — passait le
          contrôle de forme et s'affichait « Mercredi 1er janvier 1902 » : la seule
          vérification offerte au soignant affirmait une autre date que celle du champ.
        -->
        {#if /^[12]\d{3}-\d{2}-\d{2}$/.test(dateUnique)}
          <p class="mt-1 text-base text-ink-soft">{formatLongDayLabel(dateUnique)}</p>
        {:else}
          <p class="mt-1 text-base text-ink-soft">Choisissez une date.</p>
        {/if}
      {:else}
      <div class="mt-4 flex flex-wrap gap-2">
        {#each JOURS as jour (jour.valeur)}
          <button
            type="button"
            class="btn"
            class:btn-primary={jours.includes(jour.valeur)}
            class:btn-secondary={!jours.includes(jour.valeur)}
            aria-pressed={jours.includes(jour.valeur)}
            onclick={() => basculerJour(jour.valeur)}
          >
            {jour.libelle}
          </button>
        {/each}
      </div>
      {/if}

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label for="heure" class="mb-2 block text-lg font-semibold text-ink">Heure de début</label>
          <input id="heure" type="time" bind:value={heure} class={champ} style="min-height: 56px;" />
        </div>
        <div>
          <label for="duree" class="mb-2 block text-lg font-semibold text-ink">Durée</label>
          <select id="duree" bind:value={duree} class={champ} style="min-height: 56px;">
            {#each DUREES as minutes (minutes)}
              <!--
                `formatDuration` plutôt qu'un calcul sur place : « 1.5 h 30 » s'affichait
                pour une heure et demie, la division rendant « 1.5 » avant qu'on n'ajoute
                les minutes restantes. Le domaine sait déjà écrire une durée.
              -->
              <option value={minutes}>{formatDuration(minutes)}</option>
            {/each}
          </select>
        </div>
      </div>
    </fieldset>

    <fieldset class="card p-4">
      <legend class="px-1 text-lg font-semibold text-ink">Pour qui</legend>

      <div class="mt-2 flex flex-col gap-2">
        <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input type="radio" name="audience" checked={pourTous} onchange={() => (pourTous = true)} class="size-6" />
          Tous les services
        </label>
        <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input type="radio" name="audience" checked={!pourTous} onchange={() => (pourTous = false)} class="size-6" />
          Seulement certains services
        </label>
      </div>

      {#if !pourTous}
        <div class="mt-2 flex flex-wrap gap-2">
          {#each proposed(staffStore.catalog.services) as service (service.id)}
            <button
              type="button"
              class="btn"
              class:btn-primary={serviceIds.includes(service.id)}
              class:btn-secondary={!serviceIds.includes(service.id)}
              aria-pressed={serviceIds.includes(service.id)}
              onclick={() => basculerService(service.id)}
            >
              {service.name}
            </button>
          {/each}
        </div>
      {/if}

      <p class="mt-3 text-base" class:font-semibold={!publiee} class:text-ink={!publiee} class:text-ink-soft={publiee}>
        {#if !publiee}<span aria-hidden="true">⚠️</span>{/if}
        {apercuAudience}
      </p>
    </fieldset>

    <fieldset class="card p-4">
      <legend class="px-1 text-lg font-semibold text-ink">Les places</legend>

      <div class="mt-2 flex flex-col gap-2">
        <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input type="radio" name="places" checked={!placesLimitees} onchange={() => (placesLimitees = false)} class="size-6" />
          Ouvert à tous, sans inscription obligatoire
        </label>
        <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input type="radio" name="places" checked={placesLimitees} onchange={() => (placesLimitees = true)} class="size-6" />
          Places limitées, avec inscription
        </label>
      </div>

      {#if !placesLimitees}
        <p class="mt-2 text-base text-ink-soft">
          Personne n'est refusé faute d'être inscrit. Les patients pourront tout de même
          noter qu'ils viennent, pour retrouver l'activité dans leur semaine — et vous
          pourrez les noter pendant la réunion du lundi.
        </p>
      {/if}

      {#if placesLimitees}
        <div class="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label for="capacite" class="mb-2 block text-lg font-semibold text-ink">Nombre de places</label>
            <input id="capacite" type="number" min="1" max="200" bind:value={capacite} class={champ} style="min-height: 56px;" />
            <!--
              Un champ « number » se vide d'un geste, et rendait `null` : l'activité était
              dite à places limitées et annoncée « places non limitées » au patient.
            -->
            {#if placesLimitees && !(capacite > 0)}
              <p class="mt-1 text-base font-semibold text-ink">
                <span aria-hidden="true">⚠️</span> Écrivez un nombre de places, au moins 1.
              </p>
            {/if}
          </div>
          <label class="flex items-center gap-3 self-end text-lg text-ink" style="min-height: 56px;">
            <input type="checkbox" bind:checked={listeAttente} class="size-6" />
            Proposer une liste d'attente
          </label>
        </div>
      {/if}
    </fieldset>

    <div class="card p-4">
      <label class="flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
        <input type="checkbox" bind:checked={auProgramme} class="size-6" />
        Mettre au programme tout de suite
      </label>
      <p class="text-base text-ink-soft">
        Décochez pour préparer l'activité sans qu'elle apparaisse dans le calendrier des patients.
      </p>
    </div>

    {#if avertissementAnimateur && facilitatorId === ''}
      <div role="alert" class="card border-4 border-amber-500 bg-amber-50 p-4">
        <h2 class="mb-2 text-2xl font-bold text-ink">
          <span aria-hidden="true">⚠️</span> Personne n'anime cette activité
        </h2>
        <p class="text-lg text-ink">
          Il n'y aura pas d'appel : sans personne désignée pour animer, la liste des
          présents ne peut pas être faite dans l'application.
        </p>
        <p class="mt-2 text-lg text-ink">
          Choisissez quelqu'un dans « Qui anime », ou enregistrez ainsi si cette activité
          se passe de feuille de présence.
        </p>
        <button
          type="button"
          class="btn btn-secondary mt-3"
          onclick={() => {
            avertissementAnimateur = false
            document.getElementById('animateur')?.focus()
          }}
        >
          Choisir quelqu'un
        </button>
      </div>
    {/if}

    <!--
      L'activité tombe sur un congé déjà déclaré.

      On nomme les jours plutôt que de les compter : « trois séances » ne dit rien,
      « mardi 25 août » se vérifie d'un coup d'œil sur son propre calendrier. Rien n'est
      interdit — un collègue assure peut-être la séance — mais on ne l'apprend plus le
      lundi matin.
    -->
    <!--
      Déplacer une activité ne déplace pas les inscriptions : l'identifiant d'une séance
      porte sa date et son heure. On le dit avant d'enregistrer, plutôt que de laisser le
      patient lire « Cette activité a été annulée » pour une séance simplement décalée.
    -->
    {#if avertissementHoraire && horaireChange}
      <div role="alert" class="card border-4 border-amber-500 bg-amber-50 p-4">
        <h2 class="mb-2 text-2xl font-bold text-ink">
          <span aria-hidden="true">⏰</span>
          Vous changez le jour ou l'heure
        </h2>
        <p class="text-lg text-ink">
          Les séances déjà au programme gardent leur ancien horaire et seront barrées ;
          de nouvelles séances seront créées au nouvel horaire, vides. Les personnes déjà
          inscrites ne sont pas déplacées : elles liront qu'il faut s'inscrire de nouveau,
          et il vaut mieux les prévenir de vive voix.
        </p>
        <p class="mt-2 text-lg font-semibold text-ink">
          Appuyez de nouveau sur « {libelleEnregistrer} » pour continuer.
        </p>
      </div>
    {/if}

    {#if avertissementConge && congesHeurtes.length > 0}
      <div role="alert" class="card border-4 border-amber-500 bg-amber-50 p-4">
        <h2 class="mb-2 text-2xl font-bold text-ink">
          <span aria-hidden="true">🌴</span>
          {congesHeurtes.length === 1
            ? 'Cette séance tombe pendant un congé'
            : 'Des séances tombent pendant un congé'}
        </h2>
        <p class="text-lg text-ink">
          {facilitator === '' ? 'Cette personne' : facilitator} a déclaré un congé sur
          {congesHeurtes.length === 1 ? 'ce jour' : 'ces jours'} :
        </p>
        <ul class="mt-2 grid gap-1">
          {#each congesHeurtes.slice(0, 8) as jour (jour)}
            <li class="text-lg font-semibold text-ink">
              <span aria-hidden="true">·</span> {formatLongDayLabel(jour)}
            </li>
          {/each}
        </ul>
        {#if congesHeurtes.length > 8}
          <p class="mt-1 text-base text-ink-soft">
            … et {congesHeurtes.length - 8} autre{congesHeurtes.length - 8 > 1 ? 's' : ''} jour{congesHeurtes.length - 8 > 1 ? 's' : ''}.
          </p>
        {/if}
        <p class="mt-2 text-lg text-ink">
          Changez la date, ou enregistrez ainsi si quelqu'un d'autre assure ces séances.
          Vous pourrez toujours les annuler une par une, avec un motif.
        </p>
      </div>
    {/if}

    <div class="flex flex-wrap gap-3">
      <button type="submit" class="btn btn-primary" disabled={busy || refusDeModifier !== null}>
        {busy ? 'Enregistrement…' : libelleEnregistrer}
      </button>
      <!-- « Quitter sans enregistrer » : « Annuler » prêtait à confusion sur un écran
           où l'on annule aussi des séances. -->
      <button type="button" class="btn btn-secondary" onclick={() => navigate(retour)}>
        Quitter sans enregistrer
      </button>
    </div>
  </form>
  {/if}
</section>
