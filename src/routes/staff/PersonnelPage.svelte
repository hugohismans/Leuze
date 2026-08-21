<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { uniqueSlug } from '../../lib/domain/slug'
  import {
    availabilityLabel,
    normalizeAvailability,
    weekdayName,
  } from '../../lib/domain/availability'
  import type { AvailabilityWindow, IsoWeekday, Practitioner } from '../../lib/domain/types'
  import { canSeePractitionerPlanning } from '../../lib/domain/appointmentAccess'
  import type { Account } from '../../lib/domain/impersonation'
  import { navigate } from '../../lib/router.svelte'
  import { enClair } from '../../lib/erreurs'

  /**
   * Le personnel : qui anime, qui reçoit.
   *
   * Écran jumeau de celui des patients, et pour la même raison — c'est une liste de
   * personnes, pas un réglage. Les lieux et les catégories restent dans le catalogue ;
   * les gens ont leur propre page.
   *
   * ⚠️ Aucune donnée personnelle au-delà de ce qui s'affiche sur un planning : un nom
   * tel qu'il sera lu par les patients, et une fonction. Ni adresse, ni téléphone, ni
   * matricule — l'écran ne propose même pas de champ pour en saisir.
   */
  let nom = $state('')
  let poste = $state('')
  let motifId = $state('')
  let busy = $state(false)
  let erreur = $state<string | null>(null)

  /**
   * Les comptes existants, pour savoir qui est administrateur.
   *
   * Un intervenant n'est pas un compte : la case « Administrateur » n'a de sens que si
   * quelqu'un se connecte avec ce nom-là. On lit donc les comptes, et la case n'apparaît
   * que sur les fiches qui en ont un.
   */
  let comptes = $state<Account[]>([])

  $effect(() => {
    if (!staffStore.isAdmin || comptes.length > 0) return
    void staffStore
      .listAccounts()
      .then((valeur) => (comptes = valeur))
      .catch(() => undefined)
  })

  const compteDe = (practitionerId: string): Account | undefined =>
    comptes.find((c) => c.kind === 'staff' && c.practitionerId === practitionerId)

  async function basculerAdministrateur(compte: Account, administrateur: boolean): Promise<void> {
    await tenter(async () => {
      const ok = await staffStore.setStaffRole(compte.uid, administrateur ? 'admin' : 'staff', {
        ...(compte.practitionerId === undefined ? {} : { practitionerId: compte.practitionerId }),
        firstName: compte.label,
      })
      // La liste vient du serveur : on la relit plutôt que de deviner ce qu'il a écrit.
      if (ok) comptes = await staffStore.listAccounts()
    })
  }

  /** Qui regarde : la règle d'accès aux plannings vit dans le domaine, pas ici. */
  const moi = $derived({
    role: staffStore.identity.role,
    practitionerId: staffStore.identity.practitionerId,
  })

  /** Modification d'une personne existante, dépliée sous sa fiche. */
  let edition = $state<string | null>(null)
  /** Retrait, confirmé sur place. */
  let aRetirer = $state<string | null>(null)
  /** Accès : l'adresse saisie, puis le mot de passe affiché une seule fois. */
  let accesPour = $state<string | null>(null)
  let adresse = $state('')
  let motDePasse = $state<{ email: string; valeur: string } | null>(null)

  /**
   * Les plages où quelqu'un reçoit : une semaine type, saisie par l'intéressé lui-même —
   * il est le seul à savoir quand il est là — ou par l'administrateur. Les règles
   * Firestore appliquent la même chose : chacun ne touche qu'à ses propres plages, et à
   * rien d'autre de sa fiche.
   */
  let plagesOuvertes = $state<string | null>(null)
  let brouillon = $state<AvailabilityWindow[]>([])
  const JOURS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7]

  const peutModifierLesPlages = (practitionerId: string): boolean =>
    staffStore.isAdmin || staffStore.identity.practitionerId === practitionerId

  function ouvrirLesPlages(personne: Practitioner): void {
    plagesOuvertes = personne.id
    const existantes = personne.availability ?? []
    // Une liste vide n'offrirait rien à remplir : on pose une première plage.
    brouillon =
      existantes.length > 0
        ? existantes.map((f) => ({ ...f }))
        : [{ weekday: 2, from: '09:00', to: '12:00' }]
  }

  async function basculerAutoAccept(practitionerId: string, valeur: boolean): Promise<void> {
    await tenter(async () => {
      await staffStore.setAutoAccept(practitionerId, valeur)
    })
  }

  async function enregistrerLesPlages(practitionerId: string): Promise<void> {
    // Le domaine remet de l'ordre avant l'enregistrement : tri, fusion, rejet du vide.
    const propres = normalizeAvailability(brouillon)
    await tenter(async () => {
      await staffStore.saveAvailability(practitionerId, propres)
      plagesOuvertes = null
    })
  }

  const enPoste = $derived(store.practitioners.filter((p) => p.isActive))
  const retires = $derived(store.practitioners.filter((p) => !p.isActive))

  async function tenter(action: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    erreur = null
    try {
      await action()
    } catch (error) {
      erreur = enClair(error)
    } finally {
      busy = false
    }
  }

  function ouvrirEdition(id: string): void {
    const personne = store.practitionerOf(id)
    edition = id
    nom = personne?.name ?? ''
    poste = personne?.role ?? ''
    motifId = personne?.kindId ?? ''
  }

  function fermer(): void {
    edition = null
    nom = ''
    poste = ''
    motifId = ''
  }

  async function enregistrer(): Promise<void> {
    if (nom.trim().length === 0) return
    const id = edition ?? uniqueSlug(nom, store.practitioners.map((p) => p.id))
    await tenter(async () => {
      await staffStore.savePractitioner({
        id,
        name: nom.trim(),
        role: poste.trim(),
        ...(motifId ? { kindId: motifId } : {}),
        isActive: true,
      })
      fermer()
    })
  }

  async function retirer(id: string): Promise<void> {
    await tenter(async () => {
      await staffStore.removeCatalogEntry('practitioner', id)
      aRetirer = null
    })
  }

  async function remettre(id: string): Promise<void> {
    const personne = store.practitionerOf(id)
    if (personne === null) return
    await tenter(async () => {
      await staffStore.savePractitioner({ ...personne, isActive: true })
    })
  }

  async function donnerAcces(id: string): Promise<void> {
    if (adresse.trim().length === 0) return
    const email = adresse.trim()
    await tenter(async () => {
      const valeur = await staffStore.createStaffAccount(email, id)
      accesPour = null
      adresse = ''
      motDePasse = valeur === null ? null : { email, valeur }
    })
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Le personnel</h1>
  <p class="mb-4 text-lg text-ink-soft">
    Les personnes qui animent une activité ou reçoivent en rendez-vous. Leur nom est
    proposé partout où il faut en désigner une, et chacune a son planning.
  </p>

  {#if !staffStore.isAdmin}
    <p role="status" class="mb-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Seul un administrateur peut modifier cette liste. Vous pouvez la consulter.
    </p>
  {/if}

  {#if erreur !== null}
    <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
      <span aria-hidden="true">⚠️</span> {erreur}
    </p>
  {/if}

  {#if motDePasse !== null}
    <!-- Affiché une seule fois, comme un code patient : rien ne le retrouve ensuite. -->
    <div class="card mb-4 border-4 border-brand-700 p-5">
      <h2 class="text-2xl font-bold text-ink">Mot de passe provisoire</h2>
      <p class="my-3 text-center text-4xl font-bold tracking-widest text-brand-900">{motDePasse.valeur}</p>
      <p class="text-lg text-ink">À remettre avec l'adresse {motDePasse.email}.</p>
      <p class="mt-2 text-base text-ink-soft">
        Il ne sera plus affiché. S'il est perdu, refaites « Lui donner un accès » : le
        compte existant sera relié sans changer son mot de passe.
      </p>
      <button type="button" class="btn btn-primary mt-3" onclick={() => (motDePasse = null)}>
        J'ai noté le mot de passe
      </button>
    </div>
  {/if}

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.isAdmin && edition === null}
    <form
      class="card mb-6 p-4"
      onsubmit={(event) => {
        event.preventDefault()
        void enregistrer()
      }}
    >
      <h2 class="mb-3 text-2xl font-bold text-ink">Ajouter une personne</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label for="nom" class="mb-2 block text-lg font-semibold text-ink">
            Son nom — les patients le liront
          </label>
          <input id="nom" bind:value={nom} class={champ} style="min-height: 56px;" autocomplete="off" />
        </div>
        <div>
          <label for="poste" class="mb-2 block text-lg font-semibold text-ink">Son poste</label>
          <input
            id="poste"
            bind:value={poste}
            class={champ}
            style="min-height: 56px;"
            placeholder="Psychiatre, kinésithérapeute, animateur"
          />
        </div>
      </div>

      <label for="motif" class="mt-4 mb-2 block text-lg font-semibold text-ink">
        Motif de rendez-vous correspondant — facultatif
      </label>
      <select id="motif" bind:value={motifId} class={champ} style="min-height: 56px;">
        <option value="">Aucun</option>
        {#each store.appointmentKinds as motif (motif.id)}
          <option value={motif.id}>{motif.icon} {motif.name}</option>
        {/each}
      </select>
      <p class="mt-1 text-base text-ink-soft">
        Sert à proposer cette personne en premier quand on fixe un rendez-vous de ce motif.
      </p>

      <p class="mt-3 text-base text-ink-soft">
        N'inscrivez ni adresse, ni téléphone, ni matricule. Un nom et un poste suffisent
        à s'y retrouver.
      </p>

      <button type="submit" class="btn btn-primary mt-4" disabled={busy || nom.trim().length === 0}>
        {busy ? 'Un instant…' : 'Ajouter'}
      </button>
    </form>
  {/if}

  {#snippet plages(personne: Practitioner)}
    {@const resume = availabilityLabel(personne.availability ?? [])}
    <div class="mt-3 rounded-xl border-2 border-line p-4">
      <h4 class="text-lg font-semibold text-ink">Quand cette personne reçoit</h4>
      <p class="mt-1 text-base text-ink-soft">
        {resume === ''
          ? 'Rien n’est indiqué. Personne ne sait donc quand proposer un rendez-vous.'
          : resume}
      </p>

      {#if peutModifierLesPlages(personne.id)}
        {#if plagesOuvertes === personne.id}
          <ul class="mt-3 grid gap-2">
            {#each brouillon as plage, index (index)}
              <li class="flex flex-wrap items-end gap-2">
                <div>
                  <label for={`jour-${index}`} class="mb-1 block text-base font-semibold text-ink">
                    Le jour
                  </label>
                  <select
                    id={`jour-${index}`}
                    class={champ}
                    style="min-height: 56px; width: auto;"
                    value={String(plage.weekday)}
                    onchange={(event) =>
                      (brouillon[index]!.weekday = Number(event.currentTarget.value) as IsoWeekday)}
                  >
                    {#each JOURS as jour (jour)}
                      <option value={String(jour)}>{weekdayName(jour)}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label for={`de-${index}`} class="mb-1 block text-base font-semibold text-ink">De</label>
                  <input
                    id={`de-${index}`}
                    type="time"
                    bind:value={brouillon[index]!.from}
                    class={champ}
                    style="min-height: 56px; width: auto;"
                  />
                </div>
                <div>
                  <label for={`a-${index}`} class="mb-1 block text-base font-semibold text-ink">À</label>
                  <input
                    id={`a-${index}`}
                    type="time"
                    bind:value={brouillon[index]!.to}
                    class={champ}
                    style="min-height: 56px; width: auto;"
                  />
                </div>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={() => (brouillon = brouillon.filter((_, i) => i !== index))}
                >
                  Retirer cette plage
                </button>
              </li>
            {/each}
          </ul>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => (brouillon = [...brouillon, { weekday: 2, from: '09:00', to: '12:00' }])}
            >
              <span aria-hidden="true">＋</span> Ajouter une plage
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              onclick={() => enregistrerLesPlages(personne.id)}
            >
              {busy ? 'Un instant…' : 'Enregistrer'}
            </button>
            <button type="button" class="btn btn-secondary" onclick={() => (plagesOuvertes = null)}>
              Annuler
            </button>
          </div>
          <p class="mt-2 text-base text-ink-soft">
            Une semaine type. Cela n'interdit rien : un rendez-vous peut toujours être fixé
            en dehors, l'application prévient simplement.
          </p>
        {:else}
          <button
            type="button"
            class="btn btn-secondary mt-3"
            onclick={() => ouvrirLesPlages(personne)}
          >
            {resume === '' ? 'Indiquer ses disponibilités' : 'Modifier ses disponibilités'}
          </button>
        {/if}

        <!--
          L'acceptation automatique tient dans la même boîte que les plages : c'est la
          même question posée deux fois — quand cette personne reçoit, et si l'on peut
          retenir une place sans la déranger. Sans plage déclarée, elle ne servirait à
          rien, et l'écran ne la propose pas.
        -->
        {#if resume !== ''}
          <label class="bascule mt-3">
            <input
              type="checkbox"
              checked={personne.autoAccept === true}
              disabled={busy}
              onchange={(event) => basculerAutoAccept(personne.id, event.currentTarget.checked)}
            />
            <span>
              <strong>Accepter automatiquement les demandes de rendez-vous.</strong>
              La première place libre dans ces plages est retenue dès la demande, et le
              patient sait tout de suite quand il vient. Sinon, la demande attend une
              réponse.
            </span>
          </label>
        {/if}
      {/if}
    </div>
  {/snippet}

  {#snippet fiche(id: string)}
    {@const personne = store.practitionerOf(id)}
    {#if personne !== null}
      <li class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 class="text-xl font-bold text-ink">{personne.name}</h3>
            <p class="text-base text-ink-soft">{personne.role}</p>
          </div>
        </div>

        {#if personne.isActive}{@render plages(personne)}{/if}

        <div class="mt-3 flex flex-wrap gap-2">
          {#if canSeePractitionerPlanning(moi, personne.id)}
            <!--
              Le planning de quelqu'un nomme les patients qu'il reçoit : chacun ouvre le
              sien, l'administrateur ouvre ceux de tous. Proposer le bouton aux autres
              reviendrait à annoncer une porte que le serveur referme.
            -->
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => navigate(`/soignant/intervenant/${personne.id}`)}
            >
              {staffStore.identity.practitionerId === personne.id ? 'Voir mon planning' : 'Voir son planning'}
            </button>
          {/if}
          {#if staffStore.isAdmin}
            {#if personne.isActive}
              <button type="button" class="btn btn-secondary" onclick={() => ouvrirEdition(personne.id)}>
                Modifier
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                onclick={() => { accesPour = personne.id; adresse = ''; motDePasse = null }}
              >
                {compteDe(personne.id) === undefined ? 'Lui donner un accès' : 'Refaire un accès'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={() => (aRetirer = personne.id)}>
                Retirer
              </button>
            {:else}
              <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => remettre(personne.id)}>
                Remettre
              </button>
            {/if}
          {/if}
        </div>

        {#if staffStore.isAdmin && compteDe(personne.id) !== undefined}
          {@const compte = compteDe(personne.id)!}
          <!--
            Le rôle vit dans le jeton, pas dans un document : le changer déconnecte la
            personne, qui devra se reconnecter. On le dit, plutôt que de la laisser
            constater que « rien n'a changé ».
          -->
          <label class="bascule mt-3">
            <input
              type="checkbox"
              checked={compte.role === 'admin'}
              disabled={busy || compte.uid === staffStore.identity.uid}
              onchange={(event) => basculerAdministrateur(compte, event.currentTarget.checked)}
            />
            <span>
              <strong>Administrateur.</strong>
              {#if compte.uid === staffStore.identity.uid}
                C'est votre compte : vous ne pouvez pas retirer vos propres droits.
              {:else}
                Voit tous les plannings et tous les rendez-vous, gère les patients, le
                personnel et le catalogue. La personne devra se reconnecter pour que le
                changement s'applique.
              {/if}
            </span>
          </label>
        {/if}

        {#if aRetirer === personne.id}
          <div class="mt-3 rounded-xl border-2 border-line p-4">
            <p class="text-lg text-ink">
              Retirer {personne.name} ? Si des activités ou des rendez-vous la nomment, elle
              cessera seulement d'être proposée : rien ne sera effacé.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn btn-primary" disabled={busy} onclick={() => retirer(personne.id)}>
                {busy ? 'Un instant…' : 'Oui, retirer'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={() => (aRetirer = null)}>Annuler</button>
            </div>
          </div>
        {/if}

        {#if accesPour === personne.id}
          <form
            class="mt-3 rounded-xl border-2 border-line p-4"
            onsubmit={(event) => {
              event.preventDefault()
              void donnerAcces(personne.id)
            }}
          >
            <label for={`acces-${personne.id}`} class="mb-2 block text-lg font-semibold text-ink">
              Son adresse électronique
            </label>
            <input
              id={`acces-${personne.id}`}
              type="email"
              autocomplete="off"
              bind:value={adresse}
              class={champ}
              style="min-height: 56px;"
            />
            <p class="mt-2 text-base text-ink-soft">
              Si un compte existe déjà avec cette adresse, il est simplement relié à
              {personne.name} — son mot de passe ne change pas.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="submit" class="btn btn-primary" disabled={busy || adresse.trim().length === 0}>
                {busy ? 'Un instant…' : "Créer l'accès"}
              </button>
              <button type="button" class="btn btn-secondary" onclick={() => (accesPour = null)}>Annuler</button>
            </div>
          </form>
        {/if}

        {#if edition === personne.id}
          <form
            class="mt-3 rounded-xl border-2 border-line p-4"
            onsubmit={(event) => {
              event.preventDefault()
              void enregistrer()
            }}
          >
            <label for={`nom-${personne.id}`} class="mb-2 block text-lg font-semibold text-ink">Son nom</label>
            <input id={`nom-${personne.id}`} bind:value={nom} class={champ} style="min-height: 56px;" />

            <label for={`poste-${personne.id}`} class="mt-4 mb-2 block text-lg font-semibold text-ink">
              Son poste
            </label>
            <input id={`poste-${personne.id}`} bind:value={poste} class={champ} style="min-height: 56px;" />

            <label for={`motif-${personne.id}`} class="mt-4 mb-2 block text-lg font-semibold text-ink">
              Motif de rendez-vous correspondant — facultatif
            </label>
            <select id={`motif-${personne.id}`} bind:value={motifId} class={champ} style="min-height: 56px;">
              <option value="">Aucun</option>
              {#each store.appointmentKinds as motif (motif.id)}
                <option value={motif.id}>{motif.icon} {motif.name}</option>
              {/each}
            </select>

            <div class="mt-3 flex flex-wrap gap-2">
              <button type="submit" class="btn btn-primary" disabled={busy || nom.trim().length === 0}>
                {busy ? 'Un instant…' : 'Enregistrer'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={fermer}>Annuler</button>
            </div>
            <p class="mt-2 text-base text-ink-soft">
              Identifiant : {personne.id} — il ne change pas.
            </p>
          </form>
        {/if}
      </li>
    {/if}
  {/snippet}

  {#if enPoste.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      Personne n'est encore enregistré. Ajoutez-en une ci-dessus : elle sera proposée
      dans les activités et les rendez-vous.
    </p>
  {:else}
    <ul class="grid gap-3">
      {#each enPoste as personne (personne.id)}{@render fiche(personne.id)}{/each}
    </ul>
  {/if}

  {#if retires.length > 0}
    <details class="mt-6">
      <summary
        class="flex cursor-pointer items-center rounded-xl border-2 border-line bg-white px-4 text-lg font-semibold text-ink"
        style="min-height: 56px;"
      >
        Les personnes retirées ({retires.length})
      </summary>
      <p class="mt-3 text-base text-ink-soft">
        Elles ne sont plus proposées, mais restent nommées sur les activités et les
        rendez-vous passés : leur retirer leur nom réécrirait l'histoire.
      </p>
      <ul class="mt-3 grid gap-3">
        {#each retires as personne (personne.id)}{@render fiche(personne.id)}{/each}
      </ul>
    </details>
  {/if}
</section>

<style>
  /* Toute la ligne est cliquable, la case est grande, et le focus clavier se voit. */
  .bascule {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    min-height: 56px;
    padding: 0.9rem 1rem;
    border: 2px solid var(--color-line);
    border-radius: 0.85rem;
    background: var(--color-surface);
    font-size: 1.0625rem;
    line-height: 1.45;
    color: var(--color-ink);
    cursor: pointer;
  }
  .bascule:hover {
    background: var(--color-surface-soft);
  }
  .bascule:focus-within {
    outline: 3px solid var(--color-brand-500);
    outline-offset: 2px;
  }
  .bascule input {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    margin-top: 0.15rem;
    accent-color: var(--color-brand-900);
  }
</style>
