<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import type { Occurrence } from '../../lib/domain/types'

  let { occurrence }: { occurrence: Occurrence } = $props()

  /** Deux clics : « Annuler », puis le motif. Les motifs courants évitent de taper. */
  const MOTIFS = [
    "L'animateur est absent",
    "La salle n'est pas disponible",
    'Trop peu de participants',
  ]

  let ouvert = $state(false)
  let autre = $state('')
  let saisieLibre = $state(false)

  async function annuler(motif: string): Promise<void> {
    if (motif.trim().length === 0) return
    ouvert = false
    saisieLibre = false
    autre = ''
    await staffStore.cancelOccurrence(occurrence.id, motif.trim())
  }
</script>

{#if occurrence.status === 'cancelled'}
  <div class="flex flex-wrap items-center gap-3">
    <p class="text-base font-semibold text-ink">
      <span aria-hidden="true">🚫</span> Annulée — {occurrence.cancellationReason || 'sans motif'}
    </p>
    <button type="button" class="btn btn-secondary" onclick={() => staffStore.restoreOccurrence(occurrence.id)}>
      Rétablir
    </button>
  </div>
{:else if !ouvert}
  <button type="button" class="btn btn-secondary" onclick={() => (ouvert = true)}>
    Annuler cette séance
  </button>
{:else}
  <div class="rounded-xl border-2 border-line p-3">
    <p class="mb-2 text-base font-semibold text-ink">Pourquoi cette séance est-elle annulée ?</p>
    <div class="flex flex-col gap-2">
      {#each MOTIFS as motif (motif)}
        <button type="button" class="btn btn-secondary w-full" onclick={() => annuler(motif)}>
          {motif}
        </button>
      {/each}

      {#if saisieLibre}
        <label class="text-base font-semibold text-ink" for={`motif-${occurrence.id}`}>
          Autre motif — les patients le liront
        </label>
        <input
          id={`motif-${occurrence.id}`}
          bind:value={autre}
          class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
          style="min-height: 56px;"
        />
        <button type="button" class="btn btn-primary w-full" disabled={autre.trim().length === 0} onclick={() => annuler(autre)}>
          Annuler la séance
        </button>
      {:else}
        <button type="button" class="btn btn-secondary w-full" onclick={() => (saisieLibre = true)}>
          Autre motif…
        </button>
      {/if}

      <button type="button" class="btn btn-secondary w-full" onclick={() => (ouvert = false)}>
        Ne rien changer
      </button>
    </div>
  </div>
{/if}
