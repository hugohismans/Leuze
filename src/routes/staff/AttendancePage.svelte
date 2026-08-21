<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { attendanceLabel, attendanceRefusal, countAttendance } from '../../lib/domain/attendance'
  import { isVisibleToService } from '../../lib/domain/audience'
  import { staffCapacityLabel } from '../../lib/domain/capacity'
  import { formatLongDayLabel, formatTimeRange } from '../../lib/domain/time'
  import { navigate } from '../../lib/router.svelte'

  /**
   * L'appel d'une activité : qui était là, qui ne l'était pas.
   *
   * Fait sur papier jusqu'ici. Deux gestes, et deux seulement : cocher présent ou absent
   * pour les inscrits, et ajouter quelqu'un qui s'est présenté sans s'être inscrit — ce
   * dernier cas est fréquent, il ne doit pas être plus difficile que le premier.
   *
   * L'appel n'est visible et modifiable que par la personne qui anime l'activité, ou par
   * un administrateur. Les autres voient la liste des inscrits, sans les présences.
   */
  let { occurrenceId }: { occurrenceId: string } = $props()

  const occurrence = $derived(staffStore.occurrences.find((o) => o.id === occurrenceId) ?? null)
  let message = $state<string | null>(null)
  let busy = $state(false)
  let ajoutOuvert = $state(false)

  /*
    Réveiller la fonction de l'appel pendant qu'on lit la liste : la première case cochée
    ne paie plus le démarrage d'une fonction endormie.
  */
  $effect(() => {
    void staffStore.warmAttendance()
  })

  $effect(() => {
    void occurrenceId
    void staffStore.openRoster(occurrenceId)
  })

  const compte = $derived(countAttendance(staffStore.roster))

  /** Qui peut encore être ajouté : les patients du service concerné, pas déjà inscrits. */
  const ajoutables = $derived(
    occurrence === null
      ? []
      : staffStore.patients
          .filter((patient) => isVisibleToService(occurrence, patient.serviceId))
          .filter((patient) => !staffStore.roster.some((ligne) => ligne.patientUid === patient.uid))
          .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr')),
  )

  async function noter(patientUid: string, valeur: 'present' | 'absent' | null): Promise<void> {
    if (busy) return
    busy = true
    message = await staffStore.markAttendance(occurrenceId, patientUid, valeur)
    busy = false
  }

  async function ajouter(patientUid: string): Promise<void> {
    if (busy) return
    busy = true
    // Ajouter quelqu'un, c'est le noter présent : il est là, c'est tout le propos.
    message = await staffStore.markAttendance(occurrenceId, patientUid, 'present')
    ajoutOuvert = false
    busy = false
  }
</script>

<section class="mx-auto max-w-3xl px-4 py-6">
  <button type="button" class="btn btn-secondary mb-4" onclick={() => navigate('/soignant/aujourdhui')}>
    <span aria-hidden="true">←</span> Retour à la journée
  </button>

  {#if occurrence === null}
    <p class="card p-5 text-lg text-ink-soft">Cette activité n'a pas été trouvée.</p>
  {:else}
    <h1 class="mb-1 text-3xl font-bold text-ink">L'appel — {occurrence.title}</h1>
    <p class="mb-1 text-lg text-ink">
      {formatLongDayLabel(occurrence.localDate)} · {formatTimeRange(occurrence.start, occurrence.end)}
    </p>
    <p class="mb-4 text-base text-ink-soft">
      {store.locationOf(occurrence.locationId)?.name ?? occurrence.locationId}
      {#if occurrence.facilitator}· avec {occurrence.facilitator}{/if}
    </p>

    {#if !staffStore.canMarkAttendance}
      <p role="status" class="card mb-4 p-4 text-lg text-ink">
        <span aria-hidden="true">🔒</span>
        {attendanceRefusal(occurrence)}
        Vous voyez la liste des inscrits, sans les présences.
      </p>
    {:else}
      <p class="card mb-4 p-4 text-lg font-semibold text-ink">
        {attendanceLabel(compte)}
      </p>
    {/if}

    {#if message !== null}
      <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
        {message}
      </p>
    {/if}

    {#if staffStore.roster.length === 0}
      <p class="card p-5 text-lg text-ink-soft">Personne n'est inscrit à cette activité.</p>
    {:else}
      <ul class="grid gap-3">
        {#each staffStore.roster as ligne (ligne.patientUid)}
          <li class="card p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p class="text-xl font-bold text-ink">{ligne.firstName}</p>
                <p class="text-base text-ink-soft">
                  {store.serviceOf(ligne.serviceId ?? '')?.name ?? ''}
                  {#if ligne.status === 'waitlist'}· en liste d'attente{/if}
                </p>
              </div>
              {#if staffStore.canMarkAttendance}
                <!-- L'état coché est doublé d'un mot : jamais la couleur seule. -->
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn"
                    class:btn-primary={ligne.attendance === 'present'}
                    class:btn-secondary={ligne.attendance !== 'present'}
                    aria-pressed={ligne.attendance === 'present'}
                    disabled={busy}
                    onclick={() => noter(ligne.patientUid, ligne.attendance === 'present' ? null : 'present')}
                  >
                    <span aria-hidden="true">✓</span> Présent
                  </button>
                  <button
                    type="button"
                    class="btn"
                    class:btn-primary={ligne.attendance === 'absent'}
                    class:btn-secondary={ligne.attendance !== 'absent'}
                    aria-pressed={ligne.attendance === 'absent'}
                    disabled={busy}
                    onclick={() => noter(ligne.patientUid, ligne.attendance === 'absent' ? null : 'absent')}
                  >
                    <span aria-hidden="true">✗</span> Absent
                  </button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if staffStore.canMarkAttendance}
      <div class="mt-6">
        {#if !ajoutOuvert}
          <button type="button" class="btn btn-primary" onclick={() => (ajoutOuvert = true)}>
            <span aria-hidden="true">＋</span> Quelqu'un s'est présenté
          </button>
        {:else}
          <div class="card p-4">
            <h2 class="mb-1 text-2xl font-bold text-ink">Qui s'est présenté ?</h2>
            <p class="mb-3 text-lg text-ink-soft">
              La personne est inscrite et notée présente d'un seul geste. Seules les
              personnes des services concernés par l'activité sont proposées.
            </p>
            {#if ajoutables.length === 0}
              <p class="text-lg text-ink-soft">Tout le monde est déjà sur la liste.</p>
            {:else}
              <ul class="grid gap-2">
                {#each ajoutables as patient (patient.uid)}
                  <li>
                    <button
                      type="button"
                      class="btn btn-secondary w-full text-left"
                      disabled={busy}
                      onclick={() => ajouter(patient.uid)}
                    >
                      <span class="text-xl font-bold">{patient.firstName}</span>
                      <span class="block text-base text-ink-soft">
                        {store.serviceOf(patient.serviceId)?.name ?? patient.serviceId}
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <button type="button" class="btn btn-secondary mt-3" onclick={() => (ajoutOuvert = false)}>
              Annuler
            </button>
          </div>
        {/if}
      </div>

      <p class="mt-4 text-base text-ink-soft">
        {staffCapacityLabel(occurrence)}. Une personne ajoutée alors que l'activité est
        complète passe en liste d'attente, comme partout ailleurs.
      </p>
    {/if}
  {/if}
</section>
