<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { proposed } from '../../lib/domain/catalog'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff, isPublished } from '../../lib/domain/audience'
  import { staffCapacityLabel } from '../../lib/domain/capacity'
  import { formatLongDayLabel, formatTimeRange, todayLocalDate } from '../../lib/domain/time'
  import CancelButton from './CancelButton.svelte'
  import type { Activity, IsoWeekday, LocalDate, LocalTime } from '../../lib/domain/types'
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

  let chargee = $state(false)
  let erreur = $state<string | null>(null)
  let busy = $state(false)

  const nouvelle = $derived(activityId === 'nouvelle')
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
      categoryId = categories[0]!.id
      locationId = lieux[0]!.id
      // La date vient de la case de la semaine sur laquelle le soignant a cliqué.
      if (date !== undefined) dateUnique = date
      chargee = true
      return
    }

    void staffStore.getActivity(activityId).then((activity: Activity | null) => {
      if (activity === null) {
        erreur = "Cette activité n'a pas été trouvée."
        chargee = true
        return
      }
      titre = activity.title
      description = activity.description
      categoryId = activity.categoryId
      locationId = activity.locationId
      facilitator = activity.facilitator ?? ''
      repetition = activity.recurrence === null ? 'une-fois' : 'chaque-semaine'
      dateUnique = activity.singleStart?.date ?? date ?? todayLocalDate()
      void 0
      jours = activity.recurrence?.byWeekday ?? []
      heure = activity.recurrence?.startTime ?? activity.singleStart?.time ?? '14:00'
      duree = activity.recurrence?.durationMin ?? activity.singleStart?.durationMin ?? 60
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

  async function enregistrer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    erreur = null
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
    busy = true
    try {
      await staffStore.saveActivity({
        ...(nouvelle ? {} : { id: activityId }),
        ...(seriesId === undefined ? {} : { seriesId }),
        title: titre.trim(),
        description: description.trim(),
        categoryId,
        locationId,
        ...(facilitator.trim().length > 0 ? { facilitator: facilitator.trim() } : {}),
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
                from: todayLocalDate(),
                until: null,
                skipDates: [],
              },
            }),
        isActive: auProgramme,
      })
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
      : (staffStore.occurrences.find((o) => o.activityId === activityId && o.localDate === date) ?? null),
  )
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
      <CancelButton occurrence={seance} />
      <p class="mt-3 text-base text-ink-soft">
        Annuler cette séance ne change rien aux autres semaines. Les personnes inscrites
        la voient barrée, avec le motif.
      </p>
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

      <label for="animateur" class="mt-4 mb-2 block text-lg font-semibold text-ink">
        Animateur — prénom seulement
      </label>
      <input id="animateur" bind:value={facilitator} class={champ} style="min-height: 56px;" placeholder="Claire" />
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
        <input id="date" type="date" bind:value={dateUnique} class={champ} style="min-height: 56px;" />
        <p class="mt-1 text-base text-ink-soft">{formatLongDayLabel(dateUnique)}</p>
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
              <option value={minutes}>{minutes >= 60 ? `${minutes / 60} h${minutes % 60 ? ` ${minutes % 60}` : ''}` : `${minutes} minutes`}</option>
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

    <div class="flex flex-wrap gap-3">
      <button type="submit" class="btn btn-primary" disabled={busy}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      <button type="button" class="btn btn-secondary" onclick={() => navigate(retour)}>
        Annuler
      </button>
    </div>
  </form>
</section>
