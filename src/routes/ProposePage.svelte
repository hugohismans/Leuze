<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import {
    DESCRIPTION_MAX,
    PROPOSAL_GUIDANCE,
    PROPOSAL_IDEAS,
    TITLE_MAX,
    cleanProposal,
    patientProposalLabel,
    validateProposal,
  } from '../lib/domain/proposals'
  import { navigate } from '../lib/router.svelte'

  /**
   * Proposer une activité.
   *
   * Le programme se construit pour les patients ; rien n'oblige à ce qu'il se construise
   * sans eux. Quelqu'un qui sait jouer aux échecs, qui tricote ou qui jongle peut
   * proposer une séance — et l'animer, s'il s'en sent capable et si l'équipe est d'accord.
   *
   * Trois choses gouvernent cet écran.
   *
   * **Devant un champ vide, personne ne sait quoi écrire.** Et quelqu'un qui hésite déjà
   * à demander n'insistera pas. D'où le bouton « Des idées ? » : il montre l'échelle
   * attendue — une séance, pas un projet — et la variété admise.
   *
   * **Ce n'est pas un message à un soignant.** Le texte libre est le réceptacle naturel
   * du contenu clinique. On le tient court, on dit à quoi il sert, et on le redit sous le
   * champ plutôt qu'une seule fois en haut.
   *
   * **Une réponse viendra, et l'attente se voit.** Une idée déposée puis oubliée
   * décourage plus sûrement qu'un refus.
   */
  let titre = $state('')
  let description = $state('')
  let animer = $state(false)
  let idees = $state(false)
  let envoi = $state(false)
  let message = $state<string | null>(null)
  let refus = $state(false)

  // On relit en arrivant : une réponse a pu être écrite pendant qu'on était ailleurs.
  store.loadProposals()

  /*
    Réveiller la fonction pendant qu'on écrit : on tape deux phrases avant d'appuyer,
    ce qui laisse tout le temps à une fonction endormie de se relever.
  */
  $effect(() => {
    void store.warmProposal()
  })

  const brouillon = $derived({ title: titre, description, wantsToLead: animer })
  /** Le même contrôle que le serveur, avec les mêmes phrases : voir `domain/proposals`. */
  const controle = $derived(validateProposal(cleanProposal(brouillon)))

  async function envoyer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (envoi) return
    const verdict = validateProposal(cleanProposal(brouillon))
    if (!verdict.ok) {
      refus = true
      message = verdict.message
      return
    }
    envoi = true
    try {
      const resultat = await store.proposeActivity(cleanProposal(brouillon))
      refus = !resultat.ok
      message = resultat.message
      if (resultat.ok) {
        titre = ''
        description = ''
        animer = false
      }
    } finally {
      envoi = false
    }
  }

  const champ =
    'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<div class="mx-auto grid grid-cols-1 max-w-3xl gap-5 px-4 py-5">
  <h1 class="text-3xl font-bold text-ink">Proposer une activité</h1>

  <p class="text-lg text-ink">
    Vous avez une idée d'activité ? Proposez-la. Un soignant la lira, et vous dira si
    elle est retenue. Si vous voulez l'animer vous-même, dites-le : c'est possible.
  </p>

  <!--
    Les exemples ne s'imposent pas : ils s'ouvrent. Un vrai bouton, pas une division
    cliquable, et l'état est annoncé au lecteur d'écran.
  -->
  <div class="card p-4">
    <button
      type="button"
      class="btn btn-secondary"
      aria-expanded={idees}
      aria-controls="exemples-idees"
      onclick={() => (idees = !idees)}
    >
      <span aria-hidden="true">💡</span>
      {idees ? 'Masquer les exemples' : 'Des idées ? Voir des exemples'}
    </button>

    {#if idees}
      <div id="exemples-idees" class="mt-3">
        <p class="mb-2 text-lg text-ink">
          Une activité, c'est une séance d'une heure ou deux, avec quelques personnes.
          Par exemple :
        </p>
        <ul class="grid gap-2">
          {#each PROPOSAL_IDEAS as idee (idee)}
            <li class="text-lg text-ink">
              <span aria-hidden="true">•</span>
              {idee}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  {#if store.hasWaitingProposal}
    <!--
      Une seule idée en attente à la fois. Ce n'est pas une brimade, et on le dit : une
      file où la même personne dépose dix idées cesse d'être lue, et ce sont les idées
      des autres qui en pâtissent.
    -->
    <p role="status" class="card p-5 text-lg text-ink">
      <span aria-hidden="true">⏳</span>
      Votre idée est envoyée, un soignant va la lire. Vous pourrez en proposer une autre
      quand vous aurez la réponse.
    </p>
  {:else}
    <form onsubmit={envoyer} class="card grid gap-4 p-5">
      <div>
        <label for="titre-idee" class="mb-2 block text-lg font-semibold text-ink">
          Le nom de l'activité
        </label>
        <input
          id="titre-idee"
          bind:value={titre}
          class={champ}
          style="min-height: 56px;"
          maxlength={TITLE_MAX}
          placeholder="Tournoi d'échecs"
          autocomplete="off"
        />
      </div>

      <div>
        <label for="texte-idee" class="mb-2 block text-lg font-semibold text-ink">
          Ce qu'on y ferait
        </label>
        <textarea
          id="texte-idee"
          bind:value={description}
          rows="4"
          class={champ}
          maxlength={DESCRIPTION_MAX}
          placeholder="On jouerait aux échecs. Je peux apprendre les règles à ceux qui ne savent pas."
        ></textarea>
        <p id="aide-idee" class="mt-2 text-base text-ink-soft">{PROPOSAL_GUIDANCE}</p>
      </div>

      <!--
        Une case, pas une question ouverte. « Je veux bien l'animer » est une proposition,
        pas un engagement : l'équipe reste seule à en décider, et la phrase le dit.
      -->
      <label class="flex items-start gap-3 rounded-xl border-2 border-line p-3" style="min-height: 56px;">
        <input type="checkbox" bind:checked={animer} class="mt-1 h-6 w-6" />
        <span class="text-lg text-ink">
          Je veux bien l'animer moi-même.
          <span class="block text-base text-ink-soft">
            Vous n'êtes engagé à rien : un soignant en parlera avec vous.
          </span>
        </span>
      </label>

      <button type="submit" class="btn btn-primary btn-huge" disabled={envoi || !controle.ok}>
        {envoi ? 'Un instant…' : 'Envoyer mon idée'}
      </button>

      <!--
        Tant que le formulaire n'est pas complet, on dit ce qui manque plutôt que de
        laisser un bouton gris sans explication.
      -->
      {#if !controle.ok && (titre !== '' || description !== '')}
        <p class="text-base text-ink-soft">{controle.message}</p>
      {/if}
    </form>
  {/if}

  {#if message !== null}
    <p
      role={refus ? 'alert' : 'status'}
      class="rounded-xl p-4 text-lg font-semibold"
      class:bg-brand-100={!refus}
      class:text-brand-900={!refus}
      class:bg-amber-50={refus}
      class:text-ink={refus}
    >
      {message}
    </p>
  {/if}

  {#if store.proposals.length > 0}
    <section>
      <h2 class="mb-2 text-2xl font-bold text-ink">Mes idées</h2>
      <ul class="grid gap-4">
        {#each store.proposals as idee (idee.id)}
          <li class="card p-5">
            <p class="text-xl font-bold text-ink">{idee.title}</p>
            <p class="mt-1 text-lg text-ink">{patientProposalLabel(idee)}</p>
            {#if idee.wantsToLead}
              <p class="mt-1 text-base text-ink-soft">Vous avez proposé de l'animer.</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <button type="button" class="btn btn-secondary" onclick={() => navigate('/')}>
    <span aria-hidden="true">←</span> Retour au calendrier
  </button>
</div>
