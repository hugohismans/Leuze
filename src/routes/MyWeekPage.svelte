<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import logo from '../lib/brand/acis-logo-bleu.svg'
  import { kindIcon, kindName } from '../lib/domain/appointments'
  import { myWeek, weekEntryCount } from '../lib/domain/myWeek'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
    formatTimeRange,
    startOfIsoWeek,
    todayLocalDate,
    weekDays,
  } from '../lib/domain/time'
  import { navigate } from '../lib/router.svelte'
  import WeekGrid from '../lib/ui/WeekGrid.svelte'

  /**
   * « Ma semaine » : les activités auxquelles la personne est inscrite et ses
   * rendez-vous, sur une seule page.
   *
   * Elle est faite pour trois usages, et la même mise en page sert aux trois : la
   * consulter, en faire une capture d'écran à garder dans son téléphone, ou l'imprimer.
   * D'où le format vertical, compact, et l'absence de tout ce qui ne se lit pas sur une
   * feuille — aucun bouton, aucune couleur porteuse de sens, aucune mise en garde.
   *
   * Le programme est arrêté en début de semaine et ne bouge pas : la feuille n'a donc
   * pas à prévenir d'un changement d'horaire. Une séance annulée reste affichée, barrée
   * avec son motif, pour qui rouvre la page.
   */
  let debut = $state<string>(startOfIsoWeek(todayLocalDate()))
  const jours = $derived(weekDays(debut))
  const semaine = $derived(myWeek(jours, store.mine, store.scheduledAppointments))
  const total = $derived(weekEntryCount(semaine))
  const aujourdhui = todayLocalDate()

  // Les rendez-vous sont chargés au retour sur l'écran : ils ont pu être fixés entre-temps.
  store.loadAppointments()

  const deplacer = (semaines: number): void => {
    debut = addLocalDays(debut, semaines * 7)
  }
</script>

<section class="mx-auto max-w-2xl px-4 py-5">
  <!--
    « Cette semaine » vient après « Semaine suivante », et jamais entre les deux.

    Placé au milieu, il apparaissait dès qu'on quittait la semaine en cours et poussait
    « Semaine suivante » sous le doigt qui venait d'appuyer : deux appuis au même endroit
    ramenaient à la semaine de départ, et l'on oscillait indéfiniment entre deux semaines
    sans jamais atteindre la troisième. Le calendrier place déjà le sien après « Jour
    suivant », et ne souffre pas du défaut.
  -->
  <div class="no-print mb-4 flex flex-wrap gap-2">
    <button type="button" class="btn btn-secondary" onclick={() => deplacer(-1)}>
      <span aria-hidden="true">←</span> Semaine passée
    </button>
    <button type="button" class="btn btn-secondary" onclick={() => deplacer(1)}>
      Semaine suivante <span aria-hidden="true">→</span>
    </button>
    {#if debut !== startOfIsoWeek(aujourdhui)}
      <button type="button" class="btn btn-secondary" onclick={() => (debut = startOfIsoWeek(aujourdhui))}>
        Cette semaine
      </button>
    {/if}
  </div>

  <article class="feuille feuille-semaine ma-semaine card p-5">
    <!-- Même en-tête que le programme affiché dans l'unité : les deux feuilles se
         ressemblent, on les reconnaît de loin comme venant du même endroit. -->
    <header class="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-2 border-line pb-3">
      <div>
        <h1 class="text-3xl font-bold text-ink">
          Ma semaine{store.firstName ? ` — ${store.firstName}` : ''}
        </h1>
        <p class="text-lg text-ink">
          Du {formatDayLabel(jours[0]!)} au {formatDayLabel(jours[6]!)}
        </p>
      </div>
      <img src={logo} alt="ACIS" class="h-10 w-auto" />
    </header>

    <!--
      Deux présentations des mêmes données. À l'écran, une liste : c'est ce qui se lit
      sur un téléphone et se capture d'un coup. Sur le papier, une grille horaire, dont
      les trous sont l'objet même — c'est là qu'on ajoute une activité à la main.
    -->
    <div class="grille-papier">
      <WeekGrid week={semaine} />
    </div>

    {#if total === 0}
      <p class="liste-ecran text-lg text-ink">
        Vous n'avez rien de prévu cette semaine. Vous pouvez choisir une activité dans le
        calendrier, ou en parler à un soignant.
      </p>
    {:else}
      <ul class="liste-ecran grid gap-4">
        {#each semaine as jour (jour.date)}
          <li class="jour" class:aujourdhui={jour.date === aujourdhui}>
            <h2 class="text-xl font-bold text-ink">
              {formatLongDayLabel(jour.date)}{jour.date === aujourdhui ? " — aujourd'hui" : ''}
            </h2>

            {#if jour.entries.length === 0}
              <p class="text-lg text-ink-soft">Rien de prévu</p>
            {:else}
              <ul class="mt-2 grid gap-2">
                <!--
                  La clef est le rang, et non le contenu : deux entrées qui commencent à
                  la même minute — deux ateliers à 10h00, c'est le cas courant — donnent
                  la même clef, et Svelte arrête alors le rendu. L'écran reste figé sur
                  l'affichage précédent, sans un mot, ni à l'écran ni en console. La liste
                  est reconstruite en entier à chaque lecture ; le rang suffit.
                -->
                {#each jour.entries as entree, rang (rang)}
                  <li class="entree rounded-xl border-2 border-line p-3">
                    {#if entree.kind === 'activity'}
                      {@const categorie = store.categoryOf(entree.categoryId)}
                      <p class="text-lg font-bold text-ink" class:line-through={entree.cancelled}>
                        <span aria-hidden="true">{categorie?.icon ?? '•'}</span>
                        {entree.title}
                      </p>
                      <p class="text-lg text-ink">
                        {formatTimeRange(entree.start, entree.end)}
                        · {store.locationOf(entree.locationId)?.name ?? entree.locationId}
                      </p>
                      {#if entree.cancelled}
                        <p class="text-lg font-semibold text-ink">
                          <span aria-hidden="true">⚠️</span>
                          Annulée{entree.cancellationReason ? ` — ${entree.cancellationReason}` : ''}
                        </p>
                      {:else if entree.waiting}
                        <p class="text-lg text-ink">
                          <span aria-hidden="true">⏳</span>
                          Vous êtes sur la liste d'attente. Un soignant vous préviendra.
                        </p>
                      {/if}
                    {:else}
                      <p class="text-lg font-bold text-ink">
                        <span aria-hidden="true">{kindIcon(store.appointmentKinds, entree.kindId)}</span>
                        <span class:line-through={entree.cancelled === true}>
                          Rendez-vous avec {entree.withWhom ?? kindName(store.appointmentKinds, entree.kindId).toLowerCase()}
                        </span>
                      </p>
                      <p class="text-lg text-ink">
                        {formatTimeRange(entree.start, entree.end)}
                        {#if entree.locationId}· {store.locationOf(entree.locationId)?.name}{/if}
                      </p>
                      <!--
                        Un rendez-vous annulé reste sur la feuille, barré et suivi de son
                        motif. « Rien de prévu » à sa place se lit comme une panne, et fait
                        venir la personne pour rien.
                      -->
                      {#if entree.cancelled === true}
                        <p class="text-lg font-semibold text-ink">
                          <span aria-hidden="true">✕</span>
                          Annulé{entree.cancellationReason ? ` — ${entree.cancellationReason}` : ''}
                        </p>
                      {/if}
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </article>

  <div class="no-print mt-5 grid gap-3">
    <button type="button" class="btn btn-primary" onclick={() => window.print()}>
      <span aria-hidden="true">🖨️</span> Imprimer ma semaine
    </button>
    <p class="text-base text-ink-soft">
      La feuille imprimée présente la semaine en tableau, avec les heures et des cases
      libres : vous pouvez y ajouter des activités à la main.
    </p>
    <p class="text-base text-ink-soft">
      Vous pouvez aussi faire une capture d'écran de cette page pour la garder dans votre
      téléphone.
    </p>
    <!--
      « Voir », et non « Retour » : on arrive maintenant ici depuis le calendrier aussi,
      et un retour qui ramène ailleurs que d'où l'on vient désoriente. Le vrai bouton
      « Retour » est en haut, toujours au même endroit, et il ramène au calendrier.
    -->
    <button type="button" class="btn btn-secondary" onclick={() => navigate('/mes-inscriptions')}>
      <span aria-hidden="true">📋</span> Voir mes inscriptions
    </button>
  </div>
</section>

<style>
  /* La grille n'existe que sur le papier ; la liste, qu'à l'écran. */
  .grille-papier {
    display: none;
  }
  @media print {
    /*
      La feuille occupe exactement la page, et la grille prend ce qui reste une fois
      l'en-tête et la légende posés. Sans cela, une semaine à cinq catégories faisait
      passer la légende sur une seconde ligne et la feuille sur une seconde page.
    */
    /* La hauteur d'une page est posée par « .feuille-semaine », dans app.css. */
    .grille-papier {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .liste-ecran {
      display: none;
    }
  }

  .jour.aujourdhui > h2 {
    color: var(--color-brand-700);
  }
  /* Un jour ne se coupe pas entre deux pages. */
  .jour {
    break-inside: avoid;
  }
</style>
