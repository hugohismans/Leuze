<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { unitFilterNotice } from '../../lib/domain/unit'

  /**
   * La case qui rend l'hôpital entier.
   *
   * Un écran filtré qui ne dit pas qu'il l'est est un écran qui ment : on cherche une
   * demande ou une personne, elle n'y est pas, et l'on en conclut qu'elle n'existe plus.
   * Le nombre de lignes écartées est donc écrit, jamais suggéré par une nuance de
   * couleur, et une seule case les ramène toutes.
   *
   * La case vit dans le magasin et non ici : passer des rendez-vous aux patients ne doit
   * pas la redemander. Elle n'accorde aucun droit — le compte voyait déjà tout ; le
   * réglage ne fait que retirer du bruit.
   */
  /*
    `singulier` et `pluriel` nomment ce qui est caché — « demande », « personne ».
    Sans eux, la phrase disait « en ont 10 » sans que rien alentour ne dise dix quoi.
  */
  const {
    hidden,
    singulier,
    pluriel,
  }: { hidden: number; singulier: string; pluriel: string } = $props()

  const avis = $derived(unitFilterNotice(staffStore.unitLabel, hidden, singulier, pluriel))
</script>

{#if staffStore.unitId !== null}
  <div class="mb-5 rounded-xl border-2 border-line bg-surface-soft p-4">
    <label class="flex items-start gap-3" style="min-height: 56px;">
      <input type="checkbox" class="mt-1 h-6 w-6" bind:checked={staffStore.voirToutesLesUnites} />
      <span>
        <span class="block text-lg font-semibold text-ink">Voir toutes les unités</span>
        <span class="block text-base text-ink-soft">
          {#if staffStore.voirToutesLesUnites}
            Vous voyez tout l'hôpital.
          {:else if avis !== null}
            {avis}
          {:else}
            Vous voyez {staffStore.unitLabel}.
          {/if}
        </span>
      </span>
    </label>
  </div>
{/if}
