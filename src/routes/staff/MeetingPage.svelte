<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff, isVisibleToService } from '../../lib/domain/audience'
  import { capacityOf, staffCapacityLabel } from '../../lib/domain/capacity'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
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
  let selection = $state<string | null>(null)
  let dernierMessage = $state<string | null>(null)
  let enCours = $state<string | null>(null)

  /**
   * Seules les activités **à venir** : on ne prend pas d'inscription pour une séance
   * commencée, et la faire figurer dans la revue ferait perdre du temps à la réunion.
   */
  const maintenant = new Date()
  const aInscription = $derived(
    staffStore.occurrences.filter((o) => o.status !== 'cancelled' && o.registrationRequired),
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
      : staffStore.patients.filter((p) => isVisibleToService(courante, p.serviceId)),
  )

  const etat = $derived(courante === null ? null : capacityOf(courante))

  // À chaque changement d'activité, on relit la liste des inscrits.
  let chargeePour = $state<string | null>(null)
  $effect(() => {
    const id = courante?.id ?? null
    if (id === null || id === chargeePour) return
    chargeePour = id
    void staffStore.openRoster(id)
  })

  async function basculer(patientUid: string): Promise<void> {
    if (courante === null || enCours !== null) return
    enCours = patientUid
    dernierMessage = await staffStore.togglePatient(courante.id, patientUid)
    enCours = null
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
      {:else}
        Aucune activité à inscription cette semaine. Posez d'abord le programme dans « La semaine ».
      {/if}
    </p>
  {:else}
    <div class="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <!-- La liste des activités de la semaine : on les passe une par une. -->
      <nav aria-label="Activités de la semaine" class="card p-3">
        <p class="mb-2 px-1 text-base font-semibold text-ink-soft">
          {semaine.length} activités à passer en revue
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
                  {occurrence.confirmedCount}{occurrence.capacity !== null ? ` / ${occurrence.capacity}` : ''} inscrits
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

          <h3 class="mt-4 mb-2 text-lg font-bold text-ink">Qui souhaite participer ?</h3>
          <p class="mb-3 text-base text-ink-soft">
            Touchez un prénom pour l'inscrire. Touchez-le à nouveau pour le retirer.
          </p>

          {#if eligibles.length === 0}
            <p class="text-lg text-ink-soft">
              Aucun patient n'est rattaché aux services concernés par cette activité.
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
                    disabled={enCours !== null}
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
        </div>
      {/if}
    </div>
  {/if}
</section>
