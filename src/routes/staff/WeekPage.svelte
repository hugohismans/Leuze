<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { weekProgramme, programmeCount } from '../../lib/domain/programme'
  import { addLocalDays, formatDayLabel, startOfIsoWeek, todayLocalDate } from '../../lib/domain/time'
  import { navigate } from '../../lib/router.svelte'
  import WeekProgramme from '../../lib/ui/WeekProgramme.svelte'

  /**
   * L'écran principal du personnel : la semaine.
   *
   * Le programme se refait chaque semaine selon les disponibilités — les activités sont
   * donc posées à une date, une par une, depuis cette vue. La récurrence reste possible
   * pour les quelques rendez-vous fixes, mais ce n'est pas le geste courant.
   */
  const programme = $derived(weekProgramme(staffStore.week, staffStore.occurrences))
  const total = $derived(programmeCount(programme))

  const semaineDe = (decalage: number): void => {
    staffStore.date = addLocalDays(startOfIsoWeek(staffStore.date), decalage * 7)
    void staffStore.refresh()
  }
</script>

<section class="mx-auto max-w-[1600px] px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-3xl font-bold text-ink">
      Semaine du {formatDayLabel(staffStore.week[0]!)} au {formatDayLabel(staffStore.week[6]!)}
    </h1>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-secondary" onclick={() => semaineDe(-1)}>
        <span aria-hidden="true">←</span> Semaine précédente
      </button>
      {#if startOfIsoWeek(staffStore.date) !== startOfIsoWeek(todayLocalDate())}
        <button type="button" class="btn btn-secondary" onclick={() => { staffStore.date = todayLocalDate(); void staffStore.refresh() }}>
          Cette semaine
        </button>
      {/if}
      <button type="button" class="btn btn-secondary" onclick={() => semaineDe(1)}>
        Semaine suivante <span aria-hidden="true">→</span>
      </button>
      <button type="button" class="btn btn-primary" onclick={() => navigate('/soignant/impression')}>
        <span aria-hidden="true">🖨️</span> Imprimer le programme
      </button>
    </div>
  </div>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.loading}
    <p class="text-lg text-ink-soft">Chargement…</p>
  {:else}
    {#if total === 0}
      <p class="card mb-4 p-4 text-lg text-ink-soft">
        Rien n'est encore prévu cette semaine. Utilisez « Ajouter » sous un jour pour poser
        une activité.
      </p>
    {/if}

    <WeekProgramme
      {programme}
      onAjouter={(date) => navigate(`/soignant/activite/nouvelle/${date}`)}
      onOuvrir={(occurrence) => navigate(`/soignant/activite/${occurrence.activityId}/${occurrence.localDate}`)}
    />
  {/if}
</section>
