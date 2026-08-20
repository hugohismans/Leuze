<script lang="ts">
  import logo from '../brand/acis-logo-blanc.svg'
  import { store } from '../appState.svelte'
  import { formatLongDayLabel, todayLocalDate } from '../domain/time'
  import { navigate, router } from '../router.svelte'

  const today = todayLocalDate()
  const registeredCount = $derived(store.mine.length)
</script>

<header class="bg-brand-900 text-white">
  <div class="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4">
    <div class="flex items-center gap-4">
      <img src={logo} alt="ACIS" class="h-11 w-auto shrink-0" />
      <div>
        <h1 class="text-2xl font-bold">Les activités</h1>
        <p class="text-base text-brand-100">{formatLongDayLabel(today)}</p>
      </div>
    </div>

    {#if router.path !== '/mes-inscriptions' && (store.isDemo || store.signedIn)}
      <button type="button" class="btn btn-secondary" onclick={() => navigate('/mes-inscriptions')}>
        <span aria-hidden="true">📋</span>
        <span>Mes inscriptions{registeredCount > 0 ? ` (${registeredCount})` : ''}</span>
      </button>
    {/if}
  </div>
</header>
