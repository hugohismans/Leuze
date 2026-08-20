<script lang="ts">
  import { store } from '../appState.svelte'
  import { formatTime, formatTimeRange } from '../domain/time'
  import type { Occurrence } from '../domain/types'
  import { navigate } from '../router.svelte'
  import CategoryBadge from './CategoryBadge.svelte'
  import PlacesBadge from './PlacesBadge.svelte'

  /** `dense` : mise en page verticale pour les colonnes étroites de la vue semaine. */
  let { occurrence, dense = false }: { occurrence: Occurrence; dense?: boolean } = $props()

  const category = $derived(store.categoryOf(occurrence.categoryId))
  const location = $derived(store.locationOf(occurrence.locationId))
  const mine = $derived(store.myStatusFor(occurrence.id))
  const cancelled = $derived(occurrence.status === 'cancelled')
</script>

<button
  type="button"
  class="card w-full min-w-0 text-left hover:border-brand-500"
  class:p-4={!dense}
  class:p-3={dense}
  class:bg-surface-soft={cancelled}
  onclick={() => navigate(`/activite/${occurrence.id}`)}
>
  <div class="min-w-0" class:flex={!dense} class:gap-4={!dense}>
    <div class="shrink-0 text-brand-900">
      <div class="text-2xl font-bold" class:text-xl={dense}>{formatTime(occurrence.start)}</div>
      {#if !dense}
        <div class="text-base text-ink-soft">→ {formatTime(occurrence.end)}</div>
      {/if}
    </div>

    <div class="min-w-0 flex-1" class:mt-1={dense}>
      <h3
        class="font-bold text-ink hyphens-auto break-words"
        class:text-xl={!dense}
        class:text-base={dense}
        class:line-through={cancelled}
        lang="fr"
      >
        {occurrence.title}
      </h3>

      <p class="mt-1 flex items-start gap-2 text-ink-soft break-words" class:text-lg={!dense} class:text-base={dense}>
        <span aria-hidden="true">📍</span>
        <span class="min-w-0">{location?.name ?? 'Lieu à préciser'}</span>
      </p>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <CategoryBadge {category} iconOnly={dense} />
        {#if cancelled}
          <span class="badge" style="background: var(--color-stop-bg); color: var(--color-stop-fg);">
            <span aria-hidden="true">✕</span>
            <span>Annulée</span>
          </span>
        {:else}
          <PlacesBadge {occurrence} short={dense} />
        {/if}
        {#if mine}
          <span class="badge max-w-full" style="background: var(--color-brand-100); color: var(--color-brand-900);">
            <span aria-hidden="true">✓</span>
            <span class="min-w-0 break-words">
              {mine.status === 'confirmed' ? 'Vous êtes inscrit' : 'Vous êtes en attente'}
            </span>
          </span>
        {/if}
      </div>

      {#if cancelled && occurrence.cancellationReason && !dense}
        <p class="mt-2 text-base text-ink-soft">Motif : {occurrence.cancellationReason}</p>
      {/if}
    </div>
  </div>

  <span class="sr-only">{formatTimeRange(occurrence.start, occurrence.end)}. Voir le détail.</span>
</button>
