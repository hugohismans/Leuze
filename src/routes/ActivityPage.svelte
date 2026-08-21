<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import { registrationBlock, registrationBlockMessage } from '../lib/domain/capacity'
  import { formatDuration, formatFullWhen, formatTime } from '../lib/domain/time'
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

  $effect(() => {
    const id = occurrenceId
    void store.occurrences
    store.getOccurrence(id).then((found) => {
      occurrence = found
      notFound = found === null
    })
  })

  const category = $derived(occurrence ? store.categoryOf(occurrence.categoryId) : null)
  const location = $derived(occurrence ? store.locationOf(occurrence.locationId) : null)
  const mine = $derived(occurrence ? store.myStatusFor(occurrence.id) : null)
  const block = $derived(occurrence ? registrationBlock(occurrence, new Date()) : null)
  const complet = $derived(
    occurrence !== null && occurrence.capacity !== null && occurrence.confirmedCount >= occurrence.capacity,
  )
  const durationMin = $derived(
    occurrence ? Math.round((occurrence.end.getTime() - occurrence.start.getTime()) / 60_000) : 0,
  )

  async function inscrire(): Promise<void> {
    if (!occurrence || busy) return
    busy = true
    const result = await store.registerTo(occurrence.id)
    messageIsError = !result.ok
    if (result.ok) {
      message =
        result.status === 'confirmed'
          ? 'Vous êtes inscrit.'
          : `Vous êtes sur la liste d'attente, en position ${result.position}.`
    } else {
      message = result.message
    }
    await store.refreshOccurrence(occurrence.id)
    occurrence = await store.getOccurrence(occurrence.id)
    busy = false
  }

  async function desinscrire(): Promise<void> {
    if (!occurrence || busy) return
    busy = true
    const result = await store.unregisterFrom(occurrence.id)
    messageIsError = !result.ok
    message = result.ok ? 'Vous êtes désinscrit.' : result.message
    await store.refreshOccurrence(occurrence.id)
    occurrence = await store.getOccurrence(occurrence.id)
    busy = false
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

      {#if mine}
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

        <button type="button" class="btn btn-secondary" disabled={busy} onclick={desinscrire}>
          {mine.status === 'confirmed' ? 'Me désinscrire' : "Me retirer de la liste d'attente"}
        </button>
      {:else if block === null}
        <button type="button" class="btn btn-primary btn-huge" disabled={busy} onclick={inscrire}>
          {complet ? "Je m'inscris sur la liste d'attente" : "Je m'inscris"}
        </button>
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
      {:else if block === 'full-no-waitlist' || block === 'cancelled' || block === 'past'}
        <p class="card p-5 text-xl">{registrationBlockMessage(block)}</p>
      {:else}
        <p
          class="card p-5 text-xl"
          style="background: var(--color-ok-bg); color: var(--color-ok-fg); border-color: var(--color-ok-fg);"
        >
          Vous pouvez venir sans vous inscrire. Présentez-vous à {formatTime(occurrence.start)}.
        </p>
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
