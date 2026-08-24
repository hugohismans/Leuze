<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { canEditActivity } from '../../lib/domain/activityAccess'
  import { weekProgramme, programmeCount } from '../../lib/domain/programme'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
    formatTimeRange,
    startOfIsoWeek,
    todayLocalDate,
  } from '../../lib/domain/time'
  import { proposed } from '../../lib/domain/catalog'
  import { navigate } from '../../lib/router.svelte'
  import WeekProgramme from '../../lib/ui/WeekProgramme.svelte'

  /**
   * L'écran principal du personnel : la semaine.
   *
   * Le programme se refait chaque semaine selon les disponibilités — les activités sont
   * donc posées à une date, une par une, depuis cette vue. La récurrence reste possible
   * pour les quelques rendez-vous fixes, mais ce n'est pas le geste courant.
   */
  /**
   * Le programme d'un service : les activités qui lui sont réservées, plus celles
   * ouvertes à tous. Sans service choisi, tout le programme.
   *
   * C'est un confort de lecture, pas une cloison : le personnel a le droit de voir le
   * programme entier — il est affiché au mur. Le filtre suit jusqu'à l'impression.
   */
  const programme = $derived(
    weekProgramme(staffStore.week, staffStore.occurrences, staffStore.programmeServiceId),
  )
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

  /** Qui regarde : une séance appartient à qui anime son activité. */
  const moi = $derived({
    role: staffStore.identity.role,
    practitionerId: staffStore.identity.practitionerId,
  })

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

  <div class="mb-4 card p-4 sm:max-w-md">
    <label for="service-programme" class="mb-2 block text-lg font-semibold text-ink">
      Quel service ?
    </label>
    <select
      id="service-programme"
      class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
      style="min-height: 56px;"
      value={staffStore.programmeServiceId ?? ''}
      onchange={(event) =>
        (staffStore.programmeServiceId =
          event.currentTarget.value === '' ? null : event.currentTarget.value)}
    >
      <option value="">Tous les services — le programme complet</option>
      {#each proposed(staffStore.catalog.services) as service (service.id)}
        <option value={service.id}>{service.name}</option>
      {/each}
    </select>
    {#if staffStore.programmeServiceId !== null}
      <p class="mt-2 text-base text-ink-soft">
        Les activités réservées à ce service, plus celles ouvertes à tous. L'impression
        suivra le même choix.
      </p>
    {/if}
  </div>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <!--
    La semaine reste lisible pendant qu'on la relit : on ne retire pas les sept jours de
    l'écran pour un aller-retour. Voir `refresh()` dans le magasin.
  -->
  {#if staffStore.rafraichit && !staffStore.loading}
    <p class="mb-2 text-base text-ink-soft" aria-live="polite">Mise à jour de la semaine…</p>
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
              <!--
                Rétablir une séance, c'est modifier l'activité de quelqu'un : le bouton
                n'apparaît qu'à qui l'anime, et à l'administrateur. La séance annulée
                reste lisible par tous, avec son motif — voir n'est pas modifier.
              -->
              {#if canEditActivity(moi, occurrence)}
                <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => retablir(occurrence.id)}>
                  {busy ? 'Un instant…' : 'Rétablir'}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>
