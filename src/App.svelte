<script lang="ts">
  import { usesMock } from './lib/data'
  import { store } from './lib/appState.svelte'
  import { router } from './lib/router.svelte'
  import AppHeader from './lib/ui/AppHeader.svelte'
  import ImpersonationBanner from './lib/ui/ImpersonationBanner.svelte'
  import BackLink from './lib/ui/BackLink.svelte'
  import ActivityPage from './routes/ActivityPage.svelte'
  import CalendarPage from './routes/CalendarPage.svelte'
  import CodePage from './routes/CodePage.svelte'
  import AppointmentsPage from './routes/AppointmentsPage.svelte'
  import MyWeekPage from './routes/MyWeekPage.svelte'
  import StaffApp from './routes/staff/StaffApp.svelte'
  import MyRegistrationsPage from './routes/MyRegistrationsPage.svelte'
  import ProposePage from './routes/ProposePage.svelte'

  // Le catalogue n'est lisible qu'une fois la session ouverte (règles Firestore).
  $effect(() => {
    if (store.isDemo || store.signedIn) void store.loadCatalog()
  })

  /**
   * La source de données est arrêtée au chargement de la page : `/demo` est branché sur
   * les données fictives, le reste sur Firestore. Passer de l'un à l'autre en cours de
   * route donnerait donc le mauvais adapter — un soignant quittant la démonstration
   * verrait de fausses activités dans l'application réelle. On recharge la page dans ce
   * cas : c'est rare, et c'est la seule façon sûre.
   */
  $effect(() => {
    // `usesMock()` lit l'adresse, qui n'est pas réactive : c'est le chemin du routeur
    // qui déclenche la vérification.
    void router.path
    if (usesMock() !== store.isDemo) window.location.reload()
  })

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

  /*
    Ce que les patients ont le droit de faire peut changer pendant qu'une tablette reste
    allumée. On relit en changeant d'écran, au plus une fois toutes les dix secondes :
    le document est minuscule, et un réglage qui met une journée à s'appliquer ne sert
    à rien.
  */
  $effect(() => {
    void router.path
    if (!router.path.startsWith('/soignant')) void store.loadPatientPermissions()
  })

  /*
    Et le programme lui-même, pour la même raison.

    Il n'était relu qu'en changeant de fenêtre de dates ou de service : une séance
    annulée par un soignant restait proposée à l'inscription tant que le patient ne
    changeait pas de semaine. Deux écrans se contredisaient, et le calendrier proposait
    une séance qui n'aurait pas lieu.

    `refreshOnNavigation` se tait quelques secondes après une relecture : aller et venir
    entre le calendrier et une fiche ne relance donc pas une requête à chaque geste.
  */
  $effect(() => {
    void router.path
    if (!router.path.startsWith('/soignant')) void store.refreshOnNavigation()
  })

  /** Vrai quand « Un instant… » s'éternise : voir le bouton de secours plus bas. */
  let attenteLongue = $state(false)
  $effect(() => {
    if (!store.loading) {
      attenteLongue = false
      return
    }
    const minuteur = setTimeout(() => (attenteLongue = true), 8_000)
    return () => clearTimeout(minuteur)
  })

  const occurrenceId = $derived(
    router.path.startsWith('/activite/') ? router.path.slice('/activite/'.length) : null,
  )

  /** L'espace soignant est une application à part : sa propre navigation, sa propre session. */
  const espaceSoignant = $derived(router.path.startsWith('/soignant'))
</script>

<a class="skip-link" href="#contenu">Aller au contenu</a>

<!--
  Sur un grand écran, la navigation soignante reste dépliée à gauche, en colonne fixe :
  quelqu'un qui l'utilise toute la journée ne doit pas cliquer pour l'atteindre. Toute
  l'application se décale d'autant. En dessous, elle redevient un tiroir — la largeur ne
  suffit pas à porter les deux.
-->
<div class="application" class:soignant={espaceSoignant}>
<AppHeader />
<ImpersonationBanner />

{#if !espaceSoignant && (occurrenceId !== null || router.path === '/mes-inscriptions' || router.path === '/rendez-vous' || router.path === '/ma-semaine' || router.path === '/proposer')}
  <BackLink />
{/if}

<main id="contenu">
  {#if espaceSoignant}
    <StaffApp />
  <!--
    L'écran du code s'affiche aussi en démonstration, une fois l'accès fermé.

    Il était sauté : après « Fermer mon accès », la démonstration continuait de proposer
    de s'inscrire, et répondait « Cette activité n'a pas été trouvée ». On y montre donc
    ce qu'un patient voit vraiment — et le bouton de démonstration, plus bas, rouvre la
    session d'un geste.
  -->
  {:else if !store.signedIn}
    <!--
      Tant qu'on ne sait pas si une session existe, ne rien montrer plutôt qu'un
      calendrier vide : sur un réseau lent, un écran vide sans explication est ce qui
      inquiète le plus quelqu'un qui a déjà du mal à se repérer.
    -->
    {#if store.loading}
      <div class="mx-auto max-w-xl px-4 py-8">
        <p class="text-xl text-ink">Un instant…</p>
        <!--
          Passé quelques secondes, l'attente cesse d'être une attente : c'est un écran
          bloqué, et il faut pouvoir en sortir seul. Le bouton n'apparaît qu'à ce
          moment-là — l'afficher tout de suite inquiéterait pour rien.
        -->
        {#if attenteLongue}
          <p class="mt-4 text-lg text-ink">
            La connexion est lente. Vous pouvez patienter encore, ou recharger la page.
          </p>
          <button type="button" class="btn btn-primary mt-3" onclick={() => window.location.reload()}>
            Recharger la page
          </button>
        {/if}
      </div>
    {:else}
      <CodePage />
    {/if}
  {:else if occurrenceId !== null}
    <ActivityPage {occurrenceId} />
  {:else if router.path === '/mes-inscriptions'}
    <MyRegistrationsPage />
  {:else if router.path === '/rendez-vous'}
    <AppointmentsPage />
  {:else if router.path === '/ma-semaine'}
    <MyWeekPage />
  {:else if router.path === '/proposer'}
    <ProposePage />
  {:else}
    <CalendarPage />
  {/if}
</main>

<footer
  class="mx-auto grid grid-cols-1 max-w-5xl gap-4 px-4 py-8 text-base text-ink-soft"
  class:hidden={espaceSoignant}
>
  {#if store.isDemo}
    <p>
      Démonstration — les activités, les lieux et les inscriptions affichés sont fictifs.
      Aucune donnée n'est enregistrée.
    </p>
  {/if}

  <!--
    Panneau réservé à la démonstration : il n'existera pas dans l'application livrée.
    Il sert à montrer qu'un patient ne voit que les activités ouvertes à son service.
  -->
  {#if store.isDemo}
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
  {/if}

  <p>
    Hôpital psychiatrique Saint-Jean-de-Dieu — ACIS asbl, Leuze-en-Hainaut.
    Le logo est celui du groupe ACIS et reste sa propriété.
  </p>
</footer>
</div>

<style>
  /*
    Même largeur que le tiroir, déclarée une seule fois : les deux doivent s'accorder au
    pixel près, sinon la colonne laisserait un bord vide ou mordrait sur le contenu.
  */
  @media screen and (min-width: 1280px) {
    .application.soignant {
      padding-inline-start: 18rem;
    }
  }
</style>
