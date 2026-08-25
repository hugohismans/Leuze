<script lang="ts">
  import { store } from '../appState.svelte'
  import { kindIcon, kindName } from '../domain/appointments'
  import { formatDayNumber, formatTime, formatWeekdayLabel } from '../domain/time'
  import { isoWeekdayOf } from '../domain/time'
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

  /**
   * La catégorie donne l'icône et la couleur. L'icône n'est pas décorative : sur une
   * imprimante en noir et blanc, c'est elle qui distingue le sport de la relaxation,
   * la couleur ne portant jamais seule une information.
   */
  const categorieDe = (categoryId: string) => store.categoryOf(categoryId)

  /** Les catégories réellement présentes cette semaine, pour la légende du bas. */
  const legende = $derived.by(() => {
    const vues = new Map<string, { icon: string; name: string; token: string }>()
    for (const jour of grille.days) {
      for (const place of jour.placed) {
        if (place.entry.kind !== 'activity') continue
        const categorie = categorieDe(place.entry.categoryId)
        if (categorie && !vues.has(categorie.id)) {
          vues.set(categorie.id, { icon: categorie.icon, name: categorie.name, token: categorie.colorToken })
        }
      }
    }
    return [...vues.values()]
  })
</script>

<div
  class="grille"
  style={`--creneaux: ${totalCreneaux}; --par-heure: ${grille.slotsPerHour}; --hauteur: ${hauteurCreneau}mm;`}
>
  <!-- En-tête : une case vide au-dessus des heures, puis les sept jours. -->
  <div class="coin" aria-hidden="true"></div>
  {#each grille.days as jour (jour.date)}
    <div class="entete" class:fin-de-semaine={isoWeekdayOf(jour.date) >= 6}>
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
        class:fin-de-semaine={isoWeekdayOf(jour.date) >= 6}
        style={`grid-column: ${2 + colonne}; grid-row: ${2 + creneau};`}
        aria-hidden="true"
      ></div>
    {/each}
  {/each}

  <!-- Les activités et rendez-vous, posés par-dessus. -->
  {#each grille.days as jour, colonne (jour.date)}
    <!--
      La clef est le rang, et non le contenu : deux entrées qui commencent à la même
      minute — deux ateliers à 10h00, c'est le cas courant — donnent la même clef, et
      Svelte arrête alors le rendu. L'écran reste figé sur l'affichage précédent, sans
      un mot. La liste est reconstruite en entier à chaque lecture ; le rang suffit.
    -->
    {#each jour.placed as place, rang (rang)}
      {@const largeur = 100 / place.lanes}
      {@const categorie = place.entry.kind === 'activity' ? categorieDe(place.entry.categoryId) : null}
      {@const teinte = categorie?.colorToken ?? 'defaut'}
      {@const icone =
        place.entry.kind === 'activity'
          ? (categorie?.icon ?? '•')
          : kindIcon(store.appointmentKinds, place.entry.kindId)}
      {@const intitule =
        place.entry.kind === 'activity'
          ? place.entry.title
          : (place.entry.withWhom ?? kindName(store.appointmentKinds, place.entry.kindId))}
      {@const lieu =
        place.entry.locationId === undefined
          ? ''
          : (store.locationOf(place.entry.locationId)?.name ?? '')}
      <div
        class="bloc"
        class:annule={place.entry.kind === 'activity' && place.entry.cancelled}
        class:rendez-vous={place.entry.kind === 'appointment'}
        style={`grid-column: ${2 + colonne}; grid-row: ${2 + place.fromSlot} / ${2 + place.toSlot};
                width: ${largeur}%; margin-left: ${largeur * place.lane}%;
                --teinte-fond: var(--cat-${teinte}-bg, var(--color-surface-soft));
                --teinte-trait: var(--cat-${teinte}-fg, var(--color-ink));`}
      >
        <!--
          Une demi-heure ne laisse qu'une ligne : un rendez-vous chez le psychiatre y
          était coupé au milieu. Le titre et l'heure y tiennent ensemble, et le lieu
          cède la place — la grille dit déjà quand, et le lieu se demande.
        -->
        {#if place.toSlot - place.fromSlot <= 1}
          <p class="titre serre">
            <span class="icone" aria-hidden="true">{icone}</span>
            {intitule}
          </p>
        {:else}
          <p class="titre">
            <span class="icone" aria-hidden="true">{icone}</span>
            {intitule}
          </p>
          <p class="detail">
            {formatTime(place.entry.start)}{lieu ? ` · ${lieu}` : ''}
          </p>
          {#if place.entry.kind === 'activity' && place.entry.cancelled}
            <p class="detail">Annulée</p>
          {/if}
        {/if}
      </div>
    {/each}
  {/each}
</div>

<!--
  La légende ne répète pas la couleur : elle donne le sens des icônes. C'est ce qui
  reste lisible sur une imprimante en noir et blanc, où les teintes se valent toutes.
-->
{#if legende.length > 0}
  <ul class="legende">
    {#each legende as entree (entree.name)}
      <li style={`--teinte-fond: var(--cat-${entree.token}-bg, var(--color-surface-soft));`}>
        <span aria-hidden="true">{entree.icon}</span>
        {entree.name}
      </li>
    {/each}
  </ul>
{/if}

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
    line-height: 1.15;
    background: var(--color-surface-soft);
  }
  .entete.fin-de-semaine {
    background: var(--color-line);
  }
  .jour-nom {
    display: block;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .jour-num {
    display: block;
    font-weight: 700;
    font-size: 1.15em;
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
    border-top: 1px solid var(--color-ink-soft);
  }
  /* Samedi et dimanche à peine teintés : on les trouve sans les chercher. */
  .case.fin-de-semaine {
    background: color-mix(in srgb, var(--color-surface-soft) 55%, #fff);
  }

  .bloc {
    /* Posé par-dessus le quadrillage, dans la même case de grille. */
    z-index: 1;
    overflow: hidden;
    padding: 0.5mm 1mm 0.5mm 1.5mm;
    border: 1px solid var(--teinte-trait, var(--color-ink));
    /* La bande épaisse à gauche donne la catégorie d'un coup d'œil, de loin. */
    border-left: 1.6mm solid var(--teinte-trait, var(--color-ink));
    border-radius: 2px;
    background: var(--teinte-fond, #fff);
    line-height: 1.15;
  }
  .bloc.rendez-vous {
    /* Un rendez-vous n'est pas une activité de groupe : le trait double le dit. */
    border-style: double;
    border-left-style: solid;
    border-width: 2px;
    border-left-width: 1.6mm;
    background: #fff;
  }
  .bloc.annule {
    background: #fff;
  }
  .bloc.annule .titre {
    text-decoration: line-through;
  }
  .titre {
    font-weight: 700;
    color: var(--teinte-trait, var(--color-ink));
  }
  .icone {
    font-style: normal;
  }
  /*
    Une demi-heure ne laisse presque pas de place. On garde le nom entier, plus petit et
    sur deux lignes s'il le faut : l'heure se lit sur la colonne de gauche, le nom ne se
    devine pas. Un rendez-vous coupé à « Docteur … » ne sert à personne.
  */
  .titre.serre {
    font-size: 0.8em;
    line-height: 1.05;
  }
  .detail {
    color: var(--color-ink);
  }

  .legende {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5mm 3mm;
    margin-top: 2mm;
    font-size: 1rem;
  }
  .legende li {
    display: flex;
    align-items: center;
    gap: 1mm;
    padding: 0.5mm 2mm;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    background: var(--teinte-fond, #fff);
  }

  /*
    Tailles : jamais sous le plancher du projet à l'écran, resserrées sur le papier.

    La grille était à 0,95 rem — dix-sept pixels — y compris sur l'écran d'un patient. Le
    papier, lui, garde ses points : une semaine entière doit tenir sur une feuille, et
    c'est une contrainte d'impression, pas un choix de lisibilité.
  */
  .entete,
  .heure {
    font-size: 1rem;
  }
  .titre {
    font-size: 1rem;
  }
  .detail {
    font-size: 1rem;
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
    .legende {
      font-size: 8pt;
      margin-top: 1mm;
      gap: 0.8mm 2.5mm;
    }
    /* L'en-tête des jours se resserre : la place gagnée va aux lignes où l'on écrit. */
    .entete {
      padding: 0.5mm 1mm;
    }
    /*
      La grille absorbe la hauteur restante. Les créneaux s'étirent ou se resserrent
      autour de leur taille voulue, sans jamais descendre sous 4 mm — en dessous, on
      n'écrit plus rien à la main.
    */
    .grille {
      flex: 1;
      min-height: 0;
      grid-template-rows: auto repeat(var(--creneaux), minmax(4mm, 1fr));
      grid-auto-rows: minmax(4mm, 1fr);
    }
    .case {
      min-height: 4mm;
    }
    .legende li {
      padding: 0 1.5mm;
    }
    /* Les aplats doivent sortir : sans cela, la bande de catégorie disparaît. */
    .bloc,
    .entete,
    .case.fin-de-semaine,
    .legende li {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
