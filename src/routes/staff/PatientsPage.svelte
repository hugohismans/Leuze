<script lang="ts">
  import {
    PATIENT_ACTIONS,
    actionLabel,
    hasOverrides,
    overrideOrigin,
  } from '../../lib/domain/permissions'
  import { staffStore } from '../../lib/staffState.svelte'
  import UnitFilter from './UnitFilter.svelte'
  import { proposed } from '../../lib/domain/catalog'
  import { store } from '../../lib/appState.svelte'
  import { presenceOf, type Presence } from '../../lib/domain/presence'
  import { formatLongDayLabel, formatTime, localDateOf } from '../../lib/domain/time'
  import type { NewPatientCode, PatientPlanning } from '../../lib/data/staffPorts'
  import { navigate } from '../../lib/router.svelte'
  import { enClair } from '../../lib/erreurs'

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

  // Un service retiré n'est plus proposé pour une nouvelle personne ; celles qui y sont
  // déjà rattachées continuent d'apparaître normalement.
  const services = $derived(proposed(staffStore.catalog.services))

  /*
    Le service proposé à la création : celui du compte quand il en a un.

    Il faut attendre que l'unité ait été **lue** : `unitId` vaut `null` aussi bien avant
    la lecture qu'en l'absence d'unité, et sans cette distinction on proposerait
    L'Ancrive — première de la liste — à la bulle de La Couturelle.

    « semee » est volontairement un « let » ordinaire, non réactif : le lire et l'écrire
    dans le même effet en ferait une dépendance de cet effet, qui se relancerait aussitôt.
  */
  let semee = false
  $effect(() => {
    if (semee || services.length === 0 || !staffStore.unitLoaded) return
    semee = true
    if (serviceId === '') serviceId = staffStore.unit ?? services[0]!.id
  })

  /**
   * Où en est chaque personne, maintenant : en activité, ou disponible. C'est la question
   * que se pose un soignant qui cherche quelqu'un dans l'unité.
   *
   * Relu toutes les minutes : une séance qui se termine doit libérer la personne à
   * l'écran sans qu'on recharge la page.
   */
  let plannings = $state<PatientPlanning[]>([])
  let maintenant = $state(new Date())

  /*
    Les plannings affichés sont ceux de la semaine demandée en dernier.

    Deux appuis rapprochés sur « Semaine suivante » lancent deux lectures ; sans
    précaution, la première peut revenir après la seconde et remplir l'écran avec la
    semaine d'avant, sous le bon titre. On jette ce qui est périmé.
  */
  $effect(() => {
    const debut = staffStore.week[0]
    if (debut === undefined) return
    let perimee = false
    void staffStore
      .weekPlannings()
      .then((valeur) => {
        if (!perimee) plannings = valeur
      })
      .catch(() => {
        if (!perimee) plannings = []
      })
    return () => {
      perimee = true
    }
  })

  $effect(() => {
    const minuterie = setInterval(() => (maintenant = new Date()), 60_000)
    return () => clearInterval(minuterie)
  })

  function presence(patientUid: string): Presence {
    const planning = plannings.find((p) => p.patientUid === patientUid)
    if (planning === undefined) return { kind: 'free', next: null }
    const lignes = planning.lines
      .map((ligne) => {
        const occurrence = staffStore.occurrences.find((o) => o.id === ligne.occurrenceId)
        return occurrence === undefined ? null : { occurrence, status: ligne.status }
      })
      .filter((v) => v !== null)
    return presenceOf(lignes, maintenant)
  }

  /*
    La liste s'ouvre sur l'unité du compte. Les autres unités ne sont pas perdues : la
    case ci-dessous les ramène toutes, et le nombre de personnes écartées est écrit.
  */
  const parService = $derived(
    services
      .map((service) => ({
        service,
        patients: staffStore.patientsOfUnit.filter((p) => p.serviceId === service.id),
      }))
      .filter((groupe) => groupe.patients.length > 0),
  )
  const ecartes = $derived(staffStore.patients.length - staffStore.patientsOfUnit.length)

  async function creer(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy || prenom.trim().length === 0) return
    busy = true
    erreur = null
    try {
      codeDelivre = await staffStore.createPatient(prenom.trim(), serviceId)
      prenom = ''
    } catch (error) {
      erreur = enClair(error)
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
      erreur = enClair(error)
    }
    busy = false
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'

  /*
    Le panneau des droits d'une personne, ouvert sur demande.

    Il ne s'affiche pas d'emblée : quatre réglages sur chaque fiche noieraient l'écran,
    alors qu'on n'y touche presque jamais. Le bouton, lui, dit quand il y a quelque chose
    à voir — « réglage particulier » quand cette personne diffère du service.
  */
  let droitsOuverts = $state<string | null>(null)

  /** Vrai quand cette personne a au moins un réglage qui la distingue du service. */
  const particulier = (patientUid: string): boolean =>
    hasOverrides(staffStore.patientActions[patientUid] ?? {})
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Les patients</h1>
  <p class="mb-4 text-lg text-ink-soft">
    Un prénom et un service, rien d'autre. Chaque personne reçoit un code, qui lui permet
    de voir son programme et de s'inscrire.
  </p>

  {#if !staffStore.isAdmin}
    <p role="status" class="mb-5 rounded-xl bg-surface-soft p-3 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Seul un administrateur ajoute une personne, délivre un code, clôture un séjour ou
      consulte un planning. Vous voyez ici qui est en activité et qui est libre.
    </p>
  {/if}

  {#if codeDelivre !== null}
    <!-- Le code, affiché une seule fois. La feuille se découpe et se remet en main propre. -->
    <div class="feuille feuille-portrait card mb-6 border-4 border-brand-700 p-5">
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

  {#if staffStore.isAdmin}
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
  {/if}

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <!-- L'unité de rattachement du compte, et de quoi en sortir. -->
  <UnitFilter hidden={ecartes} />

  {#if staffStore.patients.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      {staffStore.isAdmin
        ? 'Aucune personne enregistrée. Ajoutez-en une ci-dessus : elle apparaîtra alors dans la réunion du lundi.'
        : 'Aucune personne enregistrée. Un administrateur doit en ajouter une pour qu’elle apparaisse ici.'}
    </p>
  {:else if parService.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      Personne n'est rattaché à {staffStore.unitLabel}. Cochez « Voir toutes les unités »
      ci-dessus pour retrouver les autres.
    </p>
  {:else}
    {#each parService as groupe (groupe.service.id)}
      <h2 class="mt-6 mb-3 text-2xl font-bold text-ink">{groupe.service.name}</h2>
      <ul class="grid gap-3">
        {#each groupe.patients as patient (patient.uid)}
          {@const etat = presence(patient.uid)}
          <li class="card p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h3 class="text-xl font-bold text-ink">{patient.firstName}</h3>
                <!-- L'icône double la couleur : l'état ne se lit jamais à la teinte seule. -->
                {#if etat.kind === 'busy'}
                  <p class="text-lg font-semibold text-ink">
                    <span aria-hidden="true">🔵</span>
                    En activité : {etat.title}, jusqu'à {formatTime(etat.end)}
                  </p>
                  <p class="text-base text-ink-soft">
                    {store.locationOf(etat.locationId)?.name ?? ''}
                  </p>
                {:else}
                  <p class="text-lg font-semibold text-ink">
                    <span aria-hidden="true">⚪</span> Libre
                  </p>
                  {#if etat.next !== null}
                    <p class="text-base text-ink-soft">
                      Ensuite : {etat.next.title} à {formatTime(etat.next.start)}
                    </p>
                  {/if}
                {/if}
                {#if patient.expiresAt}
                  <p class="text-base text-ink-soft">
                    Code valable jusqu'au {formatLongDayLabel(localDateOf(patient.expiresAt))}
                  </p>
                {/if}
              </div>
              <div class="flex flex-wrap gap-2">
                {#if staffStore.isAdmin}
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onclick={() => navigate(`/soignant/planning/${patient.uid}`)}
                  >
                    Voir son planning
                  </button>
                {/if}
                {#if staffStore.isAdmin}
                  <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => nouveauCode(patient.uid)}>
                    Nouveau code
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    aria-expanded={droitsOuverts === patient.uid}
                    onclick={() => (droitsOuverts = droitsOuverts === patient.uid ? null : patient.uid)}
                  >
                    <!-- Le prénom plutôt qu'un pronom : on ne présume pas du genre. -->
                    Ce que {patient.firstName} peut faire{particulier(patient.uid) ? ' · réglage particulier' : ''}
                  </button>
                  <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => staffStore.endStay(patient.uid)}>
                    Fin de séjour
                  </button>
                {/if}
              </div>
            </div>

            {#if staffStore.isAdmin && droitsOuverts === patient.uid}
              <!--
                Trois états, et non deux : ouvert, fermé, ou « comme le service ».
                
                Le troisième est celui qui compte. Une simple case à cocher figerait ici la
                règle du jour : le service pourrait ensuite fermer un geste sans que cela
                change rien pour les quarante personnes dont la fiche l'avait recopié. Tant
                qu'on ne décide rien pour quelqu'un, il suit le service — et continue de le
                suivre quand celui-ci change.
              -->
              <div class="mt-3 border-t-2 border-line pt-3">
                <p class="mb-1 text-lg font-semibold text-ink">
                  Ce que {patient.firstName} peut faire dans l'application
                </p>
                <p class="mb-3 text-base text-ink-soft">
                  Sans réglage particulier, cette personne suit ce qui est décidé dans
                  « Réglages », pour tout le service.
                </p>

                <ul class="grid gap-3">
                  {#each PATIENT_ACTIONS as action (action)}
                    {@const sien = staffStore.patientActions[patient.uid]?.[action]}
                    {@const effectif = staffStore.effectiveFor(patient.uid)[action] !== false}
                    <li class="rounded-xl border-2 border-line p-3">
                      <p class="text-lg font-semibold text-ink">{actionLabel(action)}</p>
                      <div class="mt-2 flex flex-wrap gap-2">
                        {#each [{ v: null, t: 'Comme le service' }, { v: true, t: 'Oui' }, { v: false, t: 'Non' }] as choix (choix.t)}
                          <button
                            type="button"
                            class="btn"
                            class:btn-primary={sien === choix.v || (sien === undefined && choix.v === null)}
                            class:btn-secondary={!(sien === choix.v || (sien === undefined && choix.v === null))}
                            aria-pressed={sien === choix.v || (sien === undefined && choix.v === null)}
                            disabled={busy}
                            onclick={() => staffStore.setPatientAction(patient.uid, action, choix.v)}
                          >
                            {choix.t}
                          </button>
                        {/each}
                      </div>
                      <p class="mt-2 text-base text-ink-soft">
                        {overrideOrigin(action, staffStore.patientActions[patient.uid] ?? {})}
                        <span class="block font-semibold text-ink">
                          Aujourd'hui : {effectif ? 'ouvert' : 'fermé'} pour {patient.firstName}.
                        </span>
                      </p>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  {/if}

  {#if staffStore.isAdmin}
    <p class="mt-6 text-base text-ink-soft">
      « Fin de séjour » retire la personne des listes et rend son code inutilisable. Ses
      inscriptions passées ne sont pas effacées ici : la purge automatique s'en charge après
      le délai de conservation.
    </p>
  {/if}
</section>
