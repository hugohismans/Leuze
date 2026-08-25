<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { canEditActivity } from '../../lib/domain/activityAccess'
  import type { Occurrence } from '../../lib/domain/types'

  let { occurrence }: { occurrence: Occurrence } = $props()

  /**
   * Annuler une séance, c'est modifier l'activité de quelqu'un.
   *
   * Le bouton était offert à tout le personnel : n'importe quel collègue pouvait annuler
   * l'atelier d'un autre, et les règles Firestore le laissaient passer. Les deux sont
   * corrigés ; ici, on cesse simplement de proposer une porte que le serveur referme.
   *
   * Une séance annulée reste lisible par tous, avec son motif : c'est ce qui permet à la
   * personne inscrite de comprendre. Voir n'est pas modifier.
   */
  const jePeux = $derived(
    canEditActivity(
      { role: staffStore.identity.role, practitionerId: staffStore.identity.practitionerId },
      occurrence,
    ),
  )

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
    {#if jePeux}
      <button type="button" class="btn btn-secondary" onclick={() => staffStore.restoreOccurrence(occurrence.id)}>
        Rétablir
      </button>
    {/if}
  </div>
{:else if !jePeux}
  <!-- Rien : cette séance n'est pas la vôtre. L'écran de l'activité dit qui l'anime. -->
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
        <!--
          La mise en garde est ici, au bord du seul champ libre de cet écran.

          Ce texte part tel quel sur la carte des patients inscrits. C'est le point de
          l'application où une note clinique pourrait entrer sans que rien ne l'arrête, et
          la règle du projet est sans exception : aucune donnée de santé.
        -->
        <label class="text-base font-semibold text-ink" for={`motif-${occurrence.id}`}>
          Autre motif — les patients le liront. N'écrivez rien qui touche à leur santé.
        </label>
        <input
          id={`motif-${occurrence.id}`}
          bind:value={autre}
          maxlength={120}
          autocomplete="off"
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
