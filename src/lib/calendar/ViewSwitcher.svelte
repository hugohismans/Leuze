<script lang="ts">
  import { store, type CalendarView } from '../appState.svelte'
  import { config } from '../config'

  const views: { id: CalendarView; label: string }[] = [
    { id: 'day', label: 'Jour' },
    { id: 'week', label: 'Semaine' },
    ...(config.patientMonthView ? [{ id: 'month' as const, label: 'Mois' }] : []),
  ]
</script>

<div role="group" aria-label="Choisir l'affichage du calendrier" class="flex flex-wrap gap-2">
  {#each views as view (view.id)}
    <button
      type="button"
      class="btn btn-quiet flex-1"
      aria-pressed={store.view === view.id}
      onclick={() => (store.view = view.id)}
    >
      {view.label}
    </button>
  {/each}
</div>
