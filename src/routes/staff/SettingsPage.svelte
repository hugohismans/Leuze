<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import {
    PATIENT_ACTIONS,
    actionConsequence,
    actionLabel,
    allOpen,
    permissionsSummary,
  } from '../../lib/domain/permissions'
  import { navigate } from '../../lib/router.svelte'
  import { proposed } from '../../lib/domain/catalog'

  /**
   * Ce que les patients ont le droit de faire.
   *
   * Quatre gestes, quatre interrupteurs. Ce n'est pas un réglage technique : c'est une
   * décision d'organisation, et elle appartient au service. Une unité peut vouloir
   * commencer en lecture seule — les patients regardent le programme, la réunion du lundi
   * inscrit, comme sur le papier qu'elle remplace — puis ouvrir l'inscription
   * individuelle quand tout le monde a pris ses marques.
   *
   * Chaque interrupteur dit ce que le fermer change, avant qu'on le ferme. C'est
   * l'essentiel de cet écran : fermer « se retirer d'une activité » sans y avoir pensé,
   * c'est obliger quelqu'un à trouver un soignant pour défaire ce qu'il vient de faire —
   * et une inscription qu'on ne peut pas défaire décourage de s'inscrire.
   */
  let enCours = $state<string | null>(null)

  if (staffStore.isAdmin) staffStore.loadPatientPermissions()

  /**
   * L'unité de rattachement du compte.
   *
   * L'hôpital n'a pas un poste d'administration mais plusieurs : une bulle par unité de
   * soins. Sans ce réglage, chaque écran s'ouvrait sur l'hôpital entier et il fallait
   * re-choisir son unité partout, à chaque fois, et sur chaque poste — le choix était
   * retenu par le navigateur, pas par le compte.
   *
   * Il ne retire aucun droit : une case, sur les écrans concernés, rend l'hôpital entier.
   */
  // Un service retiré du catalogue n'est plus proposé.
  const unites = $derived(proposed(staffStore.catalog.services))
  let unitEnCours = $state(false)

  async function choisirUnite(valeur: string): Promise<void> {
    if (unitEnCours) return
    unitEnCours = true
    try {
      await staffStore.setMyUnit(valeur === '' ? null : valeur)
    } finally {
      unitEnCours = false
    }
  }

  async function basculer(action: (typeof PATIENT_ACTIONS)[number], ouvert: boolean): Promise<void> {
    if (enCours === action) return
    enCours = action
    try {
      await staffStore.setServiceAction(action, ouvert)
    } finally {
      enCours = null
    }
  }
</script>

<section class="mx-auto max-w-3xl px-4 py-6">
  <h1 class="mb-1 text-3xl font-bold text-ink">Réglages</h1>

  {#if staffStore.message !== null}
    <p role="status" class="mt-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <!--
    Le rattachement à une unité n'est pas réservé à l'administrateur : un kinésithérapeute
    qui travaille dans une unité a le même intérêt à ne pas voir passer les patients des
    sept autres. Ce n'est pas un droit qu'on s'accorde — c'est le réglage de son écran.
  -->
  <h2 class="mt-6 mb-1 text-2xl font-bold text-ink">Votre unité</h2>
  <p class="mb-3 text-lg text-ink-soft">
    {#if staffStore.unitLabel !== null}
      Vos écrans s'ouvrent sur {staffStore.unitLabel}.
    {:else}
      Vos écrans s'ouvrent sur tout l'hôpital.
    {/if}
  </p>

  <div class="card p-5">
    <label for="unite" class="mb-2 block text-lg font-semibold text-ink">
      Je travaille dans
    </label>
    <select
      id="unite"
      class="w-full min-w-0 max-w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
      style="min-height: 56px;"
      disabled={unitEnCours}
      value={staffStore.unitId ?? ''}
      onchange={(event) => choisirUnite(event.currentTarget.value)}
    >
      <option value="">Tout l'hôpital — aucune unité en particulier</option>
      {#each unites as unite (unite.id)}
        <option value={unite.id}>{unite.name}</option>
      {/each}
    </select>
    <p class="mt-3 text-base text-ink-soft">
      Les rendez-vous, la réunion du lundi et la liste des patients s'ouvriront sur cette
      unité. Rien ne vous est retiré : une case « Voir toutes les unités » vous rend
      l'hôpital entier quand vous en avez besoin.
    </p>
  </div>

  {#if !staffStore.isAdmin}
    <p class="card mt-6 p-5 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Ce que les patients ont le droit de faire est réglé par l'administrateur : cela
      engage tout le service, pas une activité en particulier.
    </p>
    <button type="button" class="btn btn-secondary mt-4" onclick={() => navigate('/soignant')}>
      <span aria-hidden="true">←</span> Retour à la semaine
    </button>
  {:else}
    <h2 class="mt-8 mb-1 text-2xl font-bold text-ink">Ce que les patients peuvent faire</h2>
    <p class="mb-4 text-lg text-ink-soft">{permissionsSummary(staffStore.patientPermissions)}</p>

    <p class="mb-5 rounded-xl border-2 border-line bg-surface-soft p-4 text-lg text-ink">
      Ces réglages valent pour tous les patients, et prennent effet en une demi-minute.
      Un geste fermé n'est pas caché : la personne lit à la place ce qu'elle doit faire,
      et à qui s'adresser.
    </p>

    <ul class="grid gap-4">
      {#each PATIENT_ACTIONS as action (action)}
        {@const ouvert = staffStore.patientPermissions[action] !== false}
        <li class="card p-5">
          <!--
            Un vrai interrupteur, avec un mot à côté : jamais la couleur seule, et jamais
            une case dont on doive deviner ce qu'elle veut dire quand elle est cochée.
          -->
          <label class="flex items-start gap-3" style="min-height: 56px;">
            <input
              type="checkbox"
              class="mt-1 h-6 w-6"
              checked={ouvert}
              disabled={enCours === action}
              onchange={(event) => basculer(action, event.currentTarget.checked)}
            />
            <span>
              <span class="text-xl font-bold text-ink">{actionLabel(action)}</span>
              <span class="block text-lg font-semibold" class:text-ink={ouvert} class:text-ink-soft={!ouvert}>
                {ouvert ? 'Ouvert aux patients' : 'Fermé — se fait avec un soignant'}
              </span>
            </span>
          </label>
          <p class="mt-2 text-base text-ink-soft">{actionConsequence(action)}</p>
        </li>
      {/each}
    </ul>

    {#if allOpen(staffStore.patientPermissions)}
      <p class="mt-5 text-base text-ink-soft">
        Tout est ouvert : c'est l'état d'origine, et celui que l'application avait avant
        que ce réglage existe.
      </p>
    {/if}

    <button type="button" class="btn btn-secondary mt-6" onclick={() => navigate('/soignant')}>
      <span aria-hidden="true">←</span> Retour à la semaine
    </button>
  {/if}
</section>
