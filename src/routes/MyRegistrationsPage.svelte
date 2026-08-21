<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import { kindIcon, kindName, patientStatusLabel } from '../lib/domain/appointments'
  import { formatFullWhen } from '../lib/domain/time'
  import { navigate } from '../lib/router.svelte'

  const registrations = $derived(store.upcomingMine)
  let fermeture = $state(false)

  /**
   * Sur une tablette de salle commune, la personne suivante ne doit rien voir de la
   * précédente. Sans ce bouton, la session restait ouverte indéfiniment.
   */
  async function fermer(): Promise<void> {
    if (fermeture) return
    fermeture = true
    await store.signOut()
    navigate('/')
  }

  // Un rendez-vous peut avoir été fixé pendant que l'écran était ailleurs : on relit
  // en arrivant, plutôt que d'afficher un état périmé.
  store.loadAppointments()
</script>

<div class="mx-auto grid grid-cols-1 max-w-3xl gap-5 px-4 py-5">
  <h1 class="text-3xl font-bold">Mes inscriptions</h1>

  <!--
    Les rendez-vous individuels d'abord : ils sont plus rares, et manquer un rendez-vous
    avec un professionnel est plus lourd de conséquences que manquer un atelier.
    Ils ne figurent que sur cet écran, jamais dans le calendrier commun.
  -->
  {#if store.upcomingAppointments.length > 0 || store.pendingAppointments.length > 0}
    <section>
      <h2 class="mb-2 text-2xl font-bold">Mes rendez-vous</h2>
      <ul class="grid grid-cols-1 gap-4">
        {#each store.upcomingAppointments as rendezVous (rendezVous.id)}
          <li class="card p-5">
            <p class="text-xl font-bold">
              <span aria-hidden="true">{kindIcon(store.appointmentKinds, rendezVous.kindId)}</span>
              {kindName(store.appointmentKinds, rendezVous.kindId)}
            </p>
            <p class="mt-1 text-lg">{patientStatusLabel(rendezVous, store.appointmentKinds)}</p>
            {#if rendezVous.locationId}
              <p class="text-lg text-ink-soft">
                <span aria-hidden="true">📍</span>
                {store.locationOf(rendezVous.locationId)?.name ?? rendezVous.locationId}
              </p>
            {/if}
          </li>
        {/each}
        {#each store.pendingAppointments as demande (demande.id)}
          <li class="card p-5">
            <p class="text-lg">
              <span aria-hidden="true">⏳</span>
              {patientStatusLabel(demande, store.appointmentKinds)}
            </p>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="grid gap-3 sm:grid-cols-2">
    <button type="button" class="btn btn-primary" onclick={() => navigate('/ma-semaine')}>
      <span aria-hidden="true">🗓️</span> Voir ma semaine
    </button>
    <button type="button" class="btn btn-secondary" onclick={() => navigate('/rendez-vous')}>
      <span aria-hidden="true">📅</span> Demander un rendez-vous
    </button>
  </div>

  {#if registrations.length === 0}
    <p class="card p-6 text-xl">
      Vous n'êtes inscrit à aucune activité pour le moment. Vous pouvez en choisir une dans le calendrier.
    </p>
  {:else}
    <ul class="grid grid-cols-1 gap-4">
      {#each registrations as registration (registration.occurrence.id)}
        {@const occurrence = registration.occurrence}
        {@const location = store.locationOf(occurrence.locationId)}
        <li>
          <button
            type="button"
            class="card w-full p-5 text-left"
            onclick={() => navigate(`/activite/${occurrence.id}`)}
          >
            <p class="text-xl font-bold">{occurrence.title}</p>
            <p class="mt-1 text-lg">
              {formatFullWhen(occurrence.localDate, occurrence.start, occurrence.end)}
            </p>
            <p class="mt-1 flex items-center gap-2 text-lg">
              <span aria-hidden="true">📍</span>
              <span>{location?.name ?? 'Lieu à préciser'}</span>
            </p>
            <p class="mt-3">
              {#if occurrence.status === 'cancelled'}
                <span class="badge" style="background: var(--color-stop-bg); color: var(--color-stop-fg);">
                  <span aria-hidden="true">✕</span>
                  <span>Cette activité a été annulée</span>
                </span>
              {:else if registration.status === 'confirmed'}
                <span class="badge" style="background: var(--color-ok-bg); color: var(--color-ok-fg);">
                  <span aria-hidden="true">✓</span>
                  <span>Vous êtes inscrit</span>
                </span>
              {:else}
                <span class="badge" style="background: var(--color-warn-bg); color: var(--color-warn-fg);">
                  <span aria-hidden="true">⏳</span>
                  <span>En attente, position {registration.position}</span>
                </span>
              {/if}
            </p>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <!--
    Fermer son accès : en bas, après ses inscriptions, jamais à côté d'un bouton
    d'inscription — un geste de sortie ne se met pas sur le chemin d'un geste courant.
  -->
  {#if store.signedIn}
    <section class="mt-4 border-t-2 border-line pt-6">
      <h2 class="mb-2 text-2xl font-bold">Quand vous avez fini</h2>
      <p class="mb-3 text-lg text-ink-soft">
        {#if store.firstName}
          Vous êtes connecté sous le prénom {store.firstName}.
        {/if}
        Si vous utilisez une tablette partagée, fermez votre accès avant de la laisser :
        la personne suivante devra entrer son propre code.
      </p>
      <button type="button" class="btn btn-secondary" disabled={fermeture} onclick={fermer}>
        {fermeture ? 'Un instant…' : 'Fermer mon accès'}
      </button>
    </section>
  {/if}
</div>
