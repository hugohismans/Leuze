<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { navigate, router } from '../../lib/router.svelte'

  const onglets = [
    { chemin: '/soignant', libelle: 'La semaine' },
    { chemin: '/soignant/aujourdhui', libelle: "Aujourd'hui" },
    { chemin: '/soignant/activites', libelle: 'Les activités' },
    { chemin: '/soignant/catalogue', libelle: 'Le catalogue' },
  ]
</script>

<nav aria-label="Espace soignant" class="border-b border-line bg-surface-soft">
  <div class="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3">
    <div class="flex flex-wrap gap-2">
      {#each onglets as onglet (onglet.chemin)}
        <button
          type="button"
          class="btn"
          class:btn-primary={router.path === onglet.chemin}
          class:btn-secondary={router.path !== onglet.chemin}
          aria-current={router.path === onglet.chemin ? 'page' : undefined}
          onclick={() => navigate(onglet.chemin)}
        >
          {onglet.libelle}
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-3">
      <span class="text-base text-ink-soft">
        {staffStore.identity.firstName ?? staffStore.identity.email}
      </span>
      <button type="button" class="btn btn-secondary" onclick={() => staffStore.signOut()}>
        Se déconnecter
      </button>
    </div>
  </div>
</nav>
