<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { myWeek, type WeekEntry } from '../../lib/domain/myWeek'
  import { kindIcon, kindName } from '../../lib/domain/appointments'
  import {
    addLocalDays,
    formatDayLabel,
    formatLongDayLabel,
    formatTimeRange,
    startOfIsoWeek,
    todayLocalDate,
  } from '../../lib/domain/time'
  import WeekSheet from '../../lib/ui/WeekSheet.svelte'
  import { navigate } from '../../lib/router.svelte'

  /**
   * La semaine d'un intervenant : ce qu'il anime, et ses rendez-vous.
   *
   * Deux usages. Savoir où il est — « elle est avec le docteur Lemaire » devient
   * vérifiable. Et lui remettre sa semaine sur papier, comme on le fait pour les patients.
   *
   * C'est l'agenda de travail de cette personne : il nomme donc qui elle reçoit, à quelle
   * heure, pour quel motif et de quel service. Un agenda de psychiatre sans les noms ne
   * sert à rien.
   *
   * ⚠️ La feuille imprimée devient de ce fait nominative — elle porte la mention qui le
   * dit. C'est un écran du personnel : aucun patient n'y accède, et les règles Firestore
   * le tiennent, pas l'interface.
   */
  let { practitionerId }: { practitionerId: string } = $props()

  const intervenant = $derived(store.practitionerOf(practitionerId))

  const seances = $derived(
    staffStore.occurrences.filter((o) => o.facilitatorId === practitionerId && o.status !== 'cancelled'),
  )

  const rendezVous = $derived(
    staffStore.appointments.filter(
      (r) =>
        r.practitionerId === practitionerId &&
        r.status === 'scheduled' &&
        r.localDate !== undefined &&
        r.localDate >= (staffStore.week[0] ?? '') &&
        r.localDate <= (staffStore.week[6] ?? ''),
    ),
  )

  /** Prénom et service de la personne reçue. Rien d'autre n'est enregistré nulle part. */
  const recu = (patientUid: string | undefined): { prenom: string; service: string } | null => {
    const patient = staffStore.patients.find((p) => p.uid === patientUid)
    if (patient === undefined) return null
    return {
      prenom: patient.firstName,
      service: store.serviceOf(patient.serviceId)?.name ?? patient.serviceId,
    }
  }

  const semaine = $derived(
    myWeek(
      staffStore.week,
      seances.map((occurrence) => ({ occurrence, status: 'confirmed' as const })),
      // Sur sa propre feuille, son nom n'apprend rien : la place est rendue à la
      // personne qu'il reçoit, qui est ce qu'il vient y chercher.
      rendezVous.map((rendezVous) => {
        const personne = recu(rendezVous.patientUid)
        return {
          ...rendezVous,
          withWhom:
            personne === null
              ? kindName(store.appointmentKinds, rendezVous.kindId)
              : `${personne.prenom} · ${personne.service}`,
        }
      }),
    ),
  )

  const compte = $derived(seances.length + rendezVous.length)

  const allerSemaine = (decalage: number): void => {
    staffStore.date = addLocalDays(startOfIsoWeek(staffStore.date), decalage * 7)
    void staffStore.refresh()
  }

  // Les rendez-vous ont pu être fixés depuis un autre écran.
  staffStore.loadAppointments()

  /** Ce qui s'affiche à l'écran : tout, en toutes lettres. */
  const intitule = (entree: WeekEntry): string => {
    if (entree.kind === 'activity') return entree.title
    const motif = kindName(store.appointmentKinds, entree.kindId)
    const personne = recu(entree.patientUid)
    // Qui, d'où, pour quoi — dans cet ordre : c'est le nom qu'on cherche des yeux.
    return personne === null ? motif : `${personne.prenom} · ${personne.service} · ${motif}`
  }
</script>

<section class="mx-auto max-w-3xl px-4 py-6">
  <div class="no-print">
    <button type="button" class="btn btn-secondary mb-4" onclick={() => navigate('/soignant/personnel')}>
      <span aria-hidden="true">←</span> Retour au personnel
    </button>

    {#if intervenant === null}
      <p class="card p-5 text-lg text-ink-soft">Cet intervenant n'a pas été trouvé.</p>
    {:else}
      <h1 class="mb-1 text-3xl font-bold text-ink">La semaine de {intervenant.name}</h1>
      <p class="mb-4 text-lg text-ink-soft">
        {intervenant.role} · du {formatDayLabel(staffStore.week[0]!)} au {formatDayLabel(staffStore.week[6]!)}
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
          <span aria-hidden="true">🖨️</span> Imprimer sa semaine
        </button>
      </div>

      {#if compte === 0}
        <p class="card p-5 text-lg text-ink-soft">
          Rien de prévu cette semaine pour {intervenant.name}.
        </p>
      {:else}
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
                      <span aria-hidden="true">
                        {entree.kind === 'appointment'
                          ? kindIcon(store.appointmentKinds, entree.kindId)
                          : (store.categoryOf(entree.categoryId)?.icon ?? '•')}
                      </span>
                      <span class="font-semibold">{formatTimeRange(entree.start, entree.end)}</span>
                      — {intitule(entree)}
                      {#if entree.locationId}
                        <span class="text-base text-ink-soft">
                          · {store.locationOf(entree.locationId)?.name ?? ''}
                        </span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>

        <p class="mt-4 text-base text-ink-soft">
          Cette feuille nomme les personnes reçues : ne la laissez pas sur un bureau. La
          liste des inscrits d'une activité se consulte depuis « Aujourd'hui ».
        </p>
      {/if}
    {/if}
  </div>

  {#if intervenant !== null}
    <WeekSheet
      titre={`Semaine de ${intervenant.name}`}
      sousTitre={`${intervenant.role} · du ${formatDayLabel(staffStore.week[0]!)} au ${formatDayLabel(staffStore.week[6]!)}`}
      mention="Document nominatif — à ne pas laisser sans surveillance."
      week={semaine}
    />
  {/if}
</section>

<style>
  .aujourdhui {
    border-color: var(--color-brand-500);
  }
</style>
