<script lang="ts">
  import { store } from '../appState.svelte'
  import { formatLongDayLabel, todayLocalDate } from '../domain/time'
  import { navigate, router } from '../router.svelte'

  const today = todayLocalDate()
  const registeredCount = $derived(store.mine.length)
</script>

<header class="border-b-2 border-line bg-brand-700 text-white">
  <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
    <div>
      <h1 class="text-2xl font-bold">Les activités</h1>
      <p class="text-base text-brand-100">{formatLongDayLabel(today)}</p>
    </div>

    {#if router.path !== '/mes-inscriptions'}
      <button type="button" class="btn btn-secondary" onclick={() => navigate('/mes-inscriptions')}>
        <span aria-hidden="true">📋</span>
        <span>Mes inscriptions{registeredCount > 0 ? ` (${registeredCount})` : ''}</span>
      </button>
    {/if}
  </div>
</header>
