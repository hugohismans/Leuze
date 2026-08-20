<script lang="ts">
  import { store } from '../appState.svelte'
  import { formatDayNumber, formatLongDayLabel, monthGrid, startOfLocalMonth, todayLocalDate } from '../domain/time'
  import type { LocalDate } from '../domain/types'

  let { date, onPickDay }: { date: LocalDate; onPickDay: (day: LocalDate) => void } = $props()

  const grid = $derived(monthGrid(date))
  const monthStart = $derived(startOfLocalMonth(date))
  const today = todayLocalDate()
  const weekdayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
</script>

<section aria-label="Programme du mois">
  <div class="mb-2 hidden grid-cols-7 gap-2 md:grid" aria-hidden="true">
    {#each weekdayNames as name (name)}
      <div class="px-2 text-base font-bold text-ink-soft">{name}</div>
    {/each}
  </div>

  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
    {#each grid.flat() as day (day)}
      {@const activities = store.byDay(day)}
      {@const inMonth = day.slice(0, 7) === monthStart.slice(0, 7)}
      <button
        type="button"
        class="card p-2 text-left"
        class:opacity-60={!inMonth}
        class:border-brand-700={day === today}
        style="min-height: 96px;"
        onclick={() => onPickDay(day)}
      >
        <span class="sr-only">{formatLongDayLabel(day)}, {activities.length} activités. Voir le détail du jour.</span>
        <span aria-hidden="true" class="block text-lg font-bold" class:text-brand-900={day === today}>
          {formatDayNumber(day)}
        </span>
        <span aria-hidden="true" class="mt-1 flex flex-wrap gap-1">
          {#each activities.slice(0, 6) as occurrence (occurrence.id)}
            {@const category = store.categoryOf(occurrence.categoryId)}
            <span
              class="inline-flex size-7 items-center justify-center rounded-full text-base"
              style="background: var(--cat-{category?.colorToken ?? 'defaut'}-bg, var(--cat-defaut-bg));"
              title={occurrence.title}
            >{category?.icon ?? '•'}</span>
          {/each}
          {#if activities.length > 6}
            <span class="text-base font-semibold text-ink-soft">+{activities.length - 6}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>

  <p class="mt-4 text-base text-ink-soft">
    Appuyez sur un jour pour voir le détail des activités de ce jour.
  </p>
</section>
