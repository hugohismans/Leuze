<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff } from '../../lib/domain/audience'
  import { staffCapacityLabel } from '../../lib/domain/capacity'
  import { formatLongDayLabel, formatTimeRange, todayLocalDate } from '../../lib/domain/time'
  import { navigate } from '../../lib/router.svelte'
  import CancelButton from './CancelButton.svelte'

  const aujourdhui = todayLocalDate()

  const audience = (activityId: string): string => {
    const activity = staffStore.activityOf(activityId)
    return activity === null ? '' : audienceLabelForStaff(activity, staffStore.catalog.services)
  }
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-3xl font-bold text-ink">{formatLongDayLabel(staffStore.date)}</h1>
    <div class="flex gap-2">
      {#if staffStore.date !== aujourdhui}
        <button type="button" class="btn btn-secondary" onclick={() => { staffStore.date = aujourdhui; staffStore.refresh() }}>
          Revenir à aujourd'hui
        </button>
      {/if}
      <button type="button" class="btn btn-primary" onclick={() => navigate('/soignant/activite/nouvelle')}>
        <span aria-hidden="true">＋</span> Nouvelle activité
      </button>
    </div>
  </div>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.loading}
    <p class="text-lg text-ink-soft">Chargement…</p>
  {:else if staffStore.today.length === 0}
    <p class="card p-5 text-lg text-ink-soft">Aucune activité ce jour-là.</p>
  {:else}
    <ul class="grid gap-4">
      {#each staffStore.today as occurrence (occurrence.id)}
        <li class="card p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <h2 class="text-xl font-bold text-ink" class:line-through={occurrence.status === 'cancelled'}>
              {occurrence.title}
            </h2>
            <p class="text-lg font-semibold text-ink">{formatTimeRange(occurrence.start, occurrence.end)}</p>
          </div>

          <p class="mt-1 text-base text-ink-soft">
            {store.locationOf(occurrence.locationId)?.name ?? occurrence.locationId}
            {#if occurrence.facilitator}— {occurrence.facilitator}{/if}
          </p>
          <p class="text-base text-ink-soft">{audience(occurrence.activityId)}</p>
          <p class="mt-1 text-base text-ink">{staffCapacityLabel(occurrence)}</p>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => navigate(`/soignant/activite/${occurrence.activityId}`)}
            >
              Modifier l'activité
            </button>
            <CancelButton {occurrence} />
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
