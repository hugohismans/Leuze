<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import DayView from '../lib/calendar/DayView.svelte'
  import Filters from '../lib/calendar/Filters.svelte'
  import MonthView from '../lib/calendar/MonthView.svelte'
  import ViewSwitcher from '../lib/calendar/ViewSwitcher.svelte'
  import WeekView from '../lib/calendar/WeekView.svelte'
  import { kindName, nextScheduled } from '../lib/domain/appointments'
  import { navigate } from '../lib/router.svelte'
  import {
    addLocalDays,
    addLocalMonths,
    formatDayLabel,
    formatFullWhen,
    formatMonthLabel,
    todayLocalDate,
    weekDays,
  } from '../lib/domain/time'

  const labels = {
    day: { previous: 'Jour précédent', next: 'Jour suivant' },
    week: { previous: 'Semaine précédente', next: 'Semaine suivante' },
    month: { previous: 'Mois précédent', next: 'Mois suivant' },
  }

  function move(direction: -1 | 1): void {
    if (store.view === 'day') store.date = addLocalDays(store.date, direction)
    else if (store.view === 'week') store.date = addLocalDays(store.date, 7 * direction)
    else store.date = addLocalMonths(store.date, direction)
  }

  /**
   * Le prochain rendez-vous, annoncé dès l'accueil.
   *
   * C'est la moitié patient de la seule notification du projet. Une demande peut être
   * acceptée pendant qu'on ne regarde pas — d'autant plus depuis que certaines le sont
   * automatiquement — et personne n'envoie de message : il faut donc que la réponse
   * saute aux yeux là où l'on arrive, sans avoir à ouvrir un écran de plus.
   *
   * Elle reste tant que le rendez-vous n'a pas eu lieu : pour quelqu'un de désorienté,
   * revoir « c'est mardi à 9 heures » vaut mieux qu'un avis qui disparaît une fois lu.
   */
  const prochainRendezVous = $derived(nextScheduled(store.appointments))

  const periodLabel = $derived(
    store.view === 'day'
      ? formatDayLabel(store.date)
      : store.view === 'week'
        ? `Semaine du ${formatDayLabel(weekDays(store.date)[0]!)}`
        : formatMonthLabel(store.date),
  )
</script>

<div class="mx-auto grid grid-cols-1 gap-5 px-4 py-5 {store.view === 'week' ? 'max-w-[1600px]' : 'max-w-5xl'}">
  <ViewSwitcher />

  <!--
    Le chemin direct vers sa propre semaine.

    Il n'y en avait aucun : « Ma semaine » ne s'atteignait que par le bouton « Mes
    inscriptions » du bandeau, discret et sur fond sombre. Mis à l'essai auprès de
    plusieurs personnes, ce bouton n'était pas vu — et la page restait donc hors
    d'atteinte, sans que rien n'indique qu'elle existait.

    Même libellé qu'ailleurs : une chose, un nom.
  -->
  {#if store.isDemo || store.signedIn}
    <div class="grid gap-3 sm:grid-cols-2">
      <button type="button" class="btn btn-primary" onclick={() => navigate('/ma-semaine')}>
        <span aria-hidden="true">🗓️</span>
        <span>Voir ma semaine</span>
      </button>

      <!--
        Demander un rendez-vous, depuis la première page.

        Il ne vivait que dans « Mes inscriptions ». Mis à l'essai auprès de plusieurs
        personnes, aucune n'a eu l'idée d'aller le chercher là : « mes inscriptions »
        veut dire « ce à quoi je suis inscrit », et personne ne s'attend à y trouver un
        geste qui ne concerne aucune activité. Le voici sur le chemin, sous celui de sa
        propre semaine — les deux disent la même chose : « et moi, dans tout ça ? ».

        Toujours le même libellé qu'ailleurs, et toujours le même réglage : fermé, le
        bouton disparaît des deux écrans à la fois plutôt que de mener à un refus.
      -->
      {#if store.may('requestAppointment')}
        <button type="button" class="btn btn-secondary" onclick={() => navigate('/rendez-vous')}>
          <span aria-hidden="true">📅</span>
          <!--
            « rendez-vous » ne se coupe pas au trait d'union.

            Sur un téléphone étroit le libellé tient sur deux lignes, et il se coupait en
            « rendez- / vous » — un mot brisé en deux, ce qui est précisément ce qu'on ne
            demande pas de déchiffrer à quelqu'un pour qui lire coûte un effort.
          -->
          <span>Demander un <span class="whitespace-nowrap">rendez-vous</span></span>
        </button>
      {/if}
    </div>
  {/if}

  <!-- En vue jour, le titre visible est celui de la liste juste en dessous :
       ce libellé ne sert qu'à annoncer le changement aux lecteurs d'écran. -->
  <p class="text-center text-xl font-bold" class:sr-only={store.view === 'day'} aria-live="polite">
    {periodLabel}
  </p>

  <div class="grid grid-cols-2 gap-3">
    <button type="button" class="btn btn-secondary" onclick={() => move(-1)}>
      <span aria-hidden="true">←</span>
      <span>{labels[store.view].previous}</span>
    </button>

    <button type="button" class="btn btn-secondary" onclick={() => move(1)}>
      <span>{labels[store.view].next}</span>
      <span aria-hidden="true">→</span>
    </button>
  </div>

  {#if store.date !== todayLocalDate()}
    <button type="button" class="btn btn-quiet" onclick={() => (store.date = todayLocalDate())}>
      Revenir à aujourd'hui
    </button>
  {/if}

  {#if prochainRendezVous !== null && prochainRendezVous.localDate !== undefined && prochainRendezVous.start !== undefined && prochainRendezVous.end !== undefined}
    <!--
      Un avis, pas une alarme : le même langage que le reste, en français simple, avec
      de quoi aller voir le détail. Rien n'y dit pourquoi ce rendez-vous a lieu.
    -->
    <button type="button" class="avis-rendez-vous" onclick={() => navigate('/rendez-vous')}>
      <span aria-hidden="true">📅</span>
      <span>
        <strong>Votre rendez-vous est fixé.</strong>
        {formatFullWhen(prochainRendezVous.localDate, prochainRendezVous.start, prochainRendezVous.end)}
        avec {prochainRendezVous.withWhom ??
          kindName(store.appointmentKinds, prochainRendezVous.kindId).toLowerCase()}.
      </span>
    </button>
  {/if}

  <Filters />

  <!--
    Le programme se met à jour sans disparaître.

    On vidait la page à chaque flèche, le temps de l'aller-retour : le seul repère de
    l'écran s'en allait, et l'on avait l'impression d'avoir cassé quelque chose. Le
    programme d'avant reste donc affiché, et une ligne discrète dit qu'il change. Jamais
    la couleur seule : c'est une phrase.
  -->
  {#if store.rafraichit && !store.loading}
    <p class="text-base text-ink-soft" aria-live="polite">Mise à jour du programme…</p>
  {/if}

  {#if store.lectureEchouee}
    <!--
      Une lecture qui échoue ne doit pas laisser un calendrier vide sans explication :
      quelqu'un pourrait croire qu'il n'y a rien de prévu et ne pas venir.
    -->
    <div role="alert" class="card p-5">
      <p class="text-xl font-semibold text-ink">
        <span aria-hidden="true">⚠️</span>
        Le programme n'a pas pu être chargé.
      </p>
      <p class="mt-1 text-lg text-ink-soft">
        Cela arrive quand la connexion est mauvaise. Réessayez dans un instant.
      </p>
      <button type="button" class="btn btn-primary mt-3" onclick={() => store.refresh()}>
        Réessayer
      </button>
    </div>
  {:else if store.loading}
    <p class="card p-6 text-lg" aria-live="polite">Chargement du programme…</p>
  {:else if store.view === 'day'}
    <DayView date={store.date} />
  {:else if store.view === 'week'}
    <WeekView date={store.date} />
  {:else}
    <MonthView
      date={store.date}
      onPickDay={(day) => {
        store.date = day
        store.view = 'day'
      }}
    />
  {/if}

  <!--
    Proposer une activité, au bas du programme.
    
    Sa place est ici, après le calendrier : on lit d'abord ce qui est prévu, et c'est en
    ne trouvant pas ce qu'on cherche qu'on a envie de proposer autre chose. En haut, ce
    bouton passerait avant l'information que tout le monde vient chercher.
  -->
  {#if (store.isDemo || store.signedIn) && store.may('proposeActivity')}
    <button type="button" class="btn btn-secondary" onclick={() => navigate('/proposer')}>
      <span aria-hidden="true">💡</span> Proposer une activité
    </button>
  {/if}
</div>

<style>
  /*
    Un avis se lit d'abord, se touche ensuite : toute la ligne est un bouton, haute de
    56 points au moins, avec un contour épais plutôt qu'une simple couleur de fond.
  */
  .avis-rendez-vous {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    width: 100%;
    min-height: 56px;
    padding: 1rem 1.1rem;
    border: 3px solid var(--color-brand-500);
    border-radius: 0.9rem;
    background: var(--color-brand-100);
    font-size: 1.125rem;
    line-height: 1.5;
    color: var(--color-ink);
    text-align: start;
    cursor: pointer;
  }
  .avis-rendez-vous:hover {
    background: var(--color-surface);
  }
</style>
