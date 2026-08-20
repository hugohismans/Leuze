<script lang="ts">
  import { sitePlan } from '../plan/sitePlan'

  let { planZoneId }: { planZoneId?: string | undefined } = $props()

  // Tant que le plan n'est pas fourni, le composant ne rend rien :
  // la fiche activité ne doit pas afficher de cadre vide.
  const visible = $derived(sitePlan.svg !== null)
</script>

{#if visible}
  <figure class="card overflow-hidden p-3">
    <figcaption class="mb-2 text-lg font-bold">Où cela se passe</figcaption>
    <div class="site-plan" role="img" aria-label={sitePlan.description}>
      <!-- Le SVG est un fichier du dépôt, jamais un contenu saisi par un utilisateur. -->
      {@html sitePlan.svg}
    </div>
  </figure>
{/if}

<style>
  .site-plan :global(svg) {
    width: 100%;
    height: auto;
  }
  /* La zone mise en évidence est doublée d'un contour épais : jamais la couleur seule. */
  .site-plan :global([data-zone-active='true']) {
    fill: var(--color-brand-100);
    stroke: var(--color-brand-700);
    stroke-width: 4;
  }
</style>
