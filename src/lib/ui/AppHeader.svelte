<script lang="ts">
  import logo from '../brand/acis-logo-blanc.svg'
  import { store } from '../appState.svelte'
  import { formatLongDayLabel, todayLocalDate } from '../domain/time'
  import { navigate, router } from '../router.svelte'

  const today = todayLocalDate()
  // Ce nombre annonce ce qui reste à venir : une séance passée n'y compte pas, un
  // rendez-vous passé non plus.
  const registeredCount = $derived(store.upcomingMine.length + store.upcomingAppointments.length)

  /**
   * L'en-tête est resserré dans l'espace soignant, et là seulement.
   *
   * Un soignant travaille sur un téléphone, à côté d'un patient, et ce qu'il vient
   * chercher est en dessous : le bandeau ne doit pas manger le tiers de son écran. Le
   * patient, lui, garde la grande typographie — ce n'est pas un ornement mais un choix
   * d'accessibilité, et la resserrer pour lui serait défaire ce qui compte le plus ici.
   */
  const compact = $derived(router.path.startsWith('/soignant'))
</script>

<header class="bg-brand-900 text-white" class:compact>
  <div class="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4">
    <div class="flex items-center gap-4">
      <img src={logo} alt="ACIS" class="h-11 w-auto shrink-0" />
      <div>
        <!--
          Le titre de l'application n'est le titre de page (« h1 ») que sur le calendrier.
          Ailleurs, l'écran porte son propre titre : une page n'a qu'un seul « h1 ».
        -->
        {#if router.path === '/'}
          <h1 class="text-2xl font-bold">Hodie</h1>
        {:else}
          <p class="text-2xl font-bold">Hodie</p>
        {/if}
        <p class="text-base text-brand-100">{formatLongDayLabel(today)}</p>
      </div>
    </div>

    <!--
      Le bouton reste sur l'écran « Mes inscriptions », marqué comme la page en cours.

      Il en disparaissait, l'entête se raccourcissait de soixante-dix-huit pixels, et le
      bouton « Retour » du dessous sautait d'un écran à l'autre : c'est précisément ce que
      les critères de revue du projet interdisent. Le laisser en place règle les deux
      choses à la fois — la hauteur ne bouge plus, et l'on lit où l'on se trouve.
    -->
    <!--
      Sans session, pas de bouton : l'écran du code n'a pas d'inscriptions à montrer.
      En démonstration, `isDemo` le laissait en place après « Fermer mon accès » ; il
      changeait l'adresse, faisait paraître un « Retour », et ramenait au même champ.
    -->
    {#if !router.path.startsWith('/soignant') && store.signedIn}
      {@const ici = router.path === '/mes-inscriptions'}
      <button
        type="button"
        class="btn btn-secondary"
        aria-current={ici ? 'page' : undefined}
        disabled={ici}
        onclick={() => navigate('/mes-inscriptions')}
      >
        <span aria-hidden="true">📋</span>
        <span>Mes inscriptions{registeredCount > 0 ? ` (${registeredCount})` : ''}</span>
      </button>
    {/if}
  </div>
</header>

<style>
  /*
    Sur un écran étroit, et dans l'espace soignant seulement : le logo rétrécit, le titre
    passe sur une ligne, la date se met en retrait. Le bandeau perd la moitié de sa
    hauteur, sans qu'aucun texte ne descende sous 18 pixels — le plancher du projet.
  */
  @media screen and (max-width: 700px) {
    .compact > :global(div) {
      padding-block: 0.5rem;
      gap: 0.75rem;
    }
    .compact :global(img) {
      height: 2rem;
    }
    .compact :global(h1),
    .compact :global(p.text-2xl) {
      font-size: 1.25rem;
      line-height: 1.2;
    }
    /* La date descend d'un cran de graisse plutôt que de taille. */
    .compact :global(p.text-base) {
      font-size: 1rem;
      opacity: 0.85;
    }
  }
</style>
