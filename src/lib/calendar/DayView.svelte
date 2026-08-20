<script lang="ts">
  import { store } from '../appState.svelte'
  import { formatDayLabel, todayLocalDate } from '../domain/time'
  import type { LocalDate } from '../domain/types'
  import ActivityCard from '../ui/ActivityCard.svelte'

  let { date }: { date: LocalDate } = $props()

  const activities = $derived(store.byDay(date))
  const isToday = $derived(date === todayLocalDate())
</script>

<section aria-labelledby="titre-jour">
  <h2 id="titre-jour" class="mb-4 text-2xl font-bold">
    {formatDayLabel(date)}{isToday ? " — aujourd'hui" : ''}
  </h2>

  {#if activities.length === 0}
    <p class="card p-6 text-lg">
      Il n'y a pas d'activité ce jour-là. Vous pouvez regarder un autre jour avec les boutons ci-dessus.
    </p>
  {:else}
    <ul class="grid grid-cols-1 gap-4">
      {#each activities as occurrence (occurrence.id)}
        <li><ActivityCard {occurrence} /></li>
      {/each}
    </ul>
  {/if}
</section>
