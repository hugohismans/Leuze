<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { uniqueSlug } from '../../lib/domain/slug'

  /**
   * Paramétrage du catalogue : lieux, services, catégories.
   * C'est ce qui permet aux soignants d'adapter l'application sans passer par le code —
   * ajouter une salle, ouvrir un service, créer une famille d'activités.
   */

  type Genre = 'lieu' | 'service' | 'categorie'

  // Couleurs disponibles : elles doivent exister dans tokens.css. La couleur ne porte
  // jamais seule l'information, elle est toujours doublée par l'icône.
  const COULEURS = ['sport', 'creatif', 'culturel', 'relaxation', 'parole', 'cuisine', 'musique', 'nature', 'defaut']

  let edition = $state<{ genre: Genre; id: string | null } | null>(null)
  let nom = $state('')
  let indications = $state('')
  let batiment = $state('')
  let icone = $state('🎨')
  let couleur = $state('defaut')
  let actif = $state(true)
  let busy = $state(false)

  function ouvrir(genre: Genre, id: string | null): void {
    edition = { genre, id }
    nom = ''
    indications = ''
    batiment = ''
    icone = '🎨'
    couleur = 'defaut'
    actif = true

    if (id === null) return
    if (genre === 'lieu') {
      const lieu = staffStore.catalog.locations.find((l) => l.id === id)
      if (lieu) {
        nom = lieu.name
        indications = lieu.accessNotes ?? ''
        batiment = lieu.building ?? ''
        actif = lieu.isActive
      }
    } else if (genre === 'service') {
      const service = staffStore.catalog.services.find((s) => s.id === id)
      if (service) {
        nom = service.name
        actif = service.isActive
      }
    } else {
      const categorie = staffStore.catalog.categories.find((c) => c.id === id)
      if (categorie) {
        nom = categorie.name
        icone = categorie.icon
        couleur = categorie.colorToken
      }
    }
  }

  async function enregistrer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (edition === null || nom.trim().length === 0 || busy) return
    busy = true
    const { genre, id } = edition

    if (genre === 'lieu') {
      const identifiant = id ?? uniqueSlug(nom, staffStore.catalog.locations.map((l) => l.id))
      await staffStore.saveLocation({
        id: identifiant,
        name: nom.trim(),
        ...(indications.trim() ? { accessNotes: indications.trim() } : {}),
        ...(batiment.trim() ? { building: batiment.trim() } : {}),
        isActive: actif,
      })
    } else if (genre === 'service') {
      const identifiant = id ?? uniqueSlug(nom, staffStore.catalog.services.map((s) => s.id))
      await staffStore.saveService({ id: identifiant, name: nom.trim(), isActive: actif })
    } else {
      const identifiant = id ?? uniqueSlug(nom, staffStore.catalog.categories.map((c) => c.id))
      await staffStore.saveCategory({
        id: identifiant,
        name: nom.trim(),
        icon: icone.trim() || '•',
        colorToken: couleur,
      })
    }

    edition = null
    busy = false
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
  const ouvertPour = (genre: Genre, id: string | null): boolean =>
    edition !== null && edition.genre === genre && edition.id === id
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Le catalogue</h1>
  <p class="mb-4 text-lg text-ink-soft">
    Les lieux, les services et les catégories utilisés dans les activités. Ce qui est
    enregistré ici est immédiatement proposé dans le formulaire de création.
  </p>

  {#if !staffStore.isAdmin}
    <p role="status" class="mb-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Seul un administrateur peut modifier le catalogue. Vous pouvez le consulter.
    </p>
  {/if}

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <!-- Formulaire commun aux trois genres : les champs varient, la mécanique non. -->
  {#snippet formulaire(genre: Genre, id: string | null)}
    <form onsubmit={enregistrer} class="mt-3 rounded-xl border-2 border-line p-4">
      <label for="nom" class="mb-2 block text-lg font-semibold text-ink">Nom</label>
      <input id="nom" bind:value={nom} class={champ} style="min-height: 56px;" />

      {#if genre === 'lieu'}
        <label for="indications" class="mt-4 mb-2 block text-lg font-semibold text-ink">
          Comment s'y rendre — le patient lira cette phrase
        </label>
        <input
          id="indications"
          bind:value={indications}
          class={champ}
          style="min-height: 56px;"
          placeholder="Au fond du couloir, à droite après la cafétéria"
        />
        <label for="batiment" class="mt-4 mb-2 block text-lg font-semibold text-ink">
          Bâtiment ou étage — facultatif
        </label>
        <input id="batiment" bind:value={batiment} class={champ} style="min-height: 56px;" />
      {/if}

      {#if genre === 'categorie'}
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label for="icone" class="mb-2 block text-lg font-semibold text-ink">
              Icône — elle double la couleur
            </label>
            <input id="icone" bind:value={icone} maxlength="4" class={champ} style="min-height: 56px;" />
          </div>
          <div>
            <label for="couleur" class="mb-2 block text-lg font-semibold text-ink">Couleur</label>
            <select id="couleur" bind:value={couleur} class={champ} style="min-height: 56px;">
              {#each COULEURS as valeur (valeur)}
                <option value={valeur}>{valeur}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}

      {#if genre !== 'categorie'}
        <label class="mt-4 flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
          <input type="checkbox" bind:checked={actif} class="size-6" />
          Proposé dans les activités
        </label>
      {/if}

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="submit" class="btn btn-primary" disabled={busy || nom.trim().length === 0}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" class="btn btn-secondary" onclick={() => (edition = null)}>Annuler</button>
      </div>
      <p class="mt-2 text-base text-ink-soft">
        {id === null ? "L'identifiant sera créé à partir du nom." : `Identifiant : ${id} — il ne change pas.`}
      </p>
    </form>
  {/snippet}

  <!-- Les lieux -->
  <h2 class="mt-6 mb-3 text-2xl font-bold text-ink">Les lieux</h2>
  <ul class="grid gap-3">
    {#each staffStore.catalog.locations as lieu (lieu.id)}
      <li class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="text-xl font-bold text-ink">{lieu.name}</h3>
          {#if staffStore.isAdmin}
            <button type="button" class="btn btn-secondary" onclick={() => ouvrir('lieu', lieu.id)}>
              Modifier
            </button>
          {/if}
        </div>
        {#if lieu.accessNotes}<p class="text-base text-ink-soft">{lieu.accessNotes}</p>{/if}
        {#if ouvertPour('lieu', lieu.id)}{@render formulaire('lieu', lieu.id)}{/if}
      </li>
    {/each}
  </ul>
  {#if staffStore.isAdmin}
    {#if ouvertPour('lieu', null)}
      <div class="card mt-3 p-4">{@render formulaire('lieu', null)}</div>
    {:else}
      <button type="button" class="btn btn-primary mt-3" onclick={() => ouvrir('lieu', null)}>
        <span aria-hidden="true">＋</span> Ajouter un lieu
      </button>
    {/if}
  {/if}

  <!-- Les services -->
  <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Les services</h2>
  <ul class="grid gap-3">
    {#each staffStore.catalog.services as service (service.id)}
      <li class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="text-xl font-bold text-ink">{service.name}</h3>
          {#if staffStore.isAdmin}
            <button type="button" class="btn btn-secondary" onclick={() => ouvrir('service', service.id)}>
              Modifier
            </button>
          {/if}
        </div>
        {#if ouvertPour('service', service.id)}{@render formulaire('service', service.id)}{/if}
      </li>
    {/each}
  </ul>
  {#if staffStore.isAdmin}
    {#if ouvertPour('service', null)}
      <div class="card mt-3 p-4">{@render formulaire('service', null)}</div>
    {:else}
      <button type="button" class="btn btn-primary mt-3" onclick={() => ouvrir('service', null)}>
        <span aria-hidden="true">＋</span> Ajouter un service
      </button>
    {/if}
  {/if}

  <!-- Les catégories -->
  <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Les catégories</h2>
  <ul class="grid gap-3">
    {#each staffStore.catalog.categories as categorie (categorie.id)}
      <li class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="text-xl font-bold text-ink">
            <span aria-hidden="true">{categorie.icon}</span>
            {categorie.name}
          </h3>
          {#if staffStore.isAdmin}
            <button type="button" class="btn btn-secondary" onclick={() => ouvrir('categorie', categorie.id)}>
              Modifier
            </button>
          {/if}
        </div>
        {#if ouvertPour('categorie', categorie.id)}{@render formulaire('categorie', categorie.id)}{/if}
      </li>
    {/each}
  </ul>
  {#if staffStore.isAdmin}
    {#if ouvertPour('categorie', null)}
      <div class="card mt-3 p-4">{@render formulaire('categorie', null)}</div>
    {:else}
      <button type="button" class="btn btn-primary mt-3" onclick={() => ouvrir('categorie', null)}>
        <span aria-hidden="true">＋</span> Ajouter une catégorie
      </button>
    {/if}
  {/if}
</section>
