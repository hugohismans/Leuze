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
    <!--
      « Il n'y a pas d'activité ce jour-là » est faux quand un filtre écarte quelque
      chose : il y en a, elles sont simplement cachées. Le patient en concluait qu'il
      n'y avait rien, et ne venait pas. La phrase dit maintenant laquelle des deux
      situations il lit, et comment en sortir.

      C'est bien `hiddenOn` et non `hasFilters` : un dimanche réellement vide sous un
      filtre invitait à retirer ce filtre pour ne rien découvrir de plus.
    -->
    <p class="card p-6 text-lg">
      {#if store.hiddenOn(date) > 0}
        Aucune activité ne correspond à votre choix ce jour-là. Retirez le filtre, plus
        haut, pour voir tout le programme.
      {:else}
        Il n'y a pas d'activité ce jour-là. Vous pouvez regarder un autre jour avec les
        boutons ci-dessus.
      {/if}
    </p>
  {:else}
    <ul class="grid grid-cols-1 gap-4">
      {#each activities as occurrence (occurrence.id)}
        <li><ActivityCard {occurrence} /></li>
      {/each}
    </ul>
  {/if}
</section>
