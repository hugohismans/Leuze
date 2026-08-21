<script lang="ts">
  import { store } from '../appState.svelte'

  // Replié par défaut : sur une borne, la première chose visible doit être
  // le programme, pas un panneau de réglages.
  let open = $state(false)

  /**
   * Les choix se déduisent de ce qui est affiché, pas du catalogue entier : proposer
   * un lieu où rien n'a lieu ne mène qu'à une liste vide. Un lieu retiré du catalogue
   * mais qui porte encore des séances reste donc proposé, tant qu'elles sont là.
   */
  const presents = $derived(new Set(store.occurrences.map((o) => o.locationId)))
  const typesPresents = $derived(new Set(store.occurrences.map((o) => o.categoryId)))
  const lieuxPresents = $derived(store.locations.filter((l) => presents.has(l.id)))
  const categoriesPresentes = $derived(store.categories.filter((c) => typesPresents.has(c.id)))
</script>

<details class="card" bind:open>
  <summary class="filter-summary">
    <span aria-hidden="true">⚙</span>
    <span>Filtrer les activités</span>
    {#if store.hasFilters}
      <span class="badge" style="background: var(--color-brand-100); color: var(--color-brand-900);">
        Filtre actif
      </span>
    {/if}
  </summary>

  <div class="grid grid-cols-1 gap-4 border-t-2 border-line p-4 md:grid-cols-3">
    <div>
      <label for="filtre-categorie" class="mb-1 block font-semibold">Type d'activité</label>
      <select
        id="filtre-categorie"
        class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg"
        style="min-height: 56px;"
        bind:value={store.categoryId}
      >
        <option value={null}>Toutes les activités</option>
        {#each categoriesPresentes as category (category.id)}
          <option value={category.id}>{category.icon} {category.name}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="filtre-lieu" class="mb-1 block font-semibold">Lieu</label>
      <select
        id="filtre-lieu"
        class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg"
        style="min-height: 56px;"
        bind:value={store.locationId}
      >
        <option value={null}>Tous les lieux</option>
        {#each lieuxPresents as location (location.id)}
          <option value={location.id}>{location.name}</option>
        {/each}
      </select>
    </div>

    <div class="flex items-end">
      <label
        class="flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-white p-3"
        style="min-height: 56px;"
      >
        <input type="checkbox" class="size-6" bind:checked={store.onlyAvailable} />
        <span class="text-lg">Seulement s'il reste de la place</span>
      </label>
    </div>

    {#if store.hasFilters}
      <div class="md:col-span-3">
        <button type="button" class="btn btn-quiet" onclick={() => store.clearFilters()}>
          <span aria-hidden="true">↺</span>
          <span>Tout afficher</span>
        </button>
      </div>
    {/if}
  </div>
</details>

<style>
  .filter-summary {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 56px;
    padding: 0.75rem 1rem;
    font-size: 1.05rem;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  .filter-summary::-webkit-details-marker {
    display: none;
  }
  .filter-summary::after {
    content: '▾';
    margin-left: auto;
  }
  details[open] .filter-summary::after {
    content: '▴';
  }
</style>
