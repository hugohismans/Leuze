<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { audienceLabelForStaff, isPublished } from '../../lib/domain/audience'
  import { byChronology } from '../../lib/domain/activityOrder'
  import { deletionConsequences, deletionCosts } from '../../lib/domain/catalog'
  import { formatDuration, todayLocalDate } from '../../lib/domain/time'
  import type { Activity } from '../../lib/domain/types'
  import { navigate } from '../../lib/router.svelte'
  import { enClair } from '../../lib/erreurs'

  const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

  /**
   * Dans l'ordre du temps, et non de l'alphabet : on cherche « ce qui vient » bien plus
   * souvent que « ce qui commence par A ». Ce qui est passé suit, du plus récent au plus
   * ancien. Voir `domain/activityOrder.ts`.
   */
  const activites = $derived(byChronology(staffStore.activities, todayLocalDate()))

  /** La suppression se confirme sur place, comme dans le catalogue. */
  let aSupprimer = $state<string | null>(null)
  let busy = $state(false)
  let erreur = $state<string | null>(null)

  /**
   * La suppression se fait en deux temps, et c'est délibéré.
   *
   * Le premier geste efface ce que personne n'a jamais utilisé. Dès qu'une inscription
   * existe, le serveur se contente de retirer l'activité du programme et le dit — c'est
   * seulement là qu'on découvre ce qu'une suppression coûterait vraiment, et qu'on peut
   * décider en connaissance de cause.
   *
   * Le second geste efface tout, sans retour. On ne le propose donc jamais avant d'avoir
   * nommé ce qui va disparaître.
   */
  let aEffacer = $state<{ id: string; titre: string; consequences: string[] } | null>(null)

  async function supprimer(activityId: string, force = false): Promise<void> {
    if (busy) return
    busy = true
    erreur = null
    try {
      const activite = staffStore.activities.find((a) => a.id === activityId)
      const plan = await staffStore.removeActivity(activityId, force ? { force: true } : {})
      aSupprimer = null
      aEffacer =
        plan.action === 'deactivated' && plan.usage !== undefined && deletionCosts(plan.usage)
          ? {
              id: activityId,
              titre: activite?.title ?? 'Cette activité',
              consequences: deletionConsequences(plan.usage),
            }
          : null
    } catch (error) {
      erreur = enClair(error)
    } finally {
      busy = false
    }
  }

  function quand(activity: Activity): string {
    const regle = activity.recurrence
    if (regle === null) {
      return activity.singleStart ? `Le ${activity.singleStart.date} à ${activity.singleStart.time}` : 'Sans date'
    }
    const jours = regle.byWeekday.map((j) => JOURS[j]).join(', ')
    return `Tous les ${jours} à ${regle.startTime.replace(':', 'h')} — ${formatDuration(regle.durationMin)}`
  }

  /*
    Une activité à la fois, et elle seule.

    « Dupliquer » et « Retirer du programme » ne disaient rien pendant qu'ils
    travaillaient : on recliquait, et l'on se retrouvait avec trois copies. Les deux
    boutons de cette ligne se ferment le temps du geste ; les autres lignes restent
    vivantes.
  */
  let enCours = $state<string | null>(null)

  async function agir(activityId: string, geste: () => Promise<unknown>): Promise<void> {
    if (enCours === activityId) return
    enCours = activityId
    try {
      await geste()
    } finally {
      enCours = null
    }
  }
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-3xl font-bold text-ink">Les activités</h1>
    <button type="button" class="btn btn-primary" onclick={() => navigate('/soignant/activite/nouvelle')}>
      <span aria-hidden="true">＋</span> Nouvelle activité
    </button>
  </div>

  {#if erreur !== null}
    <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
      <span aria-hidden="true">⚠️</span> {erreur}
    </p>
  {/if}

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.activities.length === 0}
    <p class="card p-5 text-lg text-ink-soft">Aucune activité pour le moment.</p>
  {:else}
    <ul class="grid gap-4">
      {#each activites as activity (activity.id)}
        <li class="card p-4" class:bg-surface-soft={!activity.isActive}>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-xl font-bold text-ink">{activity.title}</h2>
            {#if !activity.isActive}
              <span class="badge" style="background: var(--color-surface-soft); color: var(--color-ink-soft);">
                <span aria-hidden="true">📝</span> Brouillon — pas au programme
              </span>
            {/if}
          </div>

          <p class="mt-1 text-base text-ink-soft">{quand(activity)}</p>
          <p class="text-base text-ink-soft">
            {store.locationOf(activity.locationId)?.name ?? activity.locationId}
            {#if activity.facilitator}— {activity.facilitator}{/if}
          </p>

          <p class="mt-1 text-base" class:text-ink={isPublished(activity)}>
            {#if !isPublished(activity)}
              <span aria-hidden="true">⚠️</span>
            {/if}
            {audienceLabelForStaff(activity, staffStore.catalog.services)}
          </p>

          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary" onclick={() => navigate(`/soignant/activite/${activity.id}`)}>
              Modifier
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={enCours === activity.id}
              onclick={() => agir(activity.id, () => staffStore.duplicate(activity.id))}
            >
              Dupliquer
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={enCours === activity.id}
              onclick={() => agir(activity.id, () => staffStore.setActive(activity.id, !activity.isActive))}
            >
              {activity.isActive ? 'Retirer du programme' : 'Mettre au programme'}
            </button>
            <button type="button" class="btn btn-secondary" onclick={() => (aSupprimer = activity.id)}>
              Supprimer
            </button>
          </div>

          {#if aEffacer !== null && aEffacer.id === activity.id}
            <!--
              Le second temps : on sait maintenant ce que l'on efface, et on le dit avant
              de le proposer. Le bouton est explicite — « tout effacer », pas « continuer ».
            -->
            <div role="alert" class="mt-3 rounded-xl border-4 border-red-600 bg-red-50 p-4">
              <h3 class="text-xl font-bold text-red-900">
                <span aria-hidden="true">⚠️</span>
                Effacer « {aEffacer.titre} » pour de bon ?
              </h3>
              <p class="mt-2 text-lg font-semibold text-ink">
                Cette suppression est définitive. Voici ce qui disparaît :
              </p>
              <!--
                Une liste, et non un paragraphe : chaque conséquence se lit d'un coup
                d'œil, et l'on voit du même regard combien il y en a.
              -->
              <ul class="mt-2 list-disc pl-6 text-lg text-ink">
                {#each aEffacer.consequences as ligne (ligne)}
                  <li class="mt-1">{ligne}</li>
                {/each}
              </ul>
              <p class="mt-3 text-lg text-ink">
                Pour prévenir plutôt qu'effacer, laissez-la retirée du programme, ou
                annulez ses séances avec un motif : elles restent alors visibles, barrées,
                avec la raison.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy}
                  onclick={() => supprimer(activity.id, true)}
                >
                  {busy ? 'Un instant…' : 'Oui, tout effacer'}
                </button>
                <button type="button" class="btn btn-secondary" onclick={() => (aEffacer = null)}>
                  Non, la laisser retirée du programme
                </button>
              </div>
            </div>
          {/if}

          {#if aSupprimer === activity.id}
            <div class="mt-3 rounded-xl border-2 border-line p-4">
              <p class="text-lg text-ink">
                Supprimer « {activity.title} » et toutes ses séances ? Si quelqu'un s'y est
                déjà inscrit, elle sera d'abord seulement retirée du programme — on vous
                dira alors ce qu'effacer pour de bon ferait disparaître.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary" disabled={busy} onclick={() => supprimer(activity.id)}>
                  {busy ? 'Un instant…' : 'Oui, supprimer'}
                </button>
                <button type="button" class="btn btn-secondary" onclick={() => (aSupprimer = null)}>
                  Annuler
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
