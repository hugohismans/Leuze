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
    // Le service du patient fait partie de la requête : en changer recharge le calendrier.
    void store.serviceId
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

<footer class="mx-auto grid grid-cols-1 max-w-5xl gap-4 px-4 py-8 text-base text-ink-soft">
  <p>
    Démonstration — les activités, les lieux et les inscriptions affichés sont fictifs.
    Aucune donnée n'est enregistrée.
  </p>

  <!--
    Panneau réservé à la démonstration : il n'existera pas dans l'application livrée.
    Il sert à montrer qu'un patient ne voit que les activités ouvertes à son service.
  -->
  <details class="card p-4">
    <summary class="cursor-pointer font-semibold" style="min-height: 44px;">
      Démonstration : changer de service
    </summary>
    <div class="mt-3">
      <label for="demo-service" class="mb-1 block font-semibold text-ink">
        Le patient de démonstration appartient au service :
      </label>
      <select
        id="demo-service"
        class="w-full max-w-md rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
        style="min-height: 56px;"
        value={store.serviceId}
        onchange={(event) => store.setDemoService(event.currentTarget.value)}
      >
        {#each store.services as service (service.id)}
          <option value={service.id}>{service.name}</option>
        {/each}
      </select>
      <p class="mt-2">
        Le calendrier ne contient que les activités ouvertes à tous les services et celles
        réservées à ce service. Par exemple, le ping-pong du mardi n'est proposé qu'à
        La Joncquerelle.
      </p>
    </div>
  </details>

  <p>
    Hôpital psychiatrique Saint-Jean-de-Dieu — ACIS asbl, Leuze-en-Hainaut.
    Le logo est celui du groupe ACIS et reste sa propriété.
  </p>
</footer>
