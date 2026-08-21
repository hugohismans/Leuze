<script lang="ts">
  import { store } from '../appState.svelte'
  import { kindName } from '../domain/appointments'
  import { formatDayNumber, formatTime, formatWeekdayLabel } from '../domain/time'
  import { weekGrid, type WeekGrid } from '../domain/weekGrid'
  import type { WeekDay } from '../domain/myWeek'

  /**
   * La semaine du patient en grille horaire : les heures à gauche, les sept jours en
   * colonnes, les activités à leur place réelle.
   *
   * Les trous ne sont pas un défaut de remplissage, c'est l'objet même de la feuille :
   * la personne y écrit à la main ce qu'elle ajoute. D'où les lignes de demi-heure,
   * assez claires pour ne pas gêner la lecture et assez visibles pour guider l'écriture.
   */
  let { week }: { week: WeekDay[] } = $props()

  const grille = $derived<WeekGrid>(weekGrid(week))
  const totalCreneaux = $derived(grille.hours.length * grille.slotsPerHour)
  /**
   * Une amplitude large resserre les créneaux, pour que la feuille tienne sur une page.
   * En dessous de 5 mm on n'écrit plus rien à la main : c'est le plancher.
   */
  const hauteurCreneau = $derived(totalCreneaux <= 20 ? 9 : totalCreneaux <= 26 ? 7 : totalCreneaux <= 32 ? 6 : 5)
</script>

<div
  class="grille"
  style={`--creneaux: ${totalCreneaux}; --par-heure: ${grille.slotsPerHour}; --hauteur: ${hauteurCreneau}mm;`}
>
  <!-- En-tête : une case vide au-dessus des heures, puis les sept jours. -->
  <div class="coin" aria-hidden="true"></div>
  {#each grille.days as jour (jour.date)}
    <div class="entete">
      <span class="jour-nom">{formatWeekdayLabel(jour.date)}</span>
      <span class="jour-num">{formatDayNumber(jour.date)}</span>
    </div>
  {/each}

  <!-- Colonne des heures : un libellé par heure pleine. -->
  {#each grille.hours as heure, i (heure)}
    <div class="heure" style={`grid-row: ${2 + i * grille.slotsPerHour} / span ${grille.slotsPerHour};`}>
      {String(heure).padStart(2, '0')}h
    </div>
  {/each}

  <!-- Fond quadrillé : une case par créneau et par jour, sur laquelle on écrit. -->
  {#each grille.days as jour, colonne (jour.date)}
    {#each Array(totalCreneaux) as _, creneau}
      <div
        class="case"
        class:heure-pleine={creneau % grille.slotsPerHour === 0}
        style={`grid-column: ${2 + colonne}; grid-row: ${2 + creneau};`}
        aria-hidden="true"
      ></div>
    {/each}
  {/each}

  <!-- Les activités et rendez-vous, posés par-dessus. -->
  {#each grille.days as jour, colonne (jour.date)}
    {#each jour.placed as place (place.entry.start.getTime() + place.entry.kind)}
      {@const largeur = 100 / place.lanes}
      <div
        class="bloc"
        class:annule={place.entry.kind === 'activity' && place.entry.cancelled}
        class:rendez-vous={place.entry.kind === 'appointment'}
        style={`grid-column: ${2 + colonne}; grid-row: ${2 + place.fromSlot} / ${2 + place.toSlot};
                width: ${largeur}%; margin-left: ${largeur * place.lane}%;`}
      >
        <p class="titre">
          {#if place.entry.kind === 'activity'}
            {place.entry.title}
          {:else}
            {place.entry.withWhom ?? kindName(store.appointmentKinds, place.entry.kindId)}
          {/if}
        </p>
        <p class="detail">
          {formatTime(place.entry.start)}
          {#if place.entry.kind === 'activity'}
            · {store.locationOf(place.entry.locationId)?.name ?? ''}
          {:else if place.entry.locationId}
            · {store.locationOf(place.entry.locationId)?.name ?? ''}
          {/if}
        </p>
        {#if place.entry.kind === 'activity' && place.entry.cancelled}
          <p class="detail">Annulée</p>
        {/if}
      </div>
    {/each}
  {/each}
</div>

<style>
  .grille {
    display: grid;
    grid-template-columns: 3.2rem repeat(7, minmax(0, 1fr));
    grid-template-rows: auto repeat(var(--creneaux), 1fr);
    /* Hauteur d'un créneau de demi-heure : de quoi écrire une ligne à la main. */
    grid-auto-rows: var(--hauteur);
    border: 1px solid var(--color-ink);
  }

  .coin {
    border-right: 1px solid var(--color-ink);
    border-bottom: 1px solid var(--color-ink);
  }

  .entete {
    border-bottom: 1px solid var(--color-ink);
    border-left: 1px solid var(--color-ink);
    padding: 1mm 1.5mm;
    text-align: center;
    line-height: 1.1;
  }
  .jour-nom {
    display: block;
    font-weight: 700;
  }
  .jour-num {
    display: block;
  }

  .heure {
    grid-column: 1;
    border-right: 1px solid var(--color-ink);
    border-top: 1px solid var(--color-line);
    padding: 0.5mm 1mm 0 0;
    text-align: right;
    font-weight: 600;
  }

  .case {
    border-left: 1px solid var(--color-ink);
    /* Ligne fine à la demi-heure, trait plus marqué à l'heure pleine : la main suit. */
    border-top: 1px dotted var(--color-line);
    min-height: var(--hauteur);
  }
  .case.heure-pleine {
    border-top: 1px solid var(--color-line);
  }

  .bloc {
    /* Posé par-dessus le quadrillage, dans la même case de grille. */
    z-index: 1;
    overflow: hidden;
    padding: 0.5mm 1mm;
    border: 1.5px solid var(--color-ink);
    border-radius: 2px;
    background: #fff;
    line-height: 1.15;
  }
  .bloc.rendez-vous {
    border-style: double;
    border-width: 3px;
  }
  .bloc.annule .titre {
    text-decoration: line-through;
  }
  .titre {
    font-weight: 700;
  }

  /* Tailles : lisibles à l'écran, resserrées sur le papier. */
  .entete,
  .heure {
    font-size: 0.95rem;
  }
  .titre {
    font-size: 0.95rem;
  }
  .detail {
    font-size: 0.85rem;
  }

  @media print {
    .entete,
    .heure {
      font-size: 9pt;
    }
    .titre {
      font-size: 8.5pt;
    }
    .detail {
      font-size: 7.5pt;
    }
  }
</style>
