<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { myWeek } from '../../lib/domain/myWeek'
  import { kindName } from '../../lib/domain/appointments'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
    formatTimeRange,
    startOfIsoWeek,
    todayLocalDate,
  } from '../../lib/domain/time'
  import type { PatientPlanning } from '../../lib/data/staffPorts'
  import WeekSheet from '../../lib/ui/WeekSheet.svelte'
  import { navigate } from '../../lib/router.svelte'

  /**
   * Le planning d'une seule personne, vu par un soignant.
   *
   * Répond à « où est Marc cet après-midi ? » sans avoir à imprimer toute une pile, et
   * permet de lui redonner sa feuille s'il l'a perdue.
   */
  let { patientUid }: { patientUid: string } = $props()

  let planning = $state<PatientPlanning | null>(null)
  let chargement = $state(true)
  let erreur = $state<string | null>(null)

  $effect(() => {
    const debut = staffStore.week[0]
    if (debut === undefined) return
    void charger()
  })

  async function charger(): Promise<void> {
    chargement = true
    erreur = null
    try {
      await staffStore.loadAppointments()
      const tous = await staffStore.weekPlannings()
      planning = tous.find((p) => p.patientUid === patientUid) ?? null
    } catch (error) {
      erreur = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : "Le planning n'a pas pu être lu."
    } finally {
      chargement = false
    }
  }

  const semaine = $derived.by(() => {
    if (planning === null) return []
    const inscriptions = planning.lines
      .map((ligne) => {
        const occurrence = staffStore.occurrences.find((o) => o.id === ligne.occurrenceId)
        return occurrence === undefined ? null : { occurrence, status: ligne.status }
      })
      .filter((v) => v !== null)
    const debut = staffStore.week[0] ?? ''
    const fin = staffStore.week[6] ?? ''
    const rendezVous = staffStore.appointments.filter(
      (r) =>
        r.patientUid === patientUid &&
        r.status === 'scheduled' &&
        r.localDate !== undefined &&
        r.localDate >= debut &&
        r.localDate <= fin,
    )
    return myWeek(staffStore.week, inscriptions, rendezVous)
  })

  const nomDuService = $derived(
    planning === null ? '' : (store.serviceOf(planning.serviceId)?.name ?? ''),
  )

  const allerSemaine = (decalage: number): void => {
    staffStore.date = addLocalDays(startOfIsoWeek(staffStore.date), decalage * 7)
    void staffStore.refresh()
  }
</script>

{#if !staffStore.isAdmin}
  <section class="mx-auto max-w-3xl px-4 py-6">
    <button type="button" class="btn btn-secondary mb-4" onclick={() => navigate('/soignant/patients')}>
      <span aria-hidden="true">←</span> Retour aux patients
    </button>
    <p class="card p-5 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Le planning d'un patient n'est consultable que par un administrateur. Vous retrouvez
      vos propres activités dans « Mon planning ».
    </p>
  </section>
{:else}
<section class="mx-auto max-w-3xl px-4 py-6">
  <div class="no-print">
    <button type="button" class="btn btn-secondary mb-4" onclick={() => navigate('/soignant/patients')}>
      <span aria-hidden="true">←</span> Retour aux patients
    </button>

    {#if chargement}
      <p class="card p-5 text-lg" aria-live="polite">Lecture du planning…</p>
    {:else if erreur !== null}
      <p role="alert" class="rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
        <span aria-hidden="true">⚠️</span> {erreur}
      </p>
    {:else if planning === null}
      <p class="card p-5 text-lg text-ink-soft">Cette personne n'a pas été trouvée.</p>
    {:else}
      <h1 class="mb-1 text-3xl font-bold text-ink">La semaine de {planning.firstName}</h1>
      {#if !staffStore.isAdmin}
        <!--
        Les rendez-vous individuels ne sont plus lisibles que par la personne qu'ils
        nomment : les feuilles imprimées ici seraient donc incomplètes. Le dire, plutôt
        que de laisser quelqu'un distribuer des feuilles où il manque un rendez-vous.
        -->
        <p role="status" class="mb-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
        <span aria-hidden="true">🔒</span>
        Seuls vos propres rendez-vous figurent sur ces feuilles : ceux de vos collègues ne
        vous sont pas lisibles. Pour une pile complète, demandez-la à un administrateur.
        </p>
      {/if}
      <p class="mb-4 text-lg text-ink-soft">
        Du {formatDayLabel(staffStore.week[0]!)} au {formatDayLabel(staffStore.week[6]!)}
        {#if nomDuService}· {nomDuService}{/if}
      </p>

      <div class="mb-4 flex flex-wrap gap-2">
        <button type="button" class="btn btn-secondary" onclick={() => allerSemaine(-1)}>
          <span aria-hidden="true">←</span> Semaine précédente
        </button>
        {#if startOfIsoWeek(staffStore.date) !== startOfIsoWeek(todayLocalDate())}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => { staffStore.date = todayLocalDate(); void staffStore.refresh() }}
          >
            Cette semaine
          </button>
        {/if}
        <button type="button" class="btn btn-secondary" onclick={() => allerSemaine(1)}>
          Semaine suivante <span aria-hidden="true">→</span>
        </button>
        <button type="button" class="btn btn-primary" onclick={() => window.print()}>
          <span aria-hidden="true">🖨️</span> Imprimer sa feuille
        </button>
      </div>

      <ul class="grid gap-4">
        {#each semaine as jour (jour.date)}
          <li class="card p-4" class:aujourdhui={jour.date === todayLocalDate()}>
            <h2 class="text-xl font-bold text-ink">{formatLongDayLabel(jour.date)}</h2>
            {#if jour.entries.length === 0}
              <p class="text-lg text-ink-soft">Rien de prévu</p>
            {:else}
              <ul class="mt-2 grid gap-2">
                {#each jour.entries as entree (entree.start.getTime() + entree.kind)}
                  <li class="text-lg text-ink">
                    <span class="font-semibold">{formatTimeRange(entree.start, entree.end)}</span>
                    —
                    {#if entree.kind === 'activity'}
                      <span class:line-through={entree.cancelled}>{entree.title}</span>
                      {#if entree.waiting}<span class="text-base text-ink-soft">· en liste d'attente</span>{/if}
                      {#if entree.cancelled}<span class="text-base text-ink-soft">· annulée</span>{/if}
                    {:else}
                      <span aria-hidden="true">🩺</span>
                      {entree.withWhom ?? kindName(store.appointmentKinds, entree.kindId)}
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if planning !== null}
    <WeekSheet
      titre={`Ma semaine — ${planning.firstName}`}
      sousTitre={`Du ${formatDayLabel(staffStore.week[0]!)} au ${formatDayLabel(staffStore.week[6]!)}${nomDuService ? ` · ${nomDuService}` : ''}`}
      week={semaine}
    />
  {/if}
</section>
{/if}

<style>
  .aujourdhui {
    border-color: var(--color-brand-500);
  }
</style>
