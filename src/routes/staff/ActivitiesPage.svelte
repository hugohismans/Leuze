<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff, isPublished } from '../../lib/domain/audience'
  import { formatDuration } from '../../lib/domain/time'
  import type { Activity } from '../../lib/domain/types'
  import { navigate } from '../../lib/router.svelte'

  const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

  function quand(activity: Activity): string {
    const regle = activity.recurrence
    if (regle === null) {
      return activity.singleStart ? `Le ${activity.singleStart.date} à ${activity.singleStart.time}` : 'Sans date'
    }
    const jours = regle.byWeekday.map((j) => JOURS[j]).join(', ')
    return `Tous les ${jours} à ${regle.startTime.replace(':', 'h')} — ${formatDuration(regle.durationMin)}`
  }
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-3xl font-bold text-ink">Les activités</h1>
    <button type="button" class="btn btn-primary" onclick={() => navigate('/soignant/activite/nouvelle')}>
      <span aria-hidden="true">＋</span> Nouvelle activité
    </button>
  </div>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.activities.length === 0}
    <p class="card p-5 text-lg text-ink-soft">Aucune activité pour le moment.</p>
  {:else}
    <ul class="grid gap-4">
      {#each staffStore.activities as activity (activity.id)}
        <li class="card p-4" class:bg-surface-soft={!activity.isActive}>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-xl font-bold text-ink">{activity.title}</h2>
            {#if !activity.isActive}
              <span class="badge" style="background: var(--color-surface-soft); color: var(--color-ink-soft);">
                <span aria-hidden="true">📝</span> Brouillon — pas au programme
              </span>
            {/if}
          </div>

          <p class="mt-1 text-base text-ink-soft">{quand(activity)}</p>
          <p class="text-base text-ink-soft">
            {store.locationOf(activity.locationId)?.name ?? activity.locationId}
            {#if activity.facilitator}— {activity.facilitator}{/if}
          </p>

          <p class="mt-1 text-base" class:text-ink={isPublished(activity)}>
            {#if !isPublished(activity)}
              <span aria-hidden="true">⚠️</span>
            {/if}
            {audienceLabelForStaff(activity, staffStore.catalog.services)}
          </p>

          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary" onclick={() => navigate(`/soignant/activite/${activity.id}`)}>
              Modifier
            </button>
            <button type="button" class="btn btn-secondary" onclick={() => staffStore.duplicate(activity.id)}>
              Dupliquer
            </button>
            <button type="button" class="btn btn-secondary" onclick={() => staffStore.setActive(activity.id, !activity.isActive)}>
              {activity.isActive ? 'Retirer du programme' : 'Mettre au programme'}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
