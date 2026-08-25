<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import type { TimeConflict } from '../../lib/data/staffPorts'
  import { navigate } from '../../lib/router.svelte'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff, isVisibleToService } from '../../lib/domain/audience'
  import { capacityOf, staffCapacityLabel } from '../../lib/domain/capacity'
  import { wouldExceedCapacity } from '../../lib/domain/waitlist'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
    formatTime,
    formatTimeRange,
    startOfIsoWeek,
    todayLocalDate,
  } from '../../lib/domain/time'
  import type { Occurrence } from '../../lib/domain/types'

  /**
   * La réunion de début de semaine.
   *
   * C'est l'écran qui remplace la feuille de papier : on passe d'activité en activité,
   * on demande qui veut participer, on clique sur les prénoms. Le geste est le même
   * qu'aujourd'hui — seul le support change. La plupart des patients n'auront donc
   * jamais à toucher l'application : ils la retrouveront simplement à jour s'ils
   * l'ouvrent.
   */
  /**
   * La réunion se tient **dans une unité**. Le service choisi restreint donc à la fois
   * les activités passées en revue et les prénoms proposés : une activité réservée à un
   * autre service ne peut accueillir personne d'ici, et faire défiler les patients des
   * autres unités ne ferait que rallonger la réunion.
   *
   * Le choix est mémorisé sur l'appareil : la tablette du Mazurel rouvre sur Le Mazurel.
   */
  const MEMOIRE = 'leuze.reunion.service'
  const retenu = typeof localStorage === 'undefined' ? null : localStorage.getItem(MEMOIRE)
  let serviceId = $state<string | null>(retenu)

  /*
    À défaut d'un choix retenu sur l'appareil, l'unité du compte fait le premier choix.

    C'est ce que ce réglage évite : arriver le lundi matin et re-sélectionner son unité,
    sur ce poste-ci comme sur celui d'à côté. L'unité n'arrive qu'après la connexion —
    d'où l'effet plutôt qu'une valeur de départ.

    « semee » est volontairement un « let » ordinaire, non réactif : le lire et l'écrire
    dans le même effet en ferait une dépendance de cet effet, qui se relancerait
    aussitôt. Il sert ici à ne semer qu'une fois — sans quoi choisir « Tous les services »
    serait défait à la lecture suivante.
  */
  let semee = retenu !== null
  $effect(() => {
    const unite = staffStore.unit
    if (semee || unite === null) return
    semee = true
    serviceId = unite
  })

  function choisirService(valeur: string): void {
    // Un choix à la main est un choix : l'unité du compte ne le défera pas.
    semee = true
    serviceId = valeur === '' ? null : valeur
    selection = null
    dernierMessage = null
    if (typeof localStorage !== 'undefined') {
      if (serviceId === null) localStorage.removeItem(MEMOIRE)
      else localStorage.setItem(MEMOIRE, serviceId)
    }
  }

  let selection = $state<string | null>(null)
  let dernierMessage = $state<string | null>(null)
  let enCours = $state<string | null>(null)

  /**
   * Seules les activités **à venir** : on ne prend pas d'inscription pour une séance
   * commencée, et la faire figurer dans la revue ferait perdre du temps à la réunion.
   */
  const maintenant = new Date()
  const aInscription = $derived(
    staffStore.occurrences
      // Les activités sans inscription obligatoire sont passées en revue elles aussi :
      // noter qui vient les fait apparaître dans la semaine de chacun, et c'est bien la
      // question que pose la réunion — « qui veut faire du ping-pong ? ».
      .filter((o) => o.status !== 'cancelled')
      // Réservée à un autre service : personne ici ne peut y aller.
      .filter((o) => serviceId === null || isVisibleToService(o, serviceId)),
  )
  const semaine = $derived(
    aInscription
      .filter((o) => o.start.getTime() > maintenant.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  )
  const passees = $derived(aInscription.length - semaine.length)

  const courante = $derived<Occurrence | null>(
    semaine.find((o) => o.id === selection) ?? semaine[0] ?? null,
  )

  const position = $derived(courante === null ? 0 : semaine.findIndex((o) => o.id === courante.id) + 1)

  /** Seuls les patients que l'activité concerne : liste plus courte, et rien d'inutile à l'écran. */
  const eligibles = $derived(
    courante === null
      ? []
      : staffStore.patients
          .filter((p) => serviceId === null || p.serviceId === serviceId)
          .filter((p) => isVisibleToService(courante, p.serviceId)),
  )

  const etat = $derived(courante === null ? null : capacityOf(courante))

  /**
   * Les inscriptions telles que le domaine les attend. La liste servie par le serveur ne
   * porte que ce que l'écran affiche : on la complète de ce que `wouldExceedCapacity`
   * regarde — le statut suffit, il ne compte que les confirmés.
   */
  const inscriptionsCourantes = $derived(
    staffStore.roster.map((ligne) => ({
      id: ligne.patientUid,
      occurrenceId: courante?.id ?? '',
      patientUid: ligne.patientUid,
      status: ligne.status,
      createdAt: new Date(0),
      queuedAt: new Date(0),
      createdBy: 'staff' as const,
    })),
  )

  /*
    Réveiller la fonction d'inscription dès l'ouverture de l'écran.

    Elle s'endort au bout d'un quart d'heure sans usage, et le premier appel paie alors
    son démarrage : plusieurs secondes, exactement au moment où l'on clique sur le
    premier prénom. On l'appelle donc à vide pendant qu'on lit la liste.
  */
  $effect(() => {
    void staffStore.warmRegistration()
  })

  // À chaque changement d'activité, on relit la liste des inscrits.
  let chargeePour = $state<string | null>(null)
  $effect(() => {
    const id = courante?.id ?? null
    if (id === null || id === chargeePour) return
    chargeePour = id
    void staffStore.openRoster(id)
  })

  /**
   * Le dépassement, demandé et non subi.
   *
   * L'équipe décide parfois qu'on peut être neuf pour huit places : elle connaît la salle,
   * le groupe et la personne. L'application n'a pas à discuter cette décision — mais elle
   * la demande, sinon un dépassement passerait inaperçu et l'on découvrirait la salle
   * trop petite le jour même.
   *
   * Uniquement ici. Un patient qui s'inscrit seul depuis sa tablette n'y a pas droit : le
   * domaine ignore le drapeau pour une inscription faite par un patient.
   */
  let aConfirmer = $state<string | null>(null)

  /**
   * Le chevauchement d'horaire, rapporté par le serveur.
   *
   * Il ne peut pas se calculer ici : l'écran ne voit ni les rendez-vous des autres, ni
   * les inscriptions d'une personne dans les activités qu'il n'affiche pas. Le serveur
   * refuse donc une première fois en disant ce qui tombe en même temps, l'écran demande,
   * et la même inscription repart avec l'accord du soignant.
   */
  let chevauchement = $state<{ patientUid: string; conflicts: TimeConflict[] } | null>(null)

  async function basculer(
    patientUid: string,
    options: { depassement?: boolean; malgreLeChevauchement?: boolean } = {},
  ): Promise<void> {
    /*
      Un même prénom ne part pas deux fois en même temps ; les autres, si.
      Bloquer toute la liste le temps d'un aller-retour, c'était rendre la réunion
      impraticable — on y clique dix prénoms à la suite.
    */
    if (courante === null || enCours === patientUid) return
    const board = { occurrence: courante, registrations: inscriptionsCourantes }
    if (
      options.depassement !== true &&
      !staffStore.isRegistered(patientUid) &&
      wouldExceedCapacity(board, patientUid)
    ) {
      aConfirmer = patientUid
      return
    }
    aConfirmer = null
    chevauchement = null
    enCours = patientUid
    let resultat
    try {
      resultat = await staffStore.togglePatient(courante.id, patientUid, {
        ...(options.depassement === true ? { overCapacity: true } : {}),
        ...(options.malgreLeChevauchement === true ? { overrideConflict: true } : {}),
      })
    } finally {
      // Quoi qu'il arrive — y compris une erreur qu'on n'attendait pas — le prénom
      // redevient cliquable. Sans cela, un seul incident le figeait pour toute la réunion.
      enCours = null
    }
    // Refusé faute de confirmation : on montre ce qui tombe en même temps, on demande.
    if (resultat.conflicts !== undefined && resultat.conflicts.length > 0) {
      chevauchement = { patientUid, conflicts: resultat.conflicts }
      dernierMessage = null
      return
    }
    dernierMessage = resultat.message
  }

  function allerA(decalage: number): void {
    if (courante === null) return
    const index = semaine.findIndex((o) => o.id === courante.id)
    const suivante = semaine[index + decalage]
    if (suivante) {
      selection = suivante.id
      dernierMessage = null
    }
  }

  const semaineDe = (decalage: number): void => {
    staffStore.date = addLocalDays(startOfIsoWeek(staffStore.date), decalage * 7)
    selection = null
    void staffStore.refresh()
  }

  const enAttente = $derived(staffStore.roster.filter((l) => l.status === 'waitlist'))
</script>

<section class="mx-auto max-w-[1400px] px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-3xl font-bold text-ink">Réunion de début de semaine</h1>
      <p class="text-lg text-ink-soft">
        Du {formatDayLabel(staffStore.week[0]!)} au {formatDayLabel(staffStore.week[6]!)}
      </p>
    </div>

    <div>
      <label for="service-reunion" class="mb-1 block text-base font-semibold text-ink">
        Réunion dans le service
      </label>
      <select
        id="service-reunion"
        class="rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
        style="min-height: 56px;"
        value={serviceId ?? ''}
        onchange={(event) => choisirService(event.currentTarget.value)}
      >
        <option value="">Tous les services</option>
        {#each staffStore.catalog.services as service (service.id)}
          <option value={service.id}>{service.name}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-secondary" onclick={() => semaineDe(-1)}>
        <span aria-hidden="true">←</span> Semaine précédente
      </button>
      {#if startOfIsoWeek(staffStore.date) !== startOfIsoWeek(todayLocalDate())}
        <button type="button" class="btn btn-secondary" onclick={() => { staffStore.date = todayLocalDate(); selection = null; void staffStore.refresh() }}>
          Cette semaine
        </button>
      {/if}
      <button type="button" class="btn btn-secondary" onclick={() => semaineDe(1)}>
        Semaine suivante <span aria-hidden="true">→</span>
      </button>
    </div>
  </div>

  {#if passees > 0}
    <p class="mb-4 rounded-xl bg-surface-soft p-3 text-base text-ink">
      {passees} activité{passees > 1 ? 's' : ''} de cette semaine {passees > 1 ? 'ont' : 'a'} déjà eu lieu :
      {passees > 1 ? 'elles ne figurent pas' : 'elle ne figure pas'} dans la revue.
    </p>
  {/if}

  {#if semaine.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      {#if passees > 0}
        Toutes les activités à inscription de cette semaine ont déjà eu lieu.
        Passez à la semaine suivante pour préparer le programme.
      {:else if serviceId !== null}
        Aucune activité à inscription cette semaine pour ce service. Choisissez un autre
        service, ou posez le programme dans « La semaine ».
      {:else}
        Aucune activité à inscription cette semaine. Posez d'abord le programme dans « La semaine ».
      {/if}
    </p>
  {:else}
    <div class="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <!-- La liste des activités de la semaine : on les passe une par une. -->
      <nav aria-label="Activités de la semaine" class="card p-3">
        <p class="mb-2 px-1 text-base font-semibold text-ink-soft">
          {semaine.length} activité{semaine.length > 1 ? 's' : ''} à passer en revue
          {#if serviceId !== null}
            — {staffStore.catalog.services.find((s) => s.id === serviceId)?.name}
          {/if}
        </p>
        <ul class="grid gap-2">
          {#each semaine as occurrence (occurrence.id)}
            {@const active = courante?.id === occurrence.id}
            <li>
              <button
                type="button"
                class="w-full rounded-xl border-2 p-3 text-left"
                class:border-brand-500={active}
                class:bg-brand-50={active}
                class:border-line={!active}
                aria-current={active ? 'true' : undefined}
                onclick={() => { selection = occurrence.id; dernierMessage = null }}
              >
                <p class="text-lg font-bold text-ink">{occurrence.title}</p>
                <p class="text-base text-ink-soft">
                  {formatDayLabel(occurrence.localDate)} · {formatTimeRange(occurrence.start, occurrence.end)}
                </p>
                <p class="text-base text-ink-soft">
                  {#if !occurrence.registrationRequired && occurrence.capacity === null}
                    <span aria-hidden="true">🚪</span>
                    Ouverte à tous · {occurrence.confirmedCount} noté{occurrence.confirmedCount > 1 ? 's' : ''}
                  {:else if occurrence.capacity !== null}
                    {occurrence.confirmedCount} / {occurrence.capacity} inscrits
                  {:else}
                    {occurrence.confirmedCount} inscrit{occurrence.confirmedCount > 1 ? 's' : ''}
                  {/if}
                </p>
              </button>
            </li>
          {/each}
        </ul>
      </nav>

      <!-- L'activité en cours, et les prénoms sur lesquels on clique. -->
      {#if courante !== null}
        <div class="card p-4">
          <p class="text-base font-semibold text-ink-soft">Activité {position} sur {semaine.length}</p>
          <h2 class="text-2xl font-bold text-ink">{courante.title}</h2>
          <p class="text-lg text-ink">
            {formatLongDayLabel(courante.localDate)} · {formatTimeRange(courante.start, courante.end)}
          </p>
          <p class="text-base text-ink-soft">
            {store.locationOf(courante.locationId)?.name ?? courante.locationId}
            {#if courante.facilitator}· avec {courante.facilitator}{/if}
          </p>
          <p class="text-base text-ink-soft">
            {audienceLabelForStaff(
              staffStore.activityOf(courante.activityId) ?? { audience: 'all', serviceIds: [] },
              staffStore.catalog.services,
            )}
          </p>

          <p class="mt-2 text-lg font-semibold text-ink">
            {staffCapacityLabel(courante)}
            {#if etat?.kind === 'full'}
              <span class="badge ml-2" style="background: var(--color-surface-soft); color: var(--color-ink);">
                <span aria-hidden="true">⏳</span> Complet — les suivants passent en liste d'attente
              </span>
            {/if}
          </p>

          {#if !courante.registrationRequired}
            <p class="mt-2 rounded-xl bg-surface-soft p-3 text-base text-ink">
              <span aria-hidden="true">🚪</span>
              Cette activité est ouverte à tous : personne n'est refusé faute d'être noté.
              Noter les prénoms la fait apparaître dans la semaine de chacun.
            </p>
          {/if}

          <h3 class="mt-4 mb-2 text-lg font-bold text-ink">Qui souhaite participer ?</h3>
          <p class="mb-3 text-base text-ink-soft">
            Touchez un prénom pour l'inscrire. Touchez-le à nouveau pour le retirer.
          </p>

          <!--
            Une liste vide et une liste qu'on n'a pas pu lire se ressemblent à l'écran, et
            l'on n'inscrit pas les mêmes gens selon qu'on croit l'une ou l'autre. On le dit.
          -->
          {#if staffStore.rosterIllisible}
            <div role="alert" class="mb-3 rounded-xl border-4 border-amber-500 bg-amber-50 p-3">
              <p class="text-lg text-ink">
                <span aria-hidden="true">⚠️</span>
                La liste des inscrits n'a pas pu être lue. Personne n'est perdu : vérifiez la
                connexion, puis touchez « Réessayer ».
              </p>
              <button
                type="button"
                class="btn btn-secondary mt-3"
                onclick={() => { if (courante !== null) void staffStore.openRoster(courante.id) }}
              >
                Réessayer
              </button>
            </div>
          {/if}

          {#if eligibles.length === 0}
            <p class="text-lg text-ink-soft">
              {#if serviceId === null}
                Aucun patient n'est rattaché aux services concernés par cette activité.
              {:else}
                Aucun patient de ce service pour le moment.
              {/if}
            </p>
          {:else}
            <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {#each eligibles as patient (patient.uid)}
                {@const inscrit = staffStore.isRegistered(patient.uid)}
                {@const attente = enAttente.some((l) => l.patientUid === patient.uid)}
                <li>
                  <button
                    type="button"
                    class="w-full rounded-xl border-2 p-3 text-left"
                    class:border-brand-700={inscrit}
                    class:bg-brand-100={inscrit}
                    class:border-line={!inscrit}
                    aria-pressed={inscrit}
                    onclick={() => basculer(patient.uid)}
                  >
                    <span class="text-lg font-semibold text-ink">
                      <!-- Jamais la couleur seule : le signe dit l'état. -->
                      <span aria-hidden="true">{inscrit ? '✓' : '＋'}</span>
                      {patient.firstName}
                    </span>
                    <span class="block text-base text-ink-soft">
                      {store.serviceOf(patient.serviceId)?.name ?? patient.serviceId}
                      {#if attente}· en liste d'attente{/if}
                    </span>
                  </button>

                  {#if chevauchement !== null && chevauchement.patientUid === patient.uid}
                    <div
                      role="alert"
                      class="mt-2 rounded-xl border-4 border-amber-500 bg-amber-50 p-3"
                    >
                      <p class="text-lg font-semibold text-ink">
                        <span aria-hidden="true">⚠️</span>
                        {#if chevauchement.conflicts.some((c) => c.kind === 'appointment')}
                          {patient.firstName} a un rendez-vous à ce moment-là :
                        {:else}
                          {patient.firstName} est déjà pris à ce moment-là :
                        {/if}
                      </p>
                      <ul class="mt-1 grid gap-1">
                        <!-- Même raison : deux occupations identiques se rencontrent. -->
                        {#each chevauchement.conflicts as conflit, rang (rang)}
                          <li class="text-lg text-ink">
                            <span aria-hidden="true">{conflit.kind === 'appointment' ? '🩺' : '📅'}</span>
                            {conflit.label}, de {formatTime(conflit.start)} à {formatTime(conflit.end)}
                          </li>
                        {/each}
                      </ul>
                      <p class="mt-2 text-lg text-ink">Voulez-vous l'inscrire quand même ?</p>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          class="btn btn-primary"
                          disabled={enCours !== null}
                          onclick={() => basculer(patient.uid, { malgreLeChevauchement: true })}
                        >
                          Oui, inscrire quand même
                        </button>
                        <button type="button" class="btn btn-secondary" onclick={() => (chevauchement = null)}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if aConfirmer === patient.uid && courante !== null}
                    <div
                      role="alert"
                      class="mt-2 rounded-xl border-4 border-amber-500 bg-amber-50 p-3"
                    >
                      <p class="text-lg font-semibold text-ink">
                        <span aria-hidden="true">⚠️</span>
                        L'activité est complète : {courante.confirmedCount} inscrits pour
                        {courante.capacity} places.
                      </p>
                      <p class="mt-1 text-lg text-ink">
                        Inscrire {patient.firstName} fera
                        {courante.confirmedCount + 1} personnes. Voulez-vous continuer ?
                      </p>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          class="btn btn-primary"
                          disabled={enCours !== null}
                          onclick={() => basculer(patient.uid, { depassement: true })}
                        >
                          Oui, dépasser
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary"
                          onclick={() => (aConfirmer = null)}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          {#if dernierMessage !== null}
            <p role="status" class="mt-3 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
              {dernierMessage}
            </p>
          {/if}

          <div class="mt-4 flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary" disabled={position <= 1} onclick={() => allerA(-1)}>
              <span aria-hidden="true">←</span> Activité précédente
            </button>
            <button type="button" class="btn btn-primary" disabled={position >= semaine.length} onclick={() => allerA(1)}>
              Activité suivante <span aria-hidden="true">→</span>
            </button>
          </div>

          <!-- Le geste qui clôt la réunion : chacun repart avec sa feuille. -->
          {#if position >= semaine.length}
            <div class="mt-4 border-t-2 border-line pt-4">
              <p class="mb-2 text-lg text-ink">
                C'était la dernière activité. Il reste à distribuer les plannings.
              </p>
              <button type="button" class="btn btn-primary btn-huge" onclick={() => navigate('/soignant/plannings')}>
                <span aria-hidden="true">🖨️</span> Imprimer les plannings du service
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
