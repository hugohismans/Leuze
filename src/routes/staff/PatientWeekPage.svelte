<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { myWeek } from '../../lib/domain/myWeek'
  import { kindName } from '../../lib/domain/appointments'
  import { de } from '../../lib/domain/francais'
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
  import { enClair } from '../../lib/erreurs'

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

  /*
    Le numéro de la lecture en cours. Un `let` ordinaire, non réactif : le lire dans
    l'effet en ferait une dépendance, et l'écrire relancerait l'effet sans fin.

    Il sert à jeter une réponse en retard. On passe d'une personne à l'autre en changeant
    l'adresse, sans recharger la page : deux lectures peuvent voyager en même temps, et
    celle de la personne précédente peut arriver en dernier. Sur une feuille de semaine,
    cela veut dire le rendez-vous de quelqu'un d'autre.
  */
  let lecture = 0

  /*
    L'effet dépend de la personne, pas seulement de la semaine.

    Sans `patientUid` dans ses dépendances, passer de #/soignant/planning/A à
    #/soignant/planning/B ne relançait rien : le composant gardait les inscriptions de A
    — titre compris — pendant que la liste des rendez-vous, elle, se recalculait pour B.
    La feuille « La semaine de A » portait donc le rendez-vous médical de B.
  */
  $effect(() => {
    const debut = staffStore.week[0]
    const qui = patientUid
    if (debut === undefined || qui === '') return
    void charger(qui)
  })

  async function charger(qui: string): Promise<void> {
    const mienne = ++lecture
    chargement = true
    erreur = null
    try {
      // Deux lectures indépendantes : elles partent ensemble.
      const [, tous] = await Promise.all([staffStore.loadAppointments(), staffStore.weekPlannings()])
      if (mienne !== lecture) return
      planning = tous.find((p) => p.patientUid === qui) ?? null
    } catch (error) {
      if (mienne !== lecture) return
      erreur = enClair(error)
    } finally {
      if (mienne === lecture) chargement = false
    }
  }

  const semaine = $derived.by(() => {
    const charge = planning
    if (charge === null) return []
    const inscriptions = charge.lines
      .map((ligne) => {
        const occurrence = staffStore.occurrences.find((o) => o.id === ligne.occurrenceId)
        return occurrence === undefined ? null : { occurrence, status: ligne.status }
      })
      .filter((v) => v !== null)
    const debut = staffStore.week[0] ?? ''
    const fin = staffStore.week[6] ?? ''
    /*
      Les rendez-vous se filtrent sur la personne du planning chargé, jamais sur le
      `patientUid` de l'adresse. Les deux disent normalement la même chose ; le jour où
      ils divergent — une lecture en retard, un effet mal branché — c'est le rendez-vous
      de quelqu'un d'autre qui s'écrit sur la feuille, et cela ne doit pas pouvoir arriver.
    */
    const rendezVous = staffStore.appointments.filter(
      (r) =>
        r.patientUid === charge.patientUid &&
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
      <h1 class="mb-1 text-3xl font-bold text-ink">La semaine {de(planning.firstName)}</h1>
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
                <!--
                  La clef est le rang, et non le contenu : deux entrées qui commencent à
                  la même minute — deux ateliers à 10h00, c'est le cas courant — donnent
                  la même clef, et Svelte arrête alors le rendu. L'écran reste figé sur
                  l'affichage précédent, sans un mot, ni à l'écran ni en console. La liste
                  est reconstruite en entier à chaque lecture ; le rang suffit.
                -->
                {#each jour.entries as entree, rang (rang)}
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
