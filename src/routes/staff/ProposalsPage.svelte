<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { pendingProposals, waitingDays, type ActivityProposal } from '../../lib/domain/proposals'
  import { formatLongDayLabel, todayLocalDate } from '../../lib/domain/time'
  import { navigate } from '../../lib/router.svelte'

  /**
   * Les idées des patients.
   *
   * Une file à relever, comme celle des demandes de rendez-vous — et le même principe :
   * les plus anciennes d'abord, et l'attente qui se voit. Une idée déposée puis oubliée
   * décourage plus sûrement qu'un refus.
   *
   * Deux réponses, et deux seulement. **Retenir** : l'idée devient une activité, que
   * l'équipe animera ou dont elle confiera l'animation à la personne qui l'a proposée.
   * **Ne pas retenir** : avec une phrase, toujours — « non » sans raison décourage plus
   * que le refus lui-même, et la personne lira cette phrase telle quelle.
   */
  let enCours = $state<string | null>(null)
  let refusPour = $state<string | null>(null)
  let motif = $state('')

  if (staffStore.isAdmin) staffStore.loadProposals()

  const enAttente = $derived(pendingProposals(staffStore.proposals))
  const decidees = $derived(
    staffStore.proposals
      .filter((p) => p.status !== 'proposed')
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0)),
  )
  /** Retenues, mais dont l'activité n'a pas encore été créée : il reste un geste à faire. */
  const aCreer = $derived(decidees.filter((p) => p.status === 'accepted' && p.activityId === undefined))

  const aujourdHui = todayLocalDate()

  function attente(idee: ActivityProposal): string {
    const jours = waitingDays(idee)
    if (jours === 0) return "Déposée aujourd'hui"
    if (jours === 1) return 'Déposée hier'
    return `Déposée il y a ${jours} jours`
  }

  /**
   * Retenir une idée, puis créer l'activité.
   *
   * Les deux gestes sont distincts et l'écran ne les confond pas : on retient d'abord —
   * la personne a sa réponse tout de suite — et l'on va ensuite au formulaire, où le
   * titre et la description sont déjà recopiés. Si l'on n'y va pas, l'idée reste dans
   * « à créer » et le bouton la propose à nouveau : rien ne se perd.
   */
  async function retenir(idee: ActivityProposal): Promise<void> {
    if (enCours !== null) return
    enCours = idee.id
    try {
      const resultat = await staffStore.decideProposal(idee.id, 'accepted')
      if (resultat.ok) creerLActivite(idee)
    } finally {
      enCours = null
    }
  }

  function creerLActivite(idee: ActivityProposal): void {
    staffStore.propositionAConvertir = idee
    navigate('/soignant/activite/nouvelle')
  }

  async function refuser(idee: ActivityProposal): Promise<void> {
    if (enCours !== null) return
    enCours = idee.id
    try {
      const resultat = await staffStore.decideProposal(idee.id, 'declined', { declineReason: motif.trim() })
      if (resultat.ok) {
        refusPour = null
        motif = ''
      }
    } finally {
      enCours = null
    }
  }
</script>

{#if !staffStore.isAdmin}
  <!--
    L'adresse peut se taper. Les règles Firestore refuseraient la lecture de toute façon,
    mais un écran vide sans explication laisserait croire qu'il n'y a rien à lire.
  -->
  <section class="mx-auto max-w-3xl px-4 py-6">
    <h1 class="mb-3 text-3xl font-bold text-ink">Les idées des patients</h1>
    <p class="card p-5 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Les idées proposées par les patients sont lues par l'administrateur : c'est lui qui
      construit le programme, et c'est lui qui répond.
    </p>
    <button type="button" class="btn btn-secondary mt-4" onclick={() => navigate('/soignant')}>
      <span aria-hidden="true">←</span> Retour à la semaine
    </button>
  </section>
{:else}
<section class="mx-auto max-w-3xl px-4 py-6">
  <h1 class="mb-1 text-3xl font-bold text-ink">Les idées des patients</h1>
  <p class="mb-4 text-lg text-ink-soft">{formatLongDayLabel(aujourdHui)}</p>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <p class="mb-5 rounded-xl border-2 border-line bg-surface-soft p-4 text-lg text-ink">
    Une idée n'est pas une réclamation : il n'y a rien à y répondre sinon oui ou non.
    Si vous ne la retenez pas, dites en une phrase pourquoi — la personne la lira telle
    quelle, et un « non » sans raison décourage plus que le refus lui-même.
  </p>

  <h2 class="mb-2 text-2xl font-bold text-ink">
    {enAttente.length === 0
      ? 'Aucune idée en attente'
      : enAttente.length === 1
        ? 'Une idée en attente'
        : `${enAttente.length} idées en attente`}
  </h2>

  {#if enAttente.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      Rien à relever pour le moment. Les patients proposent depuis leur calendrier, en bas
      de l'écran.
    </p>
  {:else}
    <ul class="grid gap-4">
      {#each enAttente as idee (idee.id)}
        <li class="card p-5">
          <p class="text-xl font-bold text-ink">{idee.title}</p>
          <p class="text-base text-ink-soft">
            {#if idee.patientFirstName}Proposée par {idee.patientFirstName} · {/if}{attente(idee)}
            {#if idee.wantsToLead}
              · <span class="font-semibold text-ink">se propose de l'animer</span>
            {/if}
          </p>
          <p class="mt-2 text-lg text-ink">{idee.description}</p>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              disabled={enCours === idee.id}
              onclick={() => retenir(idee)}
            >
              {enCours === idee.id ? 'Un instant…' : 'Retenir cette idée'}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={enCours === idee.id}
              onclick={() => { refusPour = refusPour === idee.id ? null : idee.id; motif = '' }}
            >
              Ne pas retenir
            </button>
          </div>

          {#if refusPour === idee.id}
            <div class="mt-3 rounded-xl border-2 border-line p-3">
              <label for={`motif-${idee.id}`} class="mb-2 block text-lg font-semibold text-ink">
                Pourquoi cette idée n'est-elle pas retenue ?
              </label>
              <textarea
                id={`motif-${idee.id}`}
                bind:value={motif}
                rows="2"
                maxlength="300"
                class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
                placeholder="Il n'y a pas de salle libre à ce moment-là. Reproposez-la à la rentrée."
              ></textarea>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={enCours === idee.id || motif.trim().length < 3}
                  onclick={() => refuser(idee)}
                >
                  Envoyer la réponse
                </button>
                <button type="button" class="btn btn-secondary" onclick={() => (refusPour = null)}>
                  Annuler
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if aCreer.length > 0}
    <!--
      Retenues, mais dont l'activité n'existe pas encore. Sans ce rappel, une idée
      acceptée un jour de réunion chargée disparaîtrait dans la liste des idées passées,
      et la personne attendrait une activité que personne n'a créée.
    -->
    <h2 class="mt-8 mb-2 text-2xl font-bold text-ink">Retenues — l'activité reste à créer</h2>
    <ul class="grid gap-4">
      {#each aCreer as idee (idee.id)}
        <li class="card p-5">
          <p class="text-xl font-bold text-ink">{idee.title}</p>
          <p class="mt-1 text-lg text-ink">{idee.description}</p>
          <button type="button" class="btn btn-primary mt-3" onclick={() => creerLActivite(idee)}>
            Créer l'activité
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if decidees.length > 0}
    <h2 class="mt-8 mb-2 text-2xl font-bold text-ink">Idées déjà traitées</h2>
    <ul class="grid gap-3">
      {#each decidees as idee (idee.id)}
        <li class="card p-4">
          <p class="text-lg font-bold text-ink">
            <span aria-hidden="true">{idee.status === 'accepted' ? '✓' : '✗'}</span>
            {idee.title}
          </p>
          <p class="text-base text-ink">
            {idee.status === 'accepted' ? 'Retenue' : 'Non retenue'}
            {#if idee.declineReason}— {idee.declineReason}{/if}
          </p>
        </li>
      {/each}
    </ul>
  {/if}

  <button type="button" class="btn btn-secondary mt-6" onclick={() => navigate('/soignant')}>
    <span aria-hidden="true">←</span> Retour à la semaine
  </button>
</section>
{/if}
