<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { formatLongDayLabel, localDateOf } from '../../lib/domain/time'
  import type { NewPatientCode } from '../../lib/data/staffPorts'

  /**
   * Les patients et leurs codes d'accès.
   *
   * Le strict minimum est enregistré : un prénom et un service. Aucun nom de famille,
   * aucune date de naissance, aucun numéro de dossier — et l'écran ne propose même pas
   * de champ pour en saisir.
   *
   * Le code n'est affiché **qu'une fois**, au moment de sa création : la base n'en garde
   * que l'empreinte. Perdu, il ne se retrouve pas, on en délivre un nouveau.
   */
  let prenom = $state('')
  let serviceId = $state('')
  let busy = $state(false)
  let erreur = $state<string | null>(null)
  /** Le code fraîchement délivré, à recopier ou imprimer avant de fermer. */
  let codeDelivre = $state<NewPatientCode | null>(null)

  const services = $derived(staffStore.catalog.services)

  $effect(() => {
    if (serviceId === '' && services.length > 0) serviceId = services[0]!.id
  })

  const parService = $derived(
    services
      .map((service) => ({
        service,
        patients: staffStore.patients.filter((p) => p.serviceId === service.id),
      }))
      .filter((groupe) => groupe.patients.length > 0),
  )

  async function creer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy || prenom.trim().length === 0) return
    busy = true
    erreur = null
    try {
      codeDelivre = await staffStore.createPatient(prenom.trim(), serviceId)
      prenom = ''
    } catch (error) {
      erreur = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : "Le code n'a pas pu être créé."
    }
    busy = false
  }

  async function nouveauCode(patientUid: string): Promise<void> {
    if (busy) return
    busy = true
    erreur = null
    try {
      codeDelivre = await staffStore.regenerateCode(patientUid)
    } catch (error) {
      erreur = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : "Le code n'a pas pu être créé."
    }
    busy = false
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Les patients</h1>
  <p class="mb-5 text-lg text-ink-soft">
    Un prénom et un service, rien d'autre. Chaque personne reçoit un code, qui lui permet
    de voir son programme et de s'inscrire depuis une tablette.
  </p>

  {#if codeDelivre !== null}
    <!-- Le code, affiché une seule fois. La feuille se découpe et se remet en main propre. -->
    <div class="feuille card mb-6 border-4 border-brand-700 p-5">
      <h2 class="text-2xl font-bold text-ink">Code de {codeDelivre.firstName}</h2>
      <p class="my-4 text-center text-6xl font-bold tracking-[0.2em] text-brand-900">
        {codeDelivre.printableCode}
      </p>
      <p class="text-lg text-ink">
        À remettre à {codeDelivre.firstName}. Valable jusqu'au
        {formatLongDayLabel(localDateOf(codeDelivre.expiresAt))}.
      </p>
      <p class="mt-2 text-base text-ink-soft">
        Ce code ne sera plus affiché : la base n'en garde qu'une empreinte. S'il est perdu,
        délivrez-en un nouveau.
      </p>
      <div class="no-print mt-4 flex flex-wrap gap-2">
        <button type="button" class="btn btn-secondary" onclick={() => window.print()}>
          <span aria-hidden="true">🖨️</span> Imprimer
        </button>
        <button type="button" class="btn btn-primary" onclick={() => (codeDelivre = null)}>
          J'ai noté le code
        </button>
      </div>
    </div>
  {/if}

  <form onsubmit={creer} class="card mb-6 p-4">
    <h2 class="mb-3 text-2xl font-bold text-ink">Ajouter une personne</h2>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label for="prenom" class="mb-2 block text-lg font-semibold text-ink">Prénom</label>
        <input id="prenom" bind:value={prenom} class={champ} style="min-height: 56px;" autocomplete="off" />
      </div>
      <div>
        <label for="service" class="mb-2 block text-lg font-semibold text-ink">Service</label>
        <select id="service" bind:value={serviceId} class={champ} style="min-height: 56px;">
          {#each services as service (service.id)}
            <option value={service.id}>{service.name}</option>
          {/each}
        </select>
      </div>
    </div>
    <p class="mt-2 text-base text-ink-soft">
      N'inscrivez ni nom de famille, ni date de naissance, ni numéro de dossier. Un prénom
      suffit à s'y retrouver pendant la réunion.
    </p>
    {#if erreur !== null}
      <p role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
        <span aria-hidden="true">⚠️</span> {erreur}
      </p>
    {/if}
    <button type="submit" class="btn btn-primary mt-4" disabled={busy || prenom.trim().length === 0}>
      {busy ? 'Un instant…' : 'Créer le code'}
    </button>
  </form>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.patients.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      Aucune personne enregistrée. Ajoutez-en une ci-dessus : elle apparaîtra alors dans la
      réunion du lundi.
    </p>
  {:else}
    {#each parService as groupe (groupe.service.id)}
      <h2 class="mt-6 mb-3 text-2xl font-bold text-ink">{groupe.service.name}</h2>
      <ul class="grid gap-3">
        {#each groupe.patients as patient (patient.uid)}
          <li class="card p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h3 class="text-xl font-bold text-ink">{patient.firstName}</h3>
                {#if patient.expiresAt}
                  <p class="text-base text-ink-soft">
                    Code valable jusqu'au {formatLongDayLabel(localDateOf(patient.expiresAt))}
                  </p>
                {/if}
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => nouveauCode(patient.uid)}>
                  Nouveau code
                </button>
                <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => staffStore.endStay(patient.uid)}>
                  Fin de séjour
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}

  <p class="mt-6 text-base text-ink-soft">
    « Fin de séjour » retire la personne des listes et rend son code inutilisable. Ses
    inscriptions passées ne sont pas effacées ici : la purge automatique s'en charge après
    le délai de conservation.
  </p>
</section>
