<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { weekProgramme, programmeCount } from '../../lib/domain/programme'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
    formatTimeRange,
    startOfIsoWeek,
    todayLocalDate,
  } from '../../lib/domain/time'
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

  /**
   * Les séances annulées de la semaine, avec de quoi revenir en arrière.
   *
   * Une annulation arrive par erreur, et une modification d'activité annule d'office les
   * séances déjà inscrites qui ne correspondent plus. Sans ce retour, il fallait recréer
   * l'activité — en perdant les inscriptions, ce qui est précisément ce que l'annulation
   * cherchait à éviter.
   */
  const annulees = $derived(
    staffStore.occurrences
      .filter((o) => o.status === 'cancelled')
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  )
  let busy = $state(false)

  async function retablir(occurrenceId: string): Promise<void> {
    if (busy) return
    busy = true
    await staffStore.restoreOccurrence(occurrenceId)
    busy = false
  }

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

    {#if annulees.length > 0}
      <section class="mt-8">
        <h2 class="mb-2 text-2xl font-bold text-ink">
          Séances annulées cette semaine ({annulees.length})
        </h2>
        <p class="mb-3 text-lg text-ink-soft">
          Elles restent visibles, barrées, sur le programme et chez les personnes inscrites.
          Rétablir une séance la remet au programme avec ses inscriptions.
        </p>
        <ul class="grid gap-3">
          {#each annulees as occurrence (occurrence.id)}
            <li class="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p class="text-xl font-bold text-ink">
                  <span aria-hidden="true">🚫</span>
                  <span class="line-through">{occurrence.title}</span>
                </p>
                <p class="text-base text-ink-soft">
                  {formatLongDayLabel(occurrence.localDate)} · {formatTimeRange(occurrence.start, occurrence.end)}
                </p>
                <p class="text-base text-ink">
                  Motif : {occurrence.cancellationReason || 'sans motif'}
                </p>
              </div>
              <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => retablir(occurrence.id)}>
                {busy ? 'Un instant…' : 'Rétablir'}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>
