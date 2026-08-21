<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import type { CatalogKind } from '../../lib/domain/catalog'
  import type { AppointmentKind, Category, Location, Service } from '../../lib/domain/types'
  import { uniqueSlug } from '../../lib/domain/slug'

  /**
   * Paramétrage du catalogue : lieux, services, catégories.
   * C'est ce qui permet aux soignants d'adapter l'application sans passer par le code —
   * ajouter une salle, ouvrir un service, créer une famille d'activités.
   */

  type Genre = 'lieu' | 'service' | 'categorie' | 'motif'

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
  /** Un retrait se confirme sur place : pas de fenêtre système, pas de clic malheureux. */
  let aRetirer = $state<{ genre: Genre; id: string; nom: string } | null>(null)
  let erreur = $state<string | null>(null)
  /** Les activités qui empêchent une suppression définitive, nommées après un retrait. */
  let bloquantes = $state<string[]>([])

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
    } else if (genre === 'categorie') {
      const categorie = staffStore.catalog.categories.find((c) => c.id === id)
      if (categorie) {
        nom = categorie.name
        icone = categorie.icon
        couleur = categorie.colorToken
        actif = categorie.isActive !== false
      }
    } else {
      const motif = store.appointmentKinds.find((m) => m.id === id)
      if (motif) {
        nom = motif.name
        icone = motif.icon
        actif = motif.isActive
      }
    }
  }

  async function enregistrer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (edition === null || nom.trim().length === 0 || busy) return
    const { genre, id } = edition
    await tenter(() => enregistrement(genre, id))
  }

  async function enregistrement(genre: Genre, id: string | null): Promise<void> {

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
    } else if (genre === 'categorie') {
      const identifiant = id ?? uniqueSlug(nom, staffStore.catalog.categories.map((c) => c.id))
      await staffStore.saveCategory({
        id: identifiant,
        name: nom.trim(),
        icon: icone.trim() || '•',
        colorToken: couleur,
        isActive: actif,
      })
    } else {
      const identifiant = id ?? uniqueSlug(nom, store.appointmentKinds.map((m) => m.id))
      await staffStore.saveAppointmentKind({
        id: identifiant,
        name: nom.trim(),
        icon: icone.trim() || '•',
        isActive: actif,
      })
    }

    edition = null
  }

  const GENRES: Record<Genre, CatalogKind> = {
    lieu: 'location',
    service: 'service',
    categorie: 'category',
    motif: 'appointmentKind',
  }

  /**
   * Une action qui échoue doit le dire. Sans ce filet, le bouton restait sur
   * « Un instant… » indéfiniment et l'écran paraissait figé sans raison.
   */
  async function tenter(action: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    erreur = null
    try {
      await action()
    } catch (error) {
      erreur = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : "L'action n'a pas abouti."
    } finally {
      busy = false
    }
  }

  async function retirer(): Promise<void> {
    if (aRetirer === null) return
    const { genre, id } = aRetirer
    await tenter(async () => {
      bloquantes = await staffStore.removeCatalogEntry(GENRES[genre], id)
      aRetirer = null
    })
  }

  async function remettre(genre: Genre, id: string, nom: string): Promise<void> {
    bloquantes = []
    await tenter(async () => {
      if (genre === 'lieu') await staffStore.saveLocation({ id, name: nom, isActive: true })
      else if (genre === 'service') await staffStore.saveService({ id, name: nom, isActive: true })
      else if (genre === 'categorie') {
        const categorie = staffStore.catalog.categories.find((c) => c.id === id)
        await staffStore.saveCategory({
          id,
          name: nom,
          icon: categorie?.icon ?? '•',
          colorToken: categorie?.colorToken ?? 'defaut',
          isActive: true,
        })
      } else {
        const motif = store.appointmentKinds.find((m) => m.id === id)
        await staffStore.saveAppointmentKind({
          id,
          name: nom,
          icon: motif?.icon ?? '•',
          isActive: true,
        })
      }
    })
  }

  const propose = (entree: { isActive?: boolean }): boolean => entree.isActive !== false
  const lieuxProposes = $derived(staffStore.catalog.locations.filter(propose))
  const lieuxRetires = $derived(staffStore.catalog.locations.filter((l) => !propose(l)))
  const servicesProposes = $derived(staffStore.catalog.services.filter(propose))
  const servicesRetires = $derived(staffStore.catalog.services.filter((s) => !propose(s)))
  const categoriesProposees = $derived(staffStore.catalog.categories.filter(propose))
  const categoriesRetirees = $derived(staffStore.catalog.categories.filter((c) => !propose(c)))
  // Les motifs retirés ne reviennent pas de `listKinds`, qui ne rend que les actifs :
  // la liste est donc toujours celle des motifs proposés.
  const motifsProposes = $derived(store.appointmentKinds.filter(propose))

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
  const resume =
    'flex cursor-pointer items-center rounded-xl border-2 border-line bg-white px-4 text-lg font-semibold text-ink'
  const ouvertPour = (genre: Genre, id: string | null): boolean =>
    edition !== null && edition.genre === genre && edition.id === id
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Le catalogue</h1>
  <p class="mb-4 text-lg text-ink-soft">
    Les lieux, les services, les motifs de rendez-vous et les catégories. Ce qui est
    enregistré ici est immédiatement proposé dans le formulaire de création.
  </p>

  {#if !staffStore.isAdmin}
    <p role="status" class="mb-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Seul un administrateur peut modifier le catalogue. Vous pouvez le consulter.
    </p>
  {/if}

  {#if erreur !== null}
    <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
      <span aria-hidden="true">⚠️</span> {erreur}
    </p>
  {/if}

  {#if staffStore.message !== null}
    <div role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg text-brand-900">
      <p class="font-semibold">{staffStore.message}</p>
      {#if bloquantes.length > 0}
        <p class="mt-2">
          Pour le supprimer pour de bon, changez d'abord ces activités :
        </p>
        <ul class="mt-1 list-disc pl-6">
          {#each bloquantes as titre (titre)}
            <li>{titre}</li>
          {/each}
        </ul>
        <p class="mt-2">
          Les séances déjà passées, elles, gardent leur lieu : une entrée qui a servi ne
          peut plus disparaître complètement.
        </p>
      {/if}
    </div>
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

      {#if genre === 'motif'}
        <label for="icone-motif" class="mt-4 mb-2 block text-lg font-semibold text-ink">
          Icône — le patient la verra à côté du nom
        </label>
        <input id="icone-motif" bind:value={icone} maxlength="4" class={champ} style="min-height: 56px;" />
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

      <label class="mt-4 flex items-center gap-3 text-lg text-ink" style="min-height: 56px;">
        <input type="checkbox" bind:checked={actif} class="size-6" />
        Proposé quand on crée une activité
      </label>

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

  <!-- Retirer, remettre, et la confirmation : mêmes gestes pour les trois genres. -->
  {#snippet actions(genre: Genre, id: string, libelle: string, propose: boolean)}
    {#if staffStore.isAdmin}
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-secondary" onclick={() => ouvrir(genre, id)}>Modifier</button>
        {#if propose}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => (aRetirer = { genre, id, nom: libelle })}
          >
            Retirer
          </button>
        {:else}
          <button type="button" class="btn btn-secondary" onclick={() => remettre(genre, id, libelle)}>
            Remettre
          </button>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet explication()}
    <p class="mt-3 text-base text-ink-soft">
      Ces entrées ne sont plus proposées quand on crée quelque chose. Elles restent ici
      parce que des activités ou des séances les utilisent encore et gardent leur nom.
    </p>
  {/snippet}

  {#snippet confirmation(genre: Genre, id: string)}
    {#if aRetirer !== null && aRetirer.genre === genre && aRetirer.id === id}
      <div class="mt-3 rounded-xl border-2 border-line p-4">
        <p class="text-lg text-ink">
          Retirer « {aRetirer.nom} » ? S'il est déjà utilisé quelque part, il sera seulement
          retiré des listes : les activités et les séances existantes le gardent.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" onclick={retirer} disabled={busy}>
            {busy ? 'Un instant…' : 'Oui, retirer'}
          </button>
          <button type="button" class="btn btn-secondary" onclick={() => (aRetirer = null)}>Annuler</button>
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet carteLieu(lieu: Location)}
    <li class="card p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-xl font-bold text-ink">{lieu.name}</h3>
        {@render actions('lieu', lieu.id, lieu.name, lieu.isActive)}
      </div>
      {#if lieu.accessNotes}<p class="text-base text-ink-soft">{lieu.accessNotes}</p>{/if}
      {@render confirmation('lieu', lieu.id)}
      {#if ouvertPour('lieu', lieu.id)}{@render formulaire('lieu', lieu.id)}{/if}
    </li>
  {/snippet}

  {#snippet carteService(service: Service)}
    <li class="card p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-xl font-bold text-ink">{service.name}</h3>
        {@render actions('service', service.id, service.name, service.isActive)}
      </div>
      {@render confirmation('service', service.id)}
      {#if ouvertPour('service', service.id)}{@render formulaire('service', service.id)}{/if}
    </li>
  {/snippet}

  {#snippet carteMotif(motif: AppointmentKind)}
    <li class="card p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-xl font-bold text-ink">
          <span aria-hidden="true">{motif.icon}</span>
          {motif.name}
        </h3>
        {@render actions('motif', motif.id, motif.name, motif.isActive)}
      </div>
      {@render confirmation('motif', motif.id)}
      {#if ouvertPour('motif', motif.id)}{@render formulaire('motif', motif.id)}{/if}
    </li>
  {/snippet}

  {#snippet carteCategorie(categorie: Category)}
    <li class="card p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-xl font-bold text-ink">
          <span aria-hidden="true">{categorie.icon}</span>
          {categorie.name}
        </h3>
        {@render actions('categorie', categorie.id, categorie.name, categorie.isActive !== false)}
      </div>
      {@render confirmation('categorie', categorie.id)}
      {#if ouvertPour('categorie', categorie.id)}{@render formulaire('categorie', categorie.id)}{/if}
    </li>
  {/snippet}

  <!-- Les lieux -->
  <h2 class="mt-6 mb-3 text-2xl font-bold text-ink">Les lieux</h2>
  <ul class="grid gap-3">
    {#each lieuxProposes as lieu (lieu.id)}{@render carteLieu(lieu)}{/each}
  </ul>
  {#if lieuxRetires.length > 0}
    <details class="mt-3">
      <summary class={resume} style="min-height: 56px;">Les lieux retirés ({lieuxRetires.length})</summary>
      {@render explication()}
      <ul class="mt-3 grid gap-3">
        {#each lieuxRetires as lieu (lieu.id)}{@render carteLieu(lieu)}{/each}
      </ul>
    </details>
  {/if}
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
    {#each servicesProposes as service (service.id)}{@render carteService(service)}{/each}
  </ul>
  {#if servicesRetires.length > 0}
    <details class="mt-3">
      <summary class={resume} style="min-height: 56px;">Les services retirés ({servicesRetires.length})</summary>
      {@render explication()}
      <ul class="mt-3 grid gap-3">
        {#each servicesRetires as service (service.id)}{@render carteService(service)}{/each}
      </ul>
    </details>
  {/if}
  {#if staffStore.isAdmin}
    {#if ouvertPour('service', null)}
      <div class="card mt-3 p-4">{@render formulaire('service', null)}</div>
    {:else}
      <button type="button" class="btn btn-primary mt-3" onclick={() => ouvrir('service', null)}>
        <span aria-hidden="true">＋</span> Ajouter un service
      </button>
    {/if}
  {/if}

  <!-- Les motifs de rendez-vous -->
  <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Les motifs de rendez-vous</h2>
  <p class="mb-3 text-lg text-ink-soft">
    Ce que le patient choisit quand il demande à voir quelqu'un. Ces intitulés disent une
    fonction — « Le psychiatre », « Autre » — jamais une spécialité, et jamais une raison.
  </p>
  <ul class="grid gap-3">
    {#each motifsProposes as motif (motif.id)}{@render carteMotif(motif)}{/each}
  </ul>
  {#if staffStore.isAdmin}
    {#if ouvertPour('motif', null)}
      <div class="card mt-3 p-4">{@render formulaire('motif', null)}</div>
    {:else}
      <button type="button" class="btn btn-primary mt-3" onclick={() => ouvrir('motif', null)}>
        <span aria-hidden="true">＋</span> Ajouter un motif
      </button>
    {/if}
  {/if}

  <!-- Les catégories -->
  <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Les catégories</h2>
  <ul class="grid gap-3">
    {#each categoriesProposees as categorie (categorie.id)}{@render carteCategorie(categorie)}{/each}
  </ul>
  {#if categoriesRetirees.length > 0}
    <details class="mt-3">
      <summary class={resume} style="min-height: 56px;">Les catégories retirées ({categoriesRetirees.length})</summary>
      {@render explication()}
      <ul class="mt-3 grid gap-3">
        {#each categoriesRetirees as categorie (categorie.id)}{@render carteCategorie(categorie)}{/each}
      </ul>
    </details>
  {/if}
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
