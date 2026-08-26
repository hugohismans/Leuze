<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff } from '../../lib/domain/audience'
  import { staffCapacityLabel } from '../../lib/domain/capacity'
  import { attendanceOpen, attendanceRefusal, canMarkAttendance } from '../../lib/domain/attendance'
  import { canEditActivity } from '../../lib/domain/activityAccess'
  import { formatLongDayLabel, formatTimeRange, todayLocalDate } from '../../lib/domain/time'
  import { navigate } from '../../lib/router.svelte'
  import CancelButton from './CancelButton.svelte'
  import type { Occurrence } from '../../lib/domain/types'

  const aujourdhui = todayLocalDate()

  const audience = (activityId: string): string => {
    const activity = staffStore.activityOf(activityId)
    return activity === null ? '' : audienceLabelForStaff(activity, staffStore.catalog.services)
  }

  /**
   * L'appel est-il ouvert **à la personne connectée** ?
   *
   * `attendanceOpen` ne regarde que la séance : l'écran proposait donc « Faire l'appel »
   * sur les séances des collègues, pour se le faire refuser ensuite. Les deux questions
   * comptent — la séance en a-t-elle un, et celui qui regarde y a-t-il droit.
   */
  const peutFaireLAppel = (occurrence: Occurrence): boolean =>
    attendanceOpen(occurrence) && canMarkAttendance(staffStore.identity, occurrence)
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-3xl font-bold text-ink">{formatLongDayLabel(staffStore.date)}</h1>
    <div class="flex gap-2">
      {#if staffStore.date !== aujourdhui}
        <button type="button" class="btn btn-secondary" onclick={() => { staffStore.date = aujourdhui; staffStore.refresh() }}>
          Revenir à aujourd'hui
        </button>
      {/if}
      <button type="button" class="btn btn-primary" onclick={() => navigate('/soignant/activite/nouvelle')}>
        <span aria-hidden="true">＋</span> Nouvelle activité
      </button>
    </div>
  </div>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.rafraichit && !staffStore.loading}
    <p class="mb-2 text-base text-ink-soft" aria-live="polite">Mise à jour…</p>
  {/if}

  {#if staffStore.lectureEchouee}
    <!--
      Une lecture qui échoue ne dit pas la même chose qu'une semaine vide.

      L'écran restait sur « Chargement… » sans fin, ou annonçait « Rien n'est encore
      prévu » — c'est-à-dire une affirmation sur le programme, alors qu'il n'avait rien pu
      lire. On dit ce qui s'est passé, et l'on propose le geste qui en sort.
    -->
    <div role="alert" class="card mb-4 p-5">
      <p class="text-xl font-semibold text-ink">
        <span aria-hidden="true">⚠️</span>
        Le programme n'a pas pu être chargé.
      </p>
      <p class="mt-1 text-lg text-ink-soft">
        Cela arrive quand la connexion est mauvaise. Réessayez dans un instant.
      </p>
      <button type="button" class="btn btn-primary mt-3" onclick={() => void staffStore.refresh()}>
        Réessayer
      </button>
    </div>
  {:else if staffStore.loading}
    <p class="text-lg text-ink-soft">Chargement…</p>
  {:else if staffStore.today.length === 0}
    <p class="card p-5 text-lg text-ink-soft">Aucune activité ce jour-là.</p>
  {:else}
    <ul class="grid gap-4">
      {#each staffStore.today as occurrence (occurrence.id)}
        <li class="card p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <h2 class="text-xl font-bold text-ink" class:line-through={occurrence.status === 'cancelled'}>
              {occurrence.title}
            </h2>
            <p class="text-lg font-semibold text-ink">{formatTimeRange(occurrence.start, occurrence.end)}</p>
          </div>

          <p class="mt-1 text-base text-ink-soft">
            {store.locationOf(occurrence.locationId)?.name ?? occurrence.locationId}
            {#if occurrence.facilitator}— {occurrence.facilitator}{/if}
          </p>
          <p class="text-base text-ink-soft">{audience(occurrence.activityId)}</p>
          <p class="mt-1 text-base text-ink">{staffCapacityLabel(occurrence)}</p>

          {#if !peutFaireLAppel(occurrence)}
            <!--
              Proposer un bouton qui mène à un refus serait une promesse en l'air. La
              phrase vient du domaine : elle distingue « personne n'anime » de « quelqu'un
              anime, mais sans compte », et l'écran affiche le nom juste au-dessus.
            -->
            <p class="mt-2 text-base font-semibold text-ink">
              <span aria-hidden="true">⚠️</span>
              {attendanceRefusal(occurrence, canEditActivity(staffStore.identity, occurrence))}
            </p>
          {/if}

          <div class="mt-3 flex flex-wrap gap-2">
            <!-- L'appel d'abord : c'est le geste du jour, les autres sont occasionnels. -->
            <!--
              Les boutons suivent les droits, et non la seule séance.

              « Faire l'appel » ne regardait que l'activité — jamais la personne connectée
              — et « Modifier l'activité » n'était conditionné par rien : chacun se voyait
              proposer les gestes de ses collègues, pour se les faire refuser ensuite.
            -->
            {#if peutFaireLAppel(occurrence)}
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => navigate(`/soignant/appel/${occurrence.id}`)}
              >
                <span aria-hidden="true">📋</span> Faire l'appel
              </button>
            {/if}
            {#if canEditActivity(staffStore.identity, occurrence)}
              <button
                type="button"
                class="btn btn-secondary"
                onclick={() => navigate(`/soignant/activite/${occurrence.activityId}`)}
              >
                Modifier l'activité
              </button>
              <CancelButton {occurrence} />
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
