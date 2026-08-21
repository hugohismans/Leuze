<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { navigate, router } from '../../lib/router.svelte'

  /**
   * Deux rangs d'écrans, pour une raison d'usage : quatre servent tous les jours, trois
   * seulement de temps en temps. Sur un téléphone, tout afficher poussait le contenu
   * quatre rangées plus bas ; les écrans occasionnels et le compte sont donc repliés.
   *
   * Dès qu'il y a la place, tout revient sur une rangée. Le choix se fait ici, en
   * JavaScript, et non par une astuce CSS : un `<details>` fermé n'expose pas son
   * contenu, quoi qu'on écrive dessus.
   */
  const quotidiens = [
    { chemin: '/soignant', libelle: 'La semaine' },
    { chemin: '/soignant/reunion', libelle: 'Réunion du lundi' },
    { chemin: '/soignant/aujourdhui', libelle: "Aujourd'hui" },
    { chemin: '/soignant/rendez-vous', libelle: 'Rendez-vous' },
  ]

  const occasionnels = [
    { chemin: '/soignant/patients', libelle: 'Les patients' },
    { chemin: '/soignant/activites', libelle: 'Les activités' },
    { chemin: '/soignant/catalogue', libelle: 'Le catalogue' },
  ]

  const REQUETE = '(min-width: 1100px)'
  let large = $state(typeof window === 'undefined' ? true : window.matchMedia(REQUETE).matches)

  $effect(() => {
    const media = window.matchMedia(REQUETE)
    const suivre = (event: MediaQueryListEvent): void => {
      large = event.matches
    }
    media.addEventListener('change', suivre)
    return () => media.removeEventListener('change', suivre)
  })

  const actif = (chemin: string): boolean => router.path === chemin
  /** Le repli s'ouvre tout seul quand on se trouve déjà sur l'un de ces écrans. */
  const dansLesAutres = $derived(occasionnels.some((o) => actif(o.chemin)))
</script>

{#snippet onglet(chemin: string, libelle: string)}
  <button
    type="button"
    class="btn"
    class:btn-primary={actif(chemin)}
    class:btn-secondary={!actif(chemin)}
    aria-current={actif(chemin) ? 'page' : undefined}
    onclick={() => navigate(chemin)}
  >
    {libelle}
  </button>
{/snippet}

{#snippet compte()}
  <span class="compte flex items-center gap-3">
    <span class="text-base text-ink-soft">
      {staffStore.identity.firstName ?? staffStore.identity.email}
    </span>
    <button type="button" class="btn btn-secondary" onclick={() => staffStore.signOut()}>
      Se déconnecter
    </button>
  </span>
{/snippet}

<nav aria-label="Espace soignant" class="border-b border-line bg-surface-soft">
  <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-3">
    {#each quotidiens as item (item.chemin)}
      {@render onglet(item.chemin, item.libelle)}
    {/each}

    {#if large}
      {#each occasionnels as item (item.chemin)}
        {@render onglet(item.chemin, item.libelle)}
      {/each}
      {@render compte()}
    {:else}
      <details class="autres-ecrans w-full" open={dansLesAutres}>
        <summary class="btn btn-secondary">Autres écrans</summary>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          {#each occasionnels as item (item.chemin)}
            {@render onglet(item.chemin, item.libelle)}
          {/each}
          {@render compte()}
        </div>
      </details>
    {/if}
  </div>
</nav>

<style>
  .autres-ecrans summary {
    /* Un résumé reste un résumé : on lui retire seulement le triangle par défaut. */
    list-style: none;
    cursor: pointer;
    display: inline-flex;
  }
  .autres-ecrans summary::-webkit-details-marker {
    display: none;
  }
  .compte {
    margin-left: auto;
  }

  /*
    Sur un téléphone, deux onglets ne tiennent pas côte à côte avec le remplissage
    habituel : on le resserre, et deux rangées suffisent alors au lieu de quatre.
    La hauteur de 56 px — la cible tactile — n'est pas touchée.
  */
  @media screen and (max-width: 700px) {
    nav :global(.btn) {
      padding-left: 0.75rem;
      padding-right: 0.75rem;
    }
  }
</style>
