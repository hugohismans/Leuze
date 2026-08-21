<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { proposed } from '../../lib/domain/catalog'
  import { myWeek, weekEntryCount } from '../../lib/domain/myWeek'
  import { addLocalDays, formatDayLabel, startOfIsoWeek, todayLocalDate } from '../../lib/domain/time'
  import type { PatientPlanning } from '../../lib/data/staffPorts'
  import WeekSheet from '../../lib/ui/WeekSheet.svelte'

  /**
   * La pile de plannings d'un service, imprimée en une fois.
   *
   * C'est le geste de fin de réunion : on vient de noter qui fait quoi, on imprime, et
   * chacun repart avec sa semaine sur papier. Les personnes sans aucune inscription en
   * reçoivent une aussi : une grille vide se remplit à la main.
   *
   * Les rendez-vous individuels n'y figurent pas — une pile de feuilles passe de main en
   * main pendant la distribution. Chacun retrouve les siens sur son écran.
   */
  const services = $derived(proposed(staffStore.catalog.services))
  let serviceId = $state('')
  let plannings = $state<PatientPlanning[]>([])
  let chargement = $state(false)
  let erreur = $state<string | null>(null)

  $effect(() => {
    if (serviceId === '' && services.length > 0) serviceId = services[0]!.id
  })

  // Le service ou la semaine change : on relit. Les inscriptions bougent pendant la réunion.
  $effect(() => {
    const service = serviceId
    const debut = staffStore.week[0]
    if (service === '' || debut === undefined) return
    void charger(service)
  })

  async function charger(service: string): Promise<void> {
    chargement = true
    erreur = null
    try {
      // Les rendez-vous sont lisibles par le personnel : ils viennent du magasin, pas
      // d'un second appel. Ceux d'un patient d'un autre service ne seront pas retenus,
      // la feuille étant construite prénom par prénom.
      await staffStore.loadAppointments()
      plannings = await staffStore.weekPlannings(service)
    } catch (error) {
      erreur = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : "La liste n'a pas pu être lue."
      plannings = []
    } finally {
      chargement = false
    }
  }

  const allerSemaine = (decalage: number): void => {
    staffStore.date = addLocalDays(startOfIsoWeek(staffStore.date), decalage * 7)
    void staffStore.refresh()
  }

  const debutSemaine = $derived(staffStore.week[0] ?? '')
  const finSemaine = $derived(staffStore.week[6] ?? '')

  /** Les rendez-vous fixés d'une personne, sur la semaine affichée. */
  function rendezVousDe(patientUid: string) {
    return staffStore.appointments.filter(
      (rendezVous) =>
        rendezVous.patientUid === patientUid &&
        rendezVous.status === 'scheduled' &&
        rendezVous.localDate !== undefined &&
        rendezVous.localDate >= debutSemaine &&
        rendezVous.localDate <= finSemaine,
    )
  }

  /** La semaine d'une personne, reconstruite à partir des séances déjà chargées. */
  function semaineDe(planning: PatientPlanning) {
    const inscriptions = planning.lines
      .map((ligne) => {
        const occurrence = staffStore.occurrences.find((o) => o.id === ligne.occurrenceId)
        return occurrence === undefined ? null : { occurrence, status: ligne.status }
      })
      .filter((v) => v !== null)
    return myWeek(staffStore.week, inscriptions, rendezVousDe(planning.patientUid))
  }

  const nomDuService = $derived(services.find((s) => s.id === serviceId)?.name ?? '')
</script>

{#if !staffStore.isAdmin}
  <section class="mx-auto max-w-3xl px-4 py-6">
    <h1 class="mb-2 text-3xl font-bold text-ink">Les plannings de la semaine</h1>
    <p class="card p-5 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Les plannings des patients ne sont consultables que par un administrateur. Vous
      retrouvez vos propres activités dans « Mon planning ».
    </p>
  </section>
{:else}
<section class="mx-auto max-w-4xl px-4 py-6">
  <div class="no-print">
    <h1 class="mb-2 text-3xl font-bold text-ink">Les plannings de la semaine</h1>
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
      Une feuille par personne du service, à distribuer à la fin de la réunion. Les
      personnes sans inscription en reçoivent une aussi : la grille se remplit à la main.
    </p>

    <div class="card mb-4 p-4">
      <label for="service" class="mb-2 block text-lg font-semibold text-ink">Le service</label>
      <select
        id="service"
        bind:value={serviceId}
        class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
        style="min-height: 56px;"
      >
        {#each services as service (service.id)}
          <option value={service.id}>{service.name}</option>
        {/each}
      </select>

      <p class="mt-3 text-lg text-ink">
        Semaine du {formatDayLabel(staffStore.week[0]!)} au {formatDayLabel(staffStore.week[6]!)}
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
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
      </div>
    </div>

    {#if erreur !== null}
      <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
        <span aria-hidden="true">⚠️</span> {erreur}
      </p>
    {/if}

    {#if chargement}
      <p class="card p-5 text-lg" aria-live="polite">Lecture des inscriptions…</p>
    {:else if plannings.length === 0}
      <p class="card p-5 text-lg text-ink-soft">
        Aucune personne enregistrée dans ce service. Créez-les depuis « Les patients ».
      </p>
    {:else}
      <button type="button" class="btn btn-primary btn-huge mb-4" onclick={() => window.print()}>
        <span aria-hidden="true">🖨️</span>
        Imprimer les {plannings.length} plannings
      </button>

      <ul class="grid gap-2">
        {#each plannings as planning (planning.patientUid)}
          {@const compte = weekEntryCount(semaineDe(planning))}
          <li class="card flex flex-wrap items-baseline justify-between gap-2 p-3">
            <span class="text-xl font-bold text-ink">{planning.firstName}</span>
            <span class="text-base text-ink-soft">
              {compte === 0
                ? 'Rien de prévu — feuille vierge'
                : `${compte} ${compte === 1 ? 'ligne' : 'lignes'} : activités et rendez-vous`}
            </span>
          </li>
        {/each}
      </ul>

      <p class="mt-4 rounded-xl bg-surface-soft p-3 text-base text-ink">
        <span aria-hidden="true">⚠️</span>
        Ces feuilles portent les rendez-vous individuels — psychiatre, psychologue,
        kinésithérapeute. Remettez-les en main propre, une par une, et ne laissez pas la
        pile sur une table.
      </p>
    {/if}
  </div>

  <!-- Les feuilles : invisibles à l'écran, une page chacune à l'impression. -->
  <div class="pile">
    {#each plannings as planning (planning.patientUid)}
      <WeekSheet
        titre={`Ma semaine — ${planning.firstName}`}
        sousTitre={`Du ${formatDayLabel(staffStore.week[0]!)} au ${formatDayLabel(staffStore.week[6]!)}${nomDuService ? ` · ${nomDuService}` : ''}`}
        week={semaineDe(planning)}
      />
    {/each}
  </div>
</section>
{/if}

<style>
  /* La pile n'a de sens que sur le papier : à l'écran, elle ferait défiler pour rien. */
  .pile {
    display: none;
  }
  @media print {
    .pile {
      display: block;
    }
  }
</style>
