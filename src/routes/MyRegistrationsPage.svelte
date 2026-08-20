<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import { formatFullWhen } from '../lib/domain/time'
  import { navigate } from '../lib/router.svelte'

  const registrations = $derived(store.mine)
</script>

<div class="mx-auto grid grid-cols-1 max-w-3xl gap-5 px-4 py-5">
  <h1 class="text-3xl font-bold">Mes inscriptions</h1>

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
</div>
