<script lang="ts">
  import { store } from '../lib/appState.svelte'
  import { PREFERENCE_LABELS, kindIcon, patientStatusLabel } from '../lib/domain/appointments'
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
  let preference = $state<AppointmentPreference>('peu-importe')
  let message = $state<string | null>(null)
  let busy = $state(false)

  const PREFERENCES: AppointmentPreference[] = ['matin', 'apres-midi', 'peu-importe']

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
      const resultat = await store.requestAppointment(kindId, preference)
      message = resultat.message
      if (resultat.ok) {
        kindId = null
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

  {#if store.appointments.length > 0}
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
    </ul>
  {/if}

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
          onclick={() => (kindId = kindId === kind.id ? null : kind.id)}
        >
          <span class="text-lg font-semibold text-ink">
            <span aria-hidden="true">{kindId === kind.id ? '✓' : kind.icon}</span>
            {kind.name}
          </span>
        </button>
      </li>
    {/each}
  </ul>

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
    <span aria-hidden="true">←</span> Retour à mes inscriptions
  </button>
</section>
