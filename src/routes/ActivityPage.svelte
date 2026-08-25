<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import {
    registrationActionLabel,
    registrationBlock,
    registrationBlockMessage,
    registrationInvitation,
  } from '../lib/domain/capacity'
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
  async function inscrire(): Promise<void> {
    if (!occurrence || busy) return
    busy = true
    try {
      const result = await store.registerTo(occurrence.id)
      messageIsError = !result.ok
      if (result.ok) {
        const pris =
          result.status === 'confirmed'
            ? 'Vous êtes inscrit.'
            : `Vous êtes sur la liste d'attente, en position ${result.position}.`
        // Une autre activité tombe au même moment : l'inscription est prise, et on le dit
        // dans la foulée plutôt que de laisser la personne le découvrir le jour même.
        message = result.warning === undefined ? pris : `${pris} ${result.warning}`
      } else {
        message = result.message
      }
    } finally {
      busy = false
    }
  }

  async function desinscrire(): Promise<void> {
    if (!occurrence || busy) return
    busy = true
    try {
      const result = await store.unregisterFrom(occurrence.id)
      messageIsError = !result.ok
      message = result.ok ? 'Vous êtes désinscrit.' : result.message
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
            <p class="mt-1">
              Vous étiez inscrit. Il n'y a rien à faire : un soignant peut vous proposer
              autre chose.
            </p>
          {:else}
            <p class="mt-1">Un soignant peut vous proposer autre chose.</p>
          {/if}
        </div>
      {:else if mine}
        <div
          class="card p-5 text-xl"
          style={mine.status === 'confirmed'
            ? 'background: var(--color-ok-bg); color: var(--color-ok-fg); border-color: var(--color-ok-fg);'
            : 'background: var(--color-warn-bg); color: var(--color-warn-fg); border-color: var(--color-warn-fg);'}
        >
          {#if mine.status === 'confirmed'}
            <p><strong>✓ Vous êtes inscrit</strong></p>
            <p class="mt-1">
              {formatFullWhen(occurrence.localDate, occurrence.start, occurrence.end)}, {location?.name ?? ''}
            </p>
            <!--
              C'est ici que la confusion coûterait le plus cher : « je suis inscrit au
              yoga » n'est pas « je suis inscrit au yoga de ce mardi ». Une activité qui
              revient chaque semaine demande une inscription à chaque fois.
            -->
            <p class="mt-1 text-lg">Cette inscription vaut pour cette séance uniquement.</p>
          {:else}
            <p><strong>Vous êtes sur la liste d'attente</strong></p>
            <p class="mt-1">
              Vous êtes en position {mine.position}. Un soignant vous préviendra si une place se libère.
            </p>
          {/if}
        </div>

        {#if store.may('unregister')}
          <button type="button" class="btn btn-secondary" disabled={busy} onclick={desinscrire}>
            {mine.status === 'confirmed' ? 'Me désinscrire' : "Me retirer de la liste d'attente"}
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
      {:else if !store.may('register')}
        <p class="rounded-xl bg-surface-soft p-4 text-lg text-ink">{store.refusal('register')}</p>
      {:else if block === null}
        <button type="button" class="btn btn-primary btn-huge" disabled={busy} onclick={inscrire}>
          {registrationActionLabel(occurrence)}
        </button>
        {#if invitation !== null}
          <p class="text-lg text-ink-soft">{invitation}</p>
        {/if}
        {#if complet}
          <p class="text-lg text-ink-soft">
            Cette activité est complète. En vous inscrivant, vous êtes placé sur la liste d'attente.
          </p>
        {/if}
        <!--
          Une activité peut revenir chaque semaine ; l'inscription, elle, ne vaut que
          pour la séance affichée. Le dire évite qu'une personne croie être inscrite
          pour toutes les fois suivantes et ne revienne pas.
        -->
        <p class="text-lg text-ink-soft">Vous vous inscrivez pour cette séance seulement.</p>
      {:else}
        <p class="card p-5 text-xl">{registrationBlockMessage(block)}</p>
      {/if}

      <p
        aria-live="polite"
        class="text-xl font-semibold"
        class:sr-only={!messageIsError}
        style={messageIsError ? 'color: var(--color-stop-fg);' : ''}
      >
        {message}
      </p>
    </section>
  {:else}
    <p class="card p-6 text-lg" aria-live="polite">Chargement…</p>
  {/if}
</div>
