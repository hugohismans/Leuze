<script lang="ts">
  import { store } from '../appState.svelte'
  import { formatTime, formatWeekdayLabel, formatDayNumber, todayLocalDate } from '../domain/time'
  import type { DayProgramme } from '../domain/programme'
  import type { LocalDate, Occurrence } from '../domain/types'

  /**
   * Le programme d'une semaine, en sept colonnes.
   *
   * Deux usages, une seule mise en page : l'écran de planification du personnel et la
   * feuille imprimée affichée dans l'unité. Ce qui change entre les deux est réduit au
   * minimum — un bouton d'ajout, quelques couleurs — pour que le soignant reconnaisse
   * à l'écran ce qu'il obtiendra sur le papier.
   */
  let {
    programme,
    onAjouter = undefined,
    onOuvrir = undefined,
  }: {
    programme: DayProgramme[]
    onAjouter?: (date: LocalDate) => void
    onOuvrir?: (occurrence: Occurrence) => void
  } = $props()

  const aujourdhui = todayLocalDate()
</script>

<div class="programme grid gap-3" style="grid-template-columns: repeat(7, minmax(0, 1fr));">
  {#each programme as jour (jour.date)}
    <section class="jour flex min-w-0 flex-col rounded-xl border-2 border-line" class:aujourdhui={jour.date === aujourdhui}>
      <h3 class="en-tete-jour border-b-2 border-line px-3 py-2 font-bold text-ink">
        {formatWeekdayLabel(jour.date)}
        <span class="text-ink-soft">{formatDayNumber(jour.date)}</span>
      </h3>

      <div class="flex flex-1 flex-col gap-2 p-2">
        {#each jour.groups as groupe (groupe.label)}
          <div class="creneau">
            <p class="heure font-bold text-ink">
              {groupe.label}
              {#if groupe.occurrences.length > 1}
                <span class="detail font-normal text-ink-soft">— {groupe.occurrences.length} au même moment</span>
              {/if}
            </p>

            <!--
              Deux activités au même créneau sont posées côte à côte sous le même repère
              horaire : la simultanéité se lit, elle ne se devine pas.
            -->
            <div class="mt-1 grid gap-2" class:simultane={groupe.occurrences.length > 1}>
              {#each groupe.occurrences as occurrence (occurrence.id)}
                {@const categorie = store.categoryOf(occurrence.categoryId)}
                {@const lieu = store.locationOf(occurrence.locationId)}

                {#snippet carte()}
                  <p class="titre font-bold text-ink" class:line-through={occurrence.status === 'cancelled'}>
                    <span aria-hidden="true">{categorie?.icon ?? '•'}</span>
                    {occurrence.title}
                  </p>
                  <!--
                    L'heure de début est déjà le repère du créneau : la répéter ici
                    allongeait la feuille sans rien apprendre. Ne reste que la fin.
                  -->
                  <p class="detail text-ink-soft">
                    jusqu'à {formatTime(occurrence.end)} · {lieu?.name ?? occurrence.locationId}
                  </p>
                  {#if occurrence.status === 'cancelled'}
                    <p class="detail font-semibold text-ink">
                      Annulée — {occurrence.cancellationReason || 'sans motif'}
                    </p>
                  {:else if occurrence.facilitator || occurrence.capacity !== null}
                    <p class="detail text-ink-soft">
                      {#if occurrence.facilitator}avec {occurrence.facilitator}{/if}
                      {#if occurrence.facilitator && occurrence.capacity !== null} · {/if}
                      {#if occurrence.capacity !== null}{occurrence.capacity} places, inscription{/if}
                    </p>
                  {/if}
                {/snippet}

                {@const bordure = `border-color: var(--color-cat-${categorie?.colorToken ?? 'defaut'}, var(--color-line));`}
                {#if onOuvrir}
                  <button
                    type="button"
                    class="activite w-full rounded-lg border-2 p-2 text-left"
                    class:annulee={occurrence.status === 'cancelled'}
                    style={bordure}
                    onclick={() => onOuvrir(occurrence)}
                  >
                    {@render carte()}
                  </button>
                {:else}
                  <div
                    class="activite w-full rounded-lg border-2 p-2"
                    class:annulee={occurrence.status === 'cancelled'}
                    style={bordure}
                  >
                    {@render carte()}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}

        {#if jour.groups.length === 0}
          <p class="detail px-1 text-ink-soft">Rien de prévu</p>
        {/if}

        {#if onAjouter}
          <button
            type="button"
            class="ajouter mt-auto w-full rounded-lg border-2 border-dashed border-line p-2 text-base font-semibold text-brand-700 hover:border-brand-500"
            onclick={() => onAjouter(jour.date)}
          >
            <span aria-hidden="true">＋</span> Ajouter
          </button>
        {/if}
      </div>
    </section>
  {/each}
</div>

<style>
  /* À l'écran, l'échelle du reste de l'application : 18 px de base. */
  .titre,
  .heure,
  .en-tete-jour {
    font-size: 1.125rem;
  }
  .detail {
    font-size: 1rem;
  }

  .jour.aujourdhui {
    border-color: var(--color-brand-500);
  }
  .creneau + .creneau {
    border-top: 1px solid var(--color-line);
    padding-top: 0.5rem;
  }
  .activite.annulee {
    background: var(--color-surface-soft);
  }
  /* Sur écran étroit, les sept colonnes deviennent une liste : pas de scroll horizontal. */
  @media (max-width: 1100px) {
    .programme {
      grid-template-columns: minmax(0, 1fr) !important;
    }
  }

  /*
    Sur papier, l'échelle change : la feuille est lue affichée au mur, à un mètre, et
    doit tenir sur **une** page A4 paysage. Les titres restent bien plus gros que les
    détails, ce qui est ce qui compte pour parcourir la semaine d'un regard.
  */
  @media print {
    .programme {
      gap: 2mm;
    }
    .jour {
      border-width: 1px;
    }
    .jour.aujourdhui {
      border-color: var(--color-line);
    }
    .en-tete-jour {
      font-size: 11pt;
      padding: 1mm 2mm;
      border-bottom-width: 1px;
    }
    .creneau + .creneau {
      padding-top: 1.5mm;
    }
    .heure {
      font-size: 10pt;
    }
    .titre {
      font-size: 10pt;
      line-height: 1.15;
    }
    .detail {
      font-size: 8.5pt;
      line-height: 1.2;
    }
    .activite {
      border-width: 1px;
      padding: 1.5mm;
    }
  }
</style>
