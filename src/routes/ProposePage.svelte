<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import {
    DESCRIPTION_MAX,
    PROPOSAL_GUIDANCE,
    PROPOSAL_IDEAS,
    TITLE_MAX,
    remainingNotice,
    cleanProposal,
    patientProposalLabel,
    validateProposal,
  } from '../lib/domain/proposals'

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
  /*
    Le brouillon vit dans le magasin, pas dans l'écran.

    L'écran se démonte au premier appui sur « Retour » — ou sur le bouton « précédent » du
    navigateur — et trois cents caractères tapés sur une tablette disparaissaient sans un
    mot. Il ne quitte pas la mémoire du navigateur : rien n'est enregistré nulle part tant
    que l'idée n'est pas envoyée, et fermer son accès l'efface.
  */
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

  const brouillon = $derived({
    title: store.proposalDraft.title,
    description: store.proposalDraft.description,
    wantsToLead: store.proposalDraft.wantsToLead,
  })
  /** Le même contrôle que le serveur, avec les mêmes phrases : voir `domain/proposals`. */
  const controle = $derived(validateProposal(cleanProposal(brouillon)))

  const avisTitre = $derived(
    remainingNotice(
      TITLE_MAX - store.proposalDraft.title.length,
      'Vous avez atteint la longueur maximale du nom.',
    ),
  )
  const avisDescription = $derived(
    remainingNotice(
      DESCRIPTION_MAX - store.proposalDraft.description.length,
      'Vous avez atteint la longueur maximale. Le texte ne s’allongera plus.',
    ),
  )

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
      if (resultat.ok) store.clearProposalDraft()
    } finally {
      envoi = false
    }
  }

  const champ =
    'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<div class="mx-auto grid grid-cols-1 max-w-3xl gap-5 px-4 py-5">
  <h1 class="text-3xl font-bold text-ink">Proposer une activité</h1>

  <!--
    L'introduction et les exemples ne s'affichent que lorsqu'on peut réellement proposer.

    L'écran demandait « Proposez-la », donnait des exemples pour le faire, puis annonçait
    deux paragraphes plus bas que le geste était fermé. On demandait à quelqu'un de faire
    quelque chose avant de lui dire que ce n'était pas possible.
  -->
  {#if store.may('proposeActivity')}
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
  {/if}

  {#if !store.may('proposeActivity')}
    <!--
      Le bouton du calendrier a disparu, mais l'adresse peut se garder en favori : on dit
      ici aussi ce qu'il faut faire à la place, plutôt que d'afficher un formulaire qui
      serait refusé.
    -->
    <p role="status" class="card p-5 text-lg text-ink">
      <span aria-hidden="true">💬</span>
      {store.refusal('proposeActivity')}
    </p>
  {:else if store.hasWaitingProposal}
    <!--
      Une seule idée en attente à la fois. Ce n'est pas une brimade, et on le dit : une
      file où la même personne dépose dix idées cesse d'être lue, et ce sont les idées
      des autres qui en pâtissent.
    -->
    <p role="status" class="card p-5 text-lg text-ink">
      <span aria-hidden="true">⏳</span>
      Vous pourrez proposer une autre idée quand vous aurez la réponse à celle-ci, plus
      bas.
    </p>
  {:else}
    <form onsubmit={envoyer} class="card grid gap-4 p-5">
      <div>
        <label for="titre-idee" class="mb-2 block text-lg font-semibold text-ink">
          Le nom de l'activité
        </label>
        <input
          id="titre-idee"
          bind:value={store.proposalDraft.title}
          class={champ}
          style="min-height: 56px;"
          maxlength={TITLE_MAX}
          placeholder="Tournoi d'échecs"
          autocomplete="off"
        />
        <!--
          Le compte ne paraît que sur la fin. Les deux champs de cet écran suivaient deux
          règles différentes ; c'est la même, maintenant, et elle vit dans le domaine.
        -->
        {#if avisTitre !== null}
          <p role="status" class="mt-1 text-base text-ink-soft">{avisTitre}</p>
        {/if}
      </div>

      <div>
        <label for="texte-idee" class="mb-2 block text-lg font-semibold text-ink">
          Ce qu'on y ferait
        </label>
        <textarea
          id="texte-idee"
          bind:value={store.proposalDraft.description}
          rows="4"
          class={champ}
          maxlength={DESCRIPTION_MAX}
          aria-describedby="aide-idee"
          placeholder="On jouerait aux échecs. Je peux apprendre les règles à ceux qui ne savent pas."
        ></textarea>
        <!-- « aria-describedby » plus haut : l'identifiant existait, le lien n'avait
             jamais été posé, et la phrase n'était annoncée à personne. -->
        <p id="aide-idee" class="mt-2 text-base text-ink-soft">{PROPOSAL_GUIDANCE}</p>
        <!--
          Le champ s'arrête à trois cents caractères. Il le faisait en silence : un texte
          collé perdait les trois quarts sans un mot, et la coupe tombait au milieu d'un
          mot. Le compte paraît donc à l'approche de la limite — et pas avant, où
          « Il vous reste 300 caractères » sous un champ vide se lit comme une consigne.
        -->
        {#if avisDescription !== null}
          <p role="status" class="mt-1 text-base text-ink-soft">{avisDescription}</p>
        {/if}
      </div>

      <!--
        Une case, pas une question ouverte. « Je veux bien l'animer » est une proposition,
        pas un engagement : l'équipe reste seule à en décider, et la phrase le dit.
      -->
      <label class="flex items-start gap-3 rounded-xl border-2 border-line p-3" style="min-height: 56px;">
        <!-- « shrink-0 » : sans lui, la case s'écrase à treize pixels sur un téléphone. -->
        <input type="checkbox" bind:checked={store.proposalDraft.wantsToLead} class="mt-1 h-6 w-6 shrink-0" />
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
        Tant que le formulaire n'est pas complet, on dit ce qui manque — dès l'arrivée, et
        non seulement après avoir tapé quelque chose. Un bouton gris sans explication au
        premier coup d'œil est ce qui fait quitter l'écran.
      -->
      {#if !controle.ok}
        <p class="text-base text-ink-soft">{controle.message}</p>
      {/if}
    </form>
  {/if}

  <!--
    Le message ne se répète pas.

    Après un envoi réussi, il disait la même chose que le panneau « Votre idée est
    envoyée » juste au-dessus et que la carte de « Mes idées » juste en dessous : trois
    fois la même phrase sur un seul écran de téléphone. Il ne reste que lorsqu'il apprend
    quelque chose — un refus.
  -->
  {#if message !== null && (refus || !store.hasWaitingProposal)}
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
          <!--
            « min-w-0 » avec « break-words » : ni l'un ni l'autre ne suffit seul.

            Un élément de grille a « min-width: auto » — il refuse de rétrécir sous la
            largeur de son plus long mot tant qu'on ne le lui permet pas. Une adresse
            internet collée comme nom d'activité étirait donc la carte au-delà de l'écran,
            et emportait toute la page avec elle : entête et pied de page compris.
          -->
          <li class="card min-w-0 p-5">
            <p class="text-xl font-bold text-ink break-words">{idee.title}</p>
            <p class="mt-1 text-lg text-ink">{patientProposalLabel(idee)}</p>
            <!--
              Le texte envoyé se relit. Le patient ne pouvait plus en lire une ligne, et
              n'apprenait donc jamais qu'il avait été raccourci.
            -->
            {#if idee.description !== ''}
              <p class="mt-2 text-base text-ink-soft break-words whitespace-pre-line">
                {idee.description}
              </p>
            {/if}
            {#if idee.wantsToLead}
              <p class="mt-1 text-base text-ink-soft">Vous avez proposé de l'animer.</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

</div>
