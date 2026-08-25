<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import {
    becomeParticipantLabel,
    becomeSpectatorLabel,
    registeredLabel,
    wasRegisteredLabel,
    registrationActionLabel,
    registrationBlock,
    registrationBlockMessage,
    registrationInvitation,
    fullButWatchableMessage,
    spectatorActionLabel,
    spectatorLabel,
    unregisterActionLabel,
    type RegistrationKind,
  } from '../lib/domain/capacity'
  import { myBusyAt, patientRegistrationDecision } from '../lib/domain/conflicts'
  import { kindName } from '../lib/domain/appointments'
  import { formatDuration, formatFullWhen } from '../lib/domain/time'
  import type { Occurrence } from '../lib/domain/types'
  import AudienceBadge from '../lib/ui/AudienceBadge.svelte'
  import CategoryBadge from '../lib/ui/CategoryBadge.svelte'
  import PlacesBadge from '../lib/ui/PlacesBadge.svelte'
  import SitePlan from '../lib/ui/SitePlan.svelte'

  let { occurrenceId }: { occurrenceId: string } = $props()

  let occurrence = $state<Occurrence | null>(null)
  let notFound = $state(false)
  let busy = $state(false)
  let message = $state('')
  /*
    Une réussite peut porter un avertissement, et celui-là doit se voir.

    « Vous êtes inscrit. Attention : vous êtes déjà inscrit à « Jonglerie »… » partait
    dans un paragraphe caché à tous sauf aux lecteurs d'écran, parce que le message d'une
    réussite l'est toujours. La phrase était juste, personne ne la lisait.
  */
  let messageAvertit = $state(false)
  /** Un message d'erreur reste visible ; une confirmation est déjà affichée par le panneau. */
  let messageIsError = $state(false)

  /*
    La fiche affichée est toujours celle qu'on a demandée en dernier.

    Cet effet se rejoue à chaque relecture du programme, et l'on ouvre parfois deux fiches
    coup sur coup. Sans précaution, la réponse la plus lente arrive après la plus récente
    et l'écrase : on lit alors la fiche d'une autre activité, sous le bon titre. C'est le
    même défaut que celui qui décochait les prénoms en réunion — il vaut partout où l'on
    attend une réponse.

    Quand le programme contient déjà la séance, on la prend telle quelle : la relire
    coûtait une lecture réseau à chaque rafraîchissement, pour la même valeur.
  */
  $effect(() => {
    const id = occurrenceId
    const dejaLa = store.occurrences.find((o) => o.id === id) ?? null
    if (dejaLa !== null) {
      occurrence = dejaLa
      notFound = false
      return
    }
    let perimee = false
    void store.getOccurrence(id).then((found) => {
      if (perimee) return
      occurrence = found
      notFound = found === null
    })
    return () => {
      perimee = true
    }
  })

  /*
    Réveiller la fonction d'inscription pendant qu'on lit la fiche.

    Elle s'arrête au bout d'un quart d'heure sans usage, et le premier appel suivant paie
    son démarrage — plusieurs secondes, exactement au moment où l'on appuie sur « Je
    m'inscris ». On lit la fiche bien avant de décider : le réveil a tout le temps.
  */
  $effect(() => {
    void store.warmRegistration()
  })

  const category = $derived(occurrence ? store.categoryOf(occurrence.categoryId) : null)
  const location = $derived(occurrence ? store.locationOf(occurrence.locationId) : null)
  const mine = $derived(occurrence ? store.myStatusFor(occurrence.id) : null)
  const block = $derived(occurrence ? registrationBlock(occurrence, new Date()) : null)
  /*
    Ce qui empêche de venir regarder — et le nombre de places n'en fait pas partie.

    C'est toute la raison d'être du geste : un spectateur ne prend la place de personne,
    donc une séance complète lui reste ouverte. Ne restent que les refus qui valent pour
    tout le monde : une séance annulée, une séance déjà commencée.
  */
  const blockRegard = $derived(
    occurrence ? registrationBlock(occurrence, new Date(), 'spectator') : null,
  )
  /** Vrai quand le message du geste répète le motif déjà affiché juste au-dessus. */
  const dejaDit = $derived(
    message !== '' && block !== null && message === registrationBlockMessage(block),
  )
  /*
    Ce que la personne a déjà à cette heure-là, dit AVANT le geste.

    L'avertissement existait, et le serveur le renvoyait — mais avec la réponse à
    l'inscription, c'est-à-dire une fois inscrit. Et le message d'une inscription réussie
    est « sr-only » : il n'était donc ni vu, ni lu, sauf par un lecteur d'écran. Constaté
    en service : quelqu'un s'est inscrit à deux activités de la même heure sans que rien
    ne l'en avertisse.

    Le calcul se refait ici, à partir de ce que l'écran a déjà — ses inscriptions et ses
    rendez-vous. Aucune lecture de plus. Le serveur reste seul juge de ce qui est refusé :
    ceci n'est qu'un avertissement, et un avertissement se donne avant.
  */
  const dejaPris = $derived(
    occurrence === null
      ? []
      : myBusyAt(
          { id: occurrence.id, start: occurrence.start, end: occurrence.end },
          store.mine,
          store.appointments.map((rendezVous) => ({
            ...rendezVous,
            kindLabel: kindName(store.appointmentKinds, rendezVous.kindId),
          })),
        ),
  )
  const decision = $derived(
    mine === null ? patientRegistrationDecision(dejaPris) : ({ kind: 'libre' } as const),
  )
  /*
    La même question, posée pour l'autre geste.

    Venir regarder occupe autant qu'une inscription — on ne regarde pas deux activités à
    la fois, ni quoi que ce soit pendant un rendez-vous. Seule la phrase change : « … pour
    venir ici » plutôt que « … pour m'inscrire ici ».
  */
  const decisionRegard = $derived(
    mine === null
      ? patientRegistrationDecision(dejaPris, 'spectator')
      : ({ kind: 'libre' } as const),
  )

  /*
    La question posée avant d'échanger.

    On ne peut pas être à deux endroits à la fois : s'inscrire ici demande de quitter
    l'autre activité, et cela ne se fait pas dans le dos de quelqu'un. Le panneau nomme ce
    qui va être quitté, et les deux réponses sont des phrases entières — jamais « Oui » et
    « Non », qui ne disent pas à quoi l'on répond.
  */
  let echangeDemande = $state(false)
  /** De quel geste parle le panneau d'échange : s'inscrire, ou venir regarder. */
  let echangePour = $state<RegistrationKind>('participant')
  /** La décision dont parle le panneau ouvert — celle du bouton sur lequel on a appuyé. */
  const decisionCourante = $derived(echangePour === 'spectator' ? decisionRegard : decision)

  const invitation = $derived(occurrence ? registrationInvitation(occurrence) : null)
  const complet = $derived(
    occurrence !== null && occurrence.capacity !== null && occurrence.confirmedCount >= occurrence.capacity,
  )
  const durationMin = $derived(
    occurrence ? Math.round((occurrence.end.getTime() - occurrence.start.getTime()) / 60_000) : 0,
  )

  /*
    Le bouton répond dans le geste.

    Il attendait quatre allers-retours enchaînés avant de changer d'état, et restait grisé
    sans rien dire pendant ce temps — ce qui se lit comme « l'application ne m'a pas
    entendu ». C'est le magasin qui tient désormais l'affichage immédiat et la correction
    en cas de refus ; l'écran ne fait plus que dire ce qui s'est passé. La relecture du
    nombre de places part derrière, sans que personne ne l'attende.
  */
  async function inscrire(
    replacing: string[] = [],
    as: RegistrationKind = 'participant',
  ): Promise<void> {
    if (!occurrence || busy) return
    echangeDemande = false
    busy = true
    try {
      const result = await store.registerTo(occurrence.id, { replacing, as })
      messageIsError = !result.ok
      if (result.ok) {
        /*
          Les mêmes mots que la carte, et pour la même raison.

          Ce paragraphe est `sr-only` quand tout va bien : il n'est pas vu, il est
          **entendu**. Il annonçait « Vous êtes inscrit » sur une activité sans
          inscription, dont la carte affiche « Vous avez noté que vous venez » — la
          contradiction corrigée à l'écran survivait dans le canal audio, là où
          justement personne ne pouvait la relever.
        */
        const pris =
          result.status === 'spectator'
            ? `${spectatorLabel()}.`
            : result.status === 'confirmed'
              ? `${registeredLabel(occurrence)}.`
              : `Vous êtes sur la liste d'attente, en position ${result.position}.`
        /*
          L'échange se dit, il ne se devine pas.

          Quitter une activité pour en prendre une autre est un vrai changement dans la
          semaine de quelqu'un : la phrase nomme celle qu'on vient de quitter, pour que
          personne ne le découvre trois jours plus tard sur « Ma semaine ».
        */
        messageAvertit = result.swapMessage !== undefined
        message = result.swapMessage === undefined ? pris : `${pris} ${result.swapMessage}`
      } else {
        messageAvertit = false
        message = result.message
      }
    } finally {
      busy = false
    }
  }

  /**
   * Un seul chemin pour les deux gestes : soit on demande d'abord ce qu'on quitte, soit
   * on agit. Sans cela, chaque bouton refaisait le raisonnement à sa façon.
   */
  function demander(as: RegistrationKind): void {
    const quoi = as === 'spectator' ? decisionRegard : decision
    if (quoi.kind === 'activites') {
      echangePour = as
      echangeDemande = true
      return
    }
    void inscrire([], as)
  }

  async function desinscrire(): Promise<void> {
    if (!occurrence || busy) return
    busy = true
    try {
      const result = await store.unregisterFrom(occurrence.id)
      messageIsError = !result.ok
      messageAvertit = false
      // Le message vient de la couche de données, comme partout ailleurs : l'écran ne
      // récrit pas une phrase que le serveur a déjà écrite, sinon les deux divergent.
      message = result.message
    } finally {
      busy = false
    }
  }
</script>

<div class="mx-auto grid grid-cols-1 max-w-3xl gap-5 px-4 py-5">
  {#if notFound}
    <p class="card p-6 text-lg">
      Cette activité n'a pas été trouvée. Utilisez le bouton « Retour au calendrier » ci-dessus.
    </p>
  {:else if occurrence}
    <header class="grid grid-cols-1 gap-3">
      <CategoryBadge {category} size="large" />
      <h1 class="text-3xl font-bold" class:line-through={occurrence.status === 'cancelled'}>
        {occurrence.title}
      </h1>
      <p class="text-xl">
        {formatFullWhen(occurrence.localDate, occurrence.start, occurrence.end)}
        <span class="text-ink-soft">({formatDuration(durationMin)})</span>
      </p>
    </header>

    {#if occurrence.status === 'cancelled'}
      <p
        class="card p-5 text-xl"
        style="background: var(--color-stop-bg); color: var(--color-stop-fg); border-color: var(--color-stop-fg);"
      >
        <strong>Cette activité est annulée.</strong>
        {#if occurrence.cancellationReason}
          <br />Motif : {occurrence.cancellationReason}
        {/if}
      </p>
    {/if}

    <!-- Le lieu est l'information la plus utile de cette page : il passe avant la description. -->
    <section class="card p-5" aria-labelledby="titre-lieu" style="border-color: var(--color-brand-700);">
      <h2 id="titre-lieu" class="text-lg font-bold text-ink-soft">Où cela se passe</h2>
      <p class="mt-1 flex items-center gap-3 text-2xl font-bold">
        <span aria-hidden="true">📍</span>
        <span>{location?.name ?? 'Lieu à préciser'}</span>
      </p>
      {#if location?.building || location?.floor}
        <p class="mt-1 text-lg text-ink-soft">
          {[location?.building, location?.floor].filter(Boolean).join(' — ')}
        </p>
      {/if}
      {#if location?.accessNotes}
        <p class="mt-3 text-lg">{location.accessNotes}</p>
      {/if}
    </section>

    <SitePlan planZoneId={location?.planZoneId} />

    <section aria-labelledby="titre-description">
      <h2 id="titre-description" class="text-lg font-bold text-ink-soft">En quoi cela consiste</h2>
      <p class="mt-1 text-xl">{occurrence.description}</p>
    </section>

    {#if occurrence.facilitator}
      <section aria-labelledby="titre-animateur">
        <h2 id="titre-animateur" class="text-lg font-bold text-ink-soft">Qui anime</h2>
        <p class="mt-1 text-xl">{occurrence.facilitator}</p>
      </section>
    {/if}

    <section aria-labelledby="titre-places" class="grid grid-cols-1 gap-3">
      <h2 id="titre-places" class="text-lg font-bold text-ink-soft">Les places</h2>
      <div class="flex flex-wrap gap-2">
        <PlacesBadge {occurrence} />
        <AudienceBadge {occurrence} />
      </div>
    </section>

    <!-- Zone d'inscription : un seul bouton, énorme, texte explicite. -->
    <section aria-labelledby="titre-inscription" class="grid grid-cols-1 gap-3">
      <h2 id="titre-inscription" class="sr-only">Inscription</h2>

      {#if occurrence.status === 'cancelled'}
        <!--
          Une séance annulée passe avant tout le reste.

          Le bloc vert « ✓ Vous êtes inscrit » s'affichait juste sous « Cette activité est
          annulée » : deux affirmations contraires à trois centimètres l'une de l'autre,
          la seconde en vert et en gros. On rappelle donc ici, et là seulement, que
          l'inscription tenait — mais que la séance n'aura pas lieu.
        -->
        <div
          class="card p-5 text-xl"
          style="background: var(--color-warn-bg); color: var(--color-warn-fg); border-color: var(--color-warn-fg);"
        >
          <p><strong>Cette séance n'aura pas lieu.</strong></p>
          {#if mine}
            <!--
              Ce que la personne avait fait, dans les mots qu'elle a lus en le faisant.
              La phrase était « Vous étiez inscrit » pour tout le monde — y compris pour
              qui s'était noté sur une activité sans inscription, et pour qui attendait
              une place.
            -->
            <p class="mt-1">
              {wasRegisteredLabel(occurrence, mine.status)}. Il n'y a rien à faire : un
              soignant peut vous proposer autre chose.
            </p>
          {:else}
            <p class="mt-1">Un soignant peut vous proposer autre chose.</p>
          {/if}
        </div>
      {:else if mine}
        {@const spectateur = mine.status === 'spectator'}
        <div
          class="card p-5 text-xl"
          style={mine.status === 'confirmed'
            ? 'background: var(--color-ok-bg); color: var(--color-ok-fg); border-color: var(--color-ok-fg);'
            : spectateur
              ? 'background: var(--color-brand-100); color: var(--color-brand-900); border-color: var(--color-brand-700);'
              : 'background: var(--color-warn-bg); color: var(--color-warn-fg); border-color: var(--color-warn-fg);'}
        >
          {#if mine.status === 'confirmed'}
            <!-- Les mêmes mots que le bouton : « Je note que je viens » et « Vous êtes
                 inscrit » se contredisaient sur la même carte. -->
            <p><strong>✓ {registeredLabel(occurrence)}</strong></p>
            <p class="mt-1">
              {formatFullWhen(occurrence.localDate, occurrence.start, occurrence.end)}, {location?.name ?? ''}
            </p>
            <!--
              C'est ici que la confusion coûterait le plus cher : « je suis inscrit au
              yoga » n'est pas « je suis inscrit au yoga de ce mardi ». Une activité qui
              revient chaque semaine demande une inscription à chaque fois.
            -->
            <p class="mt-1 text-lg">
              {occurrence.registrationRequired
                ? 'Cette inscription vaut pour cette séance uniquement.'
                : 'Cela vaut pour cette séance uniquement.'}
            </p>
          {:else if spectateur}
            <!--
              Ni « inscrit », ni « en attente » : la personne vient regarder, et c'est un
              état à part entière. Le dire dans ses propres mots évite qu'elle croie
              n'avoir qu'à moitié réussi quelque chose.
            -->
            <p><strong><span aria-hidden="true">👀</span> {spectatorLabel()}</strong></p>
            <p class="mt-1">
              {formatFullWhen(occurrence.localDate, occurrence.start, occurrence.end)}, {location?.name ?? ''}
            </p>
            <p class="mt-1 text-lg">
              Vous ne prenez la place de personne. Venez, installez-vous, et repartez quand
              vous voulez.
            </p>
            <p class="mt-1 text-lg">Cela vaut pour cette séance uniquement.</p>
          {:else}
            <p><strong>Vous êtes sur la liste d'attente</strong></p>
            <p class="mt-1">
              Vous êtes en position {mine.position}. Un soignant vous préviendra si une place se libère.
            </p>
          {/if}
        </div>

        <!--
          Changer d'avis, dans les deux sens.

          Ce n'est pas une seconde inscription : la ligne existante change de nature, en
          un seul geste, côté serveur. Se désinscrire d'abord pour se réinscrire ensuite
          ferait perdre sa place à qui voulait seulement passer devant, et rien ne la lui
          rendrait si quelqu'un la prenait entre-temps.
        -->
        {#if store.may('register')}
          {#if spectateur && block === null}
            <button
              type="button"
              class="btn btn-secondary"
              disabled={busy}
              onclick={() => demander('participant')}
            >
              {becomeParticipantLabel(occurrence)}
            </button>
          {:else if !spectateur && blockRegard === null}
            <button
              type="button"
              class="btn btn-secondary"
              disabled={busy}
              onclick={() => demander('spectator')}
            >
              <span aria-hidden="true">👀</span>
              {becomeSpectatorLabel(mine.status)}
            </button>
          {/if}
        {/if}

        {#if store.may('unregister')}
          <button type="button" class="btn btn-secondary" disabled={busy} onclick={desinscrire}>
            {mine.status === 'confirmed'
              ? unregisterActionLabel(occurrence)
              : spectateur
                ? unregisterActionLabel(occurrence, 'spectator')
                : "Me retirer de la liste d'attente"}
          </button>
        {:else}
          <!--
            Fermer n'est pas cacher : un bouton disparu sans explication se lit comme une
            panne, et la question qu'on se pose alors n'est pas « pourquoi » mais
            « comment je fais ».
          -->
          <p class="rounded-xl bg-surface-soft p-4 text-lg text-ink">
            {store.refusal('unregister')}
          </p>
        {/if}
      {:else if block !== null && blockRegard !== null}
        <!--
          Le motif qui compte l'emporte sur la phrase de refus.

          « Les inscriptions se prennent avec un soignant » passait avant tout : pour une
          séance d'hier ou une séance annulée, on envoyait quelqu'un parler d'une activité
          qui n'aurait pas lieu — et lui faire perdre son temps, au soignant comme à lui.

          Complet, en revanche, n'est plus un cul-de-sac : venir regarder reste possible,
          et ce cas passe donc à la branche du dessous.
        -->
        <p class="rounded-xl bg-surface-soft p-4 text-lg text-ink">
          {registrationBlockMessage(block)}
        </p>
      {:else if !store.may('register')}
        <p class="rounded-xl bg-surface-soft p-4 text-lg text-ink">{store.refusal('register')}</p>
      {:else if decision.kind === 'rendez-vous'}
        <!--
          Un rendez-vous ferme la porte, et il n'y a rien à proposer.

          Un patient ne décommande pas un rendez-vous tout seul : quelqu'un a bloqué du
          temps pour lui, et cela se parle. On ne montre donc pas de bouton d'inscription
          — proposer un geste qui sera refusé ne sert personne — et l'on dit à qui
          s'adresser. Venir regarder ne change rien : on ne regarde pas non plus une
          activité pendant un rendez-vous.
        -->
        <p
          role="status"
          class="rounded-xl p-4 text-lg font-semibold"
          style="background: var(--color-stop-bg); color: var(--color-stop-fg);"
        >
          <span aria-hidden="true">📅</span>
          {decision.message}
        </p>
      {:else if echangeDemande && decisionCourante.kind === 'activites'}
        <!--
          Deux activités à la même heure : on ne peut pas être aux deux.

          L'inscription n'est pas refusée sèchement — on propose l'échange, et
          l'application le fait en un seul geste. La question est posée avant, dans un
          panneau qui nomme ce qui va être quitté : personne ne doit découvrir trois
          jours plus tard qu'il n'est plus inscrit ailleurs.

          Le panneau parle du geste demandé, et de lui seul : `decisionCourante` suit le
          bouton sur lequel on vient d'appuyer, et les phrases changent avec lui.
        -->
        <div
          role="group"
          aria-label="Vous êtes déjà pris à ce moment-là"
          class="rounded-xl border-4 p-4"
          style="background: var(--color-warn-bg); border-color: var(--color-warn-fg);"
        >
          <p class="text-lg font-semibold" style="color: var(--color-warn-fg);">
            <span aria-hidden="true">⚠️</span>
            {decisionCourante.message}
          </p>
          <p class="mt-2 text-lg" style="color: var(--color-warn-fg);">Que voulez-vous faire ?</p>
          <div class="mt-3 grid gap-2">
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              onclick={() =>
                inscrire(
                  decisionCourante.kind === 'activites'
                    ? decisionCourante.aQuitter.map((e) => e.occurrenceId ?? '')
                    : [],
                  echangePour,
                )}
            >
              {busy ? 'Un instant…' : decisionCourante.actionLabel}
            </button>
            <button type="button" class="btn btn-secondary" onclick={() => (echangeDemande = false)}>
              Ne rien changer
            </button>
          </div>
        </div>
      {:else}
        <!--
          Une seule fois la même phrase.

          L'avertissement et le panneau la portaient tous les deux, l'un sous l'autre : le
          refus était juste, le doublon donnait l'impression d'un écran cassé. Le panneau
          prend le relais quand il s'ouvre — il occupe désormais sa propre branche.
        -->
        {#if decision.kind === 'activites'}
          <p
            class="rounded-xl p-4 text-lg font-semibold"
            style="background: var(--color-warn-bg); color: var(--color-warn-fg);"
          >
            <span aria-hidden="true">⚠️</span>
            {decision.message}
          </p>
        {/if}

        {#if block === null}
          <button
            type="button"
            class="btn btn-primary btn-huge"
            disabled={busy}
            onclick={() => demander('participant')}
          >
            {registrationActionLabel(occurrence)}
          </button>
        {:else}
          <!--
            Complet, et la liste d'attente est fermée : on le dit, puis on propose la seule
            chose qui reste possible. La phrase de refus habituelle finit par « Adressez-
            vous à un soignant » — un mauvais conseil depuis qu'il y a, juste en dessous,
            un bouton que la personne peut appuyer elle-même.
          -->
          <p class="rounded-xl bg-surface-soft p-4 text-lg text-ink">
            {blockRegard === null ? fullButWatchableMessage() : registrationBlockMessage(block)}
          </p>
        {/if}

        <!--
          Venir sans prendre de place.

          Second bouton, jamais le premier : la plupart des gens viennent pour faire, et
          l'écran doit d'abord proposer cela. Mais il est là pour tout le monde, y compris
          sur une activité complète — c'est justement là qu'il sert le plus.
        -->
        {#if blockRegard === null}
          <button
            type="button"
            class="btn btn-secondary"
            disabled={busy}
            onclick={() => demander('spectator')}
          >
            <span aria-hidden="true">👀</span>
            {spectatorActionLabel()}
          </button>
          <p class="text-lg text-ink-soft">
            Vous venez, vous vous installez, et vous regardez. Vous ne prenez la place de
            personne.
          </p>
        {/if}

        {#if invitation !== null}
          <p class="text-lg text-ink-soft">{invitation}</p>
        {/if}
        {#if complet && block === null}
          <p class="text-lg text-ink-soft">
            Cette activité est complète. En vous inscrivant, vous êtes placé sur la liste d'attente.
          </p>
        {/if}
        <!--
          Une activité peut revenir chaque semaine ; l'inscription, elle, ne vaut que
          pour la séance affichée. Le dire évite qu'une personne croie être inscrite
          pour toutes les fois suivantes et ne revienne pas.
        -->
        <p class="text-lg text-ink-soft">Cela vaut pour cette séance seulement.</p>
      {/if}

      <!--
        Le message du geste ne répète pas le motif déjà affiché juste au-dessus.

        La séance venait d'être relue et l'écran connaissait désormais l'annulation : on
        lisait donc deux fois d'affilée « Cette activité est annulée. Un soignant peut vous
        proposer autre chose. » Le refus était juste ; le doublon donnait l'impression d'un
        écran cassé. Il reste lu à voix haute pour les lecteurs d'écran, qui n'ont pas vu
        le premier apparaître.
      -->
      <!--
        Une réussite qui porte un avertissement se voit, elle aussi.

        La condition ne connaissait que deux cas — réussite muette, ou refus — et cachait
        donc « Attention : vous êtes déjà inscrit à « Jonglerie », de 14h30 à 15h30 » dans
        le canal des lecteurs d'écran. C'est ainsi que quelqu'un a pu s'inscrire à deux
        activités de la même heure sans qu'un mot ne le lui dise.
      -->
      {#if message !== '' && !dejaDit && (messageIsError || messageAvertit)}
        <p
          aria-live="polite"
          class="rounded-xl p-4 text-lg font-semibold"
          style={messageIsError
            ? 'background: var(--color-stop-bg); color: var(--color-stop-fg);'
            : 'background: var(--color-warn-bg); color: var(--color-warn-fg);'}
        >
          <span aria-hidden="true">{messageIsError ? '✕' : '⚠️'}</span>
          {message}
        </p>
      {:else}
        <!-- Muet à l'écran, mais toujours annoncé : le lecteur d'écran n'a rien vu passer. -->
        <p aria-live="polite" class="sr-only">{message}</p>
      {/if}
    </section>
  {:else}
    <p class="card p-6 text-lg" aria-live="polite">Chargement…</p>
  {/if}
</div>
