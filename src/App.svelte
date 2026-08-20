<script lang="ts">
  import { store } from './lib/appState.svelte'
  import { router } from './lib/router.svelte'
  import AppHeader from './lib/ui/AppHeader.svelte'
  import BackLink from './lib/ui/BackLink.svelte'
  import ActivityPage from './routes/ActivityPage.svelte'
  import CalendarPage from './routes/CalendarPage.svelte'
  import MyRegistrationsPage from './routes/MyRegistrationsPage.svelte'

  store.loadCatalog()

  // Une seule requête par fenêtre visible : c'est ce que permet la dénormalisation
  // des occurrences (voir PLAN.md §3).
  $effect(() => {
    const { from, to } = store.range
    void from
    void to
    store.refresh()
  })

  const occurrenceId = $derived(
    router.path.startsWith('/activite/') ? router.path.slice('/activite/'.length) : null,
  )
</script>

<a class="skip-link" href="#contenu">Aller au contenu</a>

<AppHeader />

{#if occurrenceId !== null || router.path === '/mes-inscriptions'}
  <BackLink />
{/if}

<main id="contenu">
  {#if occurrenceId !== null}
    <ActivityPage {occurrenceId} />
  {:else if router.path === '/mes-inscriptions'}
    <MyRegistrationsPage />
  {:else}
    <CalendarPage />
  {/if}
</main>

<footer class="mx-auto max-w-5xl px-4 py-8 text-base text-ink-soft">
  <p>
    Démonstration — les activités, les lieux et les inscriptions affichés sont fictifs.
    Aucune donnée n'est enregistrée.
  </p>
</footer>
