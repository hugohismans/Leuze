<script lang="ts">
  import logo from '../brand/acis-logo-bleu.svg'
  import type { WeekDay } from '../domain/myWeek'
  import WeekGrid from './WeekGrid.svelte'

  /**
   * Une feuille de semaine, prête à imprimer : en-tête, grille horaire, une page.
   *
   * Trois écrans la produisent — la semaine du patient, la fiche d'une personne, la pile
   * du service. Une seule mise en page pour les trois : ce qu'un soignant imprime pour
   * quelqu'un doit être exactement ce que cette personne obtient elle-même.
   */
  let { titre, sousTitre, week }: { titre: string; sousTitre: string; week: WeekDay[] } = $props()
</script>

<article class="feuille feuille-semaine">
  <header class="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-2 border-line pb-3">
    <div>
      <h2 class="text-3xl font-bold text-ink">{titre}</h2>
      <p class="text-lg text-ink">{sousTitre}</p>
    </div>
    <img src={logo} alt="ACIS" class="h-10 w-auto" />
  </header>

  <div class="grille-papier">
    <WeekGrid {week} />
  </div>
</article>

<style>
  /* À l'écran, la grille ne sert à rien : c'est une mise en page de papier. */
  .grille-papier {
    display: none;
  }
  @media print {
    .grille-papier {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
  }
</style>
