<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import { PREFERENCE_LABELS, kindIcon, patientStatusLabel } from '../lib/domain/appointments'
  import { practitionerChoiceNotice } from '../lib/domain/practitioners'
  import type { AppointmentPreference } from '../lib/domain/types'
  import { navigate } from '../lib/router.svelte'

  /**
   * Demander un rendez-vous.
   *
   * Deux principes tiennent tout cet écran :
   *  - **aucun champ libre.** Le patient dit qui il veut voir, jamais pourquoi. Un texte
   *    libre ici deviendrait le réceptacle de contenu clinique, ce que ce projet
   *    s'interdit — et ce qu'aucun soignant ne devrait avoir à lire dans une application.
   *  - **ce n'est pas un canal d'urgence**, et l'écran le dit avant tout le reste. Une
   *    demande passe par une file relevée par l'équipe ; elle ne réveille personne.
   */
  // Relecture à l'arrivée : la demande a pu être traitée entre-temps.
  store.loadAppointments()

  let kindId = $state<string | null>(null)
  /**
   * La personne demandée. Vide veut dire « peu importe », et reste le choix par défaut.
   *
   * Souvent le patient ne veut pas « un psychiatre » mais celui qu'il connaît, et ne pas
   * pouvoir le dire, c'est être renvoyé au bouche-à-oreille. Ce n'est pas une promesse :
   * la demande reste une demande, et c'est l'équipe qui fixe.
   *
   * Le tri n'est pas fait ici : `requestablePractitioners` ne rend que les personnes en
   * poste qui tiennent ce motif **et** passent dans l'unité du patient, et le serveur
   * revérifie la même chose avant d'enregistrer.
   */
  let quiId = $state('')
  let preference = $state<AppointmentPreference>('peu-importe')
  let message = $state<string | null>(null)
  let busy = $state(false)

  const PREFERENCES: AppointmentPreference[] = ['matin', 'apres-midi', 'peu-importe']

  const proposables = $derived(kindId === null ? [] : store.requestablePractitioners(kindId))
  const avisChoix = $derived(practitionerChoiceNotice(proposables.length))

  /*
    Réveiller la fonction de demande pendant qu'on choisit son motif : on lit la page,
    on choisit, et le bouton ne paie plus le démarrage d'une fonction endormie.
  */
  $effect(() => {
    void store.warmAppointment()
  })

  async function envoyer(): Promise<void> {
    if (kindId === null || busy) return
    busy = true
    try {
      const resultat = await store.requestAppointment(kindId, preference, quiId === '' ? undefined : quiId)
      message = resultat.message
      if (resultat.ok) {
        kindId = null
        quiId = ''
        preference = 'peu-importe'
      }
    } finally {
      // Quoi qu'il arrive, le bouton redevient utilisable.
      busy = false
    }
  }

  /**
   * Retirer une demande verrouillait le formulaire de demande — deux gestes sans rapport
   * partageaient le même verrou — et n'avait aucune garde contre le double appui. Chaque
   * demande se garde désormais elle-même ; la ligne disparaît dans le geste.
   */
  let retraitEnCours = $state<string | null>(null)

  async function retirer(appointmentId: string): Promise<void> {
    if (retraitEnCours === appointmentId) return
    retraitEnCours = appointmentId
    try {
      message = (await store.withdrawAppointment(appointmentId)).message
    } finally {
      retraitEnCours = null
    }
  }
</script>

<section class="mx-auto max-w-3xl px-4 py-6">
  <h1 class="mb-3 text-3xl font-bold text-ink">Demander un rendez-vous</h1>

  <p class="mb-5 rounded-xl border-2 border-line bg-surface-soft p-4 text-lg text-ink">
    <span aria-hidden="true">⚠️</span>
    Cette page ne sert pas à demander de l'aide tout de suite. Si vous ne vous sentez pas
    bien maintenant, adressez-vous à un soignant, dans le service.
  </p>

  {#if store.appointments.some((a) => a.status !== 'cancelled') || store.cancelledAppointments.length > 0}
    <h2 class="mb-2 text-2xl font-bold text-ink">Vos rendez-vous</h2>
    <ul class="mb-6 grid gap-3">
      {#each store.appointments.filter((a) => a.status !== 'cancelled') as rendezVous (rendezVous.id)}
        <li class="card p-4">
          <p class="text-lg text-ink">
            <span aria-hidden="true">{kindIcon(store.appointmentKinds, rendezVous.kindId)}</span>
            {patientStatusLabel(rendezVous, store.appointmentKinds)}
          </p>
          {#if rendezVous.status === 'requested'}
            <p class="text-base text-ink-soft">{PREFERENCE_LABELS[rendezVous.preference]}</p>
            <button
              type="button"
              class="btn btn-secondary mt-3"
              disabled={retraitEnCours === rendezVous.id}
              onclick={() => retirer(rendezVous.id)}
            >
              Retirer ma demande
            </button>
          {/if}
        </li>
      {/each}
      <!--
        Un rendez-vous annulé par un soignant reste visible, avec son motif : une ligne
        qui s'efface sans un mot fait venir la personne pour rien.
      -->
      {#each store.cancelledAppointments as annule (annule.id)}
        <li class="card p-4">
          <p class="text-lg text-ink">
            <span aria-hidden="true">✕</span>
            {patientStatusLabel(annule, store.appointmentKinds)}
          </p>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !store.may('requestAppointment')}
    <!--
      Le formulaire disparaît, pas la page : les rendez-vous déjà fixés restent au-dessus,
      et l'on dit ce qu'il faut faire pour en demander un nouveau.
    -->
    <p role="status" class="card p-5 text-lg text-ink">
      <span aria-hidden="true">💬</span>
      {store.refusal('requestAppointment')}
    </p>

    <button type="button" class="btn btn-secondary mt-5" onclick={() => navigate('/mes-inscriptions')}>
      <span aria-hidden="true">📋</span> Voir mes inscriptions
    </button>
  {:else}
  <h2 class="mb-2 text-2xl font-bold text-ink">Qui souhaitez-vous voir ?</h2>
  <ul class="mb-5 grid gap-2 sm:grid-cols-2">
    {#each store.appointmentKinds as kind (kind.id)}
      <li>
        <button
          type="button"
          class="w-full rounded-xl border-2 p-4 text-left"
          class:border-brand-700={kindId === kind.id}
          class:bg-brand-100={kindId === kind.id}
          class:border-line={kindId !== kind.id}
          aria-pressed={kindId === kind.id}
          onclick={() => {
            // Changer de motif efface la personne : elle ne tenait pas ce motif-là, et
            // la garder enverrait une demande que le serveur refuserait.
            kindId = kindId === kind.id ? null : kind.id
            quiId = ''
          }}
        >
          <span class="text-lg font-semibold text-ink">
            <span aria-hidden="true">{kindId === kind.id ? '✓' : kind.icon}</span>
            {kind.name}
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <!--
    Une personne en particulier — et jamais une obligation.

    « Peu importe » reste en tête et reste le choix par défaut : quelqu'un qui n'a pas
    d'idée ne doit pas avoir à en prendre une, et la première place libre chez n'importe
    qui vaut souvent mieux qu'une attente chez une personne précise.

    La liste ne s'affiche pas quand elle serait vide : un titre suivi de rien laisse
    croire à une panne.
  -->
  {#if proposables.length > 0}
    <h2 class="mb-1 text-2xl font-bold text-ink">Avec qui ?</h2>
    <p class="mb-2 text-lg text-ink-soft">{avisChoix}</p>
    <ul class="mb-5 grid gap-2 sm:grid-cols-2">
      <li>
        <button
          type="button"
          class="w-full rounded-xl border-2 p-4 text-left"
          class:border-brand-700={quiId === ''}
          class:bg-brand-100={quiId === ''}
          class:border-line={quiId !== ''}
          aria-pressed={quiId === ''}
          onclick={() => (quiId = '')}
        >
          <span class="text-lg font-semibold text-ink">
            <span aria-hidden="true">{quiId === '' ? '✓' : '·'}</span>
            Peu importe — la première personne disponible
          </span>
        </button>
      </li>
      {#each proposables as personne (personne.id)}
        <li>
          <button
            type="button"
            class="w-full rounded-xl border-2 p-4 text-left"
            class:border-brand-700={quiId === personne.id}
            class:bg-brand-100={quiId === personne.id}
            class:border-line={quiId !== personne.id}
            aria-pressed={quiId === personne.id}
            onclick={() => (quiId = quiId === personne.id ? '' : personne.id)}
          >
            <span class="block text-lg font-semibold text-ink">
              <span aria-hidden="true">{quiId === personne.id ? '✓' : '·'}</span>
              {personne.name}
            </span>
            {#if personne.role !== ''}
              <span class="block text-base text-ink-soft">{personne.role}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <h2 class="mb-2 text-2xl font-bold text-ink">À quel moment cela vous arrange ?</h2>
  <ul class="mb-5 grid gap-2 sm:grid-cols-3">
    {#each PREFERENCES as valeur (valeur)}
      <li>
        <button
          type="button"
          class="w-full rounded-xl border-2 p-4 text-left"
          class:border-brand-700={preference === valeur}
          class:bg-brand-100={preference === valeur}
          class:border-line={preference !== valeur}
          aria-pressed={preference === valeur}
          onclick={() => (preference = valeur)}
        >
          <span class="text-lg font-semibold text-ink">
            <span aria-hidden="true">{preference === valeur ? '✓' : '·'}</span>
            {PREFERENCE_LABELS[valeur]}
          </span>
        </button>
      </li>
    {/each}
  </ul>

  {#if message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-4 text-lg font-semibold text-brand-900">
      {message}
    </p>
  {/if}

  <button type="button" class="btn btn-primary w-full" disabled={kindId === null || busy} onclick={envoyer}>
    {busy ? 'Un instant…' : 'Envoyer ma demande'}
  </button>

  <p class="mt-4 text-base text-ink-soft">
    Un soignant regardera votre demande et viendra vous dire le jour et l'heure. Le
    rendez-vous apparaîtra alors dans « Mes inscriptions ».
  </p>

  <button type="button" class="btn btn-secondary mt-5" onclick={() => navigate('/mes-inscriptions')}>
    <span aria-hidden="true">📋</span> Voir mes inscriptions
  </button>
  {/if}
</section>
