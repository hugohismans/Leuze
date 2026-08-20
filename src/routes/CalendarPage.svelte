<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import DayView from '../lib/calendar/DayView.svelte'
  import Filters from '../lib/calendar/Filters.svelte'
  import MonthView from '../lib/calendar/MonthView.svelte'
  import ViewSwitcher from '../lib/calendar/ViewSwitcher.svelte'
  import WeekView from '../lib/calendar/WeekView.svelte'
  import {
    addLocalDays,
    addLocalMonths,
    formatDayLabel,
    formatMonthLabel,
    todayLocalDate,
    weekDays,
  } from '../lib/domain/time'

  const labels = {
    day: { previous: 'Jour précédent', next: 'Jour suivant' },
    week: { previous: 'Semaine précédente', next: 'Semaine suivante' },
    month: { previous: 'Mois précédent', next: 'Mois suivant' },
  }

  function move(direction: -1 | 1): void {
    if (store.view === 'day') store.date = addLocalDays(store.date, direction)
    else if (store.view === 'week') store.date = addLocalDays(store.date, 7 * direction)
    else store.date = addLocalMonths(store.date, direction)
  }

  const periodLabel = $derived(
    store.view === 'day'
      ? formatDayLabel(store.date)
      : store.view === 'week'
        ? `Semaine du ${formatDayLabel(weekDays(store.date)[0]!)}`
        : formatMonthLabel(store.date),
  )
</script>

<div class="mx-auto grid grid-cols-1 gap-5 px-4 py-5 {store.view === 'week' ? 'max-w-[1600px]' : 'max-w-5xl'}">
  <ViewSwitcher />

  <!-- En vue jour, le titre visible est celui de la liste juste en dessous :
       ce libellé ne sert qu'à annoncer le changement aux lecteurs d'écran. -->
  <p class="text-center text-xl font-bold" class:sr-only={store.view === 'day'} aria-live="polite">
    {periodLabel}
  </p>

  <div class="grid grid-cols-2 gap-3">
    <button type="button" class="btn btn-secondary" onclick={() => move(-1)}>
      <span aria-hidden="true">←</span>
      <span>{labels[store.view].previous}</span>
    </button>

    <button type="button" class="btn btn-secondary" onclick={() => move(1)}>
      <span>{labels[store.view].next}</span>
      <span aria-hidden="true">→</span>
    </button>
  </div>

  {#if store.date !== todayLocalDate()}
    <button type="button" class="btn btn-quiet" onclick={() => (store.date = todayLocalDate())}>
      Revenir à aujourd'hui
    </button>
  {/if}

  <Filters />

  {#if store.loading}
    <p class="card p-6 text-lg" aria-live="polite">Chargement du programme…</p>
  {:else if store.view === 'day'}
    <DayView date={store.date} />
  {:else if store.view === 'week'}
    <WeekView date={store.date} />
  {:else}
    <MonthView
      date={store.date}
      onPickDay={(day) => {
        store.date = day
        store.view = 'day'
      }}
    />
  {/if}
</div>
