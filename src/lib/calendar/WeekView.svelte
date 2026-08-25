<script lang="ts">
  import { store } from '../appState.svelte'
  import { formatDayNumber, formatWeekdayLabel, todayLocalDate, weekDays } from '../domain/time'
  import type { LocalDate } from '../domain/types'
  import ActivityCard from '../ui/ActivityCard.svelte'

  let { date }: { date: LocalDate } = $props()

  const days = $derived(weekDays(date))
  const today = todayLocalDate()
</script>

<!--
  Sept colonnes à partir de 1536 px de large. En dessous, la colonne descend sous
  170 px : avec une taille de police de 18 px minimum, un titre comme « Gymnastique
  douce » ne tient plus sans être coupé au milieu d'un mot — illisible pour ce public.
  La grille dégrade alors en liste groupée par jour, entièrement lisible (PLAN.md §6.8).
-->
<section aria-label="Programme de la semaine" class="grid grid-cols-1 gap-4 2xl:grid-cols-7">
  {#each days as day (day)}
    {@const activities = store.byDay(day)}
    <section aria-labelledby="jour-{day}" class="min-w-0">
      <h2
        id="jour-{day}"
        class="mb-2 flex flex-col justify-center rounded-xl px-3 py-2 text-lg font-bold 2xl:min-h-[4.6rem]"
        class:bg-brand-700={day === today}
        class:text-white={day === today}
        class:bg-surface-soft={day !== today}
      >
        <span class="block">{formatWeekdayLabel(day)} {formatDayNumber(day)}</span>
        {#if day === today}
          <span class="block text-base font-semibold">aujourd'hui</span>
        {/if}
      </h2>

      {#if activities.length === 0}
        <!--
          Voir la vue jour : quand le filtre écarte quelque chose, « pas d'activité »
          serait faux ; quand la journée est réellement vide, « Rien avec ce filtre »
          l'est tout autant.
        -->
        <p class="px-3 text-base text-ink-soft">
          {store.hiddenOn(day) > 0 ? 'Rien avec ce filtre' : "Pas d'activité"}
        </p>
      {:else}
        <ul class="grid grid-cols-1 gap-3">
          {#each activities as occurrence (occurrence.id)}
            <li><ActivityCard {occurrence} dense /></li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</section>
