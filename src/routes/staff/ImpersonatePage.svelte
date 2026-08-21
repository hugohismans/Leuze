<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { impersonation } from '../../lib/impersonation.svelte'
  import {
    canImpersonate,
    impersonationRefusal,
    matchAccounts,
    sortAccounts,
    type Account,
  } from '../../lib/domain/impersonation'
  import { navigate } from '../../lib/router.svelte'

  /**
   * « Voir à leur place » — un écran de mise au point, et rien d'autre.
   *
   * Préparer l'application demande de créer des dizaines de comptes, puis de vérifier ce
   * que chacun voit : un patient du Mazurel n'a pas le même calendrier qu'un patient de
   * la Ferme, et l'appel n'est ouvert qu'à la personne qui anime l'activité. Retenir
   * autant de mots de passe est intenable ; se mettre à leur place en un clic l'est
   * beaucoup moins.
   *
   * L'écran est réservé à l'administrateur, et le serveur le revérifie : rien ici
   * n'accorde de droit. Chaque passage est écrit au journal des fonctions.
   */
  let comptes = $state<Account[]>([])
  let recherche = $state('')
  let chargement = $state(true)
  let erreur = $state<string | null>(null)
  let busy = $state<string | null>(null)

  $effect(() => {
    if (!staffStore.isAdmin) return
    chargement = true
    void staffStore
      .listAccounts()
      .then((valeur) => (comptes = valeur))
      .catch((error: unknown) => {
        erreur = error instanceof Error ? error.message.replace(/^.*?:\s*/, '') : 'La liste n’a pas pu être lue.'
      })
      .finally(() => (chargement = false))
  })

  const acteur = $derived({ uid: staffStore.identity.uid, role: staffStore.identity.role })
  const visibles = $derived(sortAccounts(matchAccounts(comptes, recherche)))
  const personnel = $derived(visibles.filter((c) => c.kind === 'staff'))
  const patients = $derived(visibles.filter((c) => c.kind === 'patient'))

  async function prendreLaPlace(compte: Account): Promise<void> {
    if (busy !== null) return
    const refus = impersonationRefusal(acteur, compte)
    if (refus !== null) {
      erreur = refus
      return
    }
    busy = compte.uid
    erreur = null
    const resultat = await staffStore.impersonate(compte.uid)
    if (!resultat.ok) {
      erreur = resultat.message
      busy = null
      return
    }
    impersonation.start({ label: resultat.label, kind: resultat.kind, back: resultat.back })
    // Un patient n'a rien à faire dans l'espace soignant : on l'emmène sur son
    // calendrier. Un membre du personnel arrive sur sa semaine.
    navigate(resultat.kind === 'patient' ? '/' : '/soignant')
    window.location.reload()
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Voir à leur place</h1>
  <p class="mb-4 text-lg text-ink-soft">
    Pour vérifier ce que chaque personne voit réellement, sans avoir à retenir son mot de
    passe. Vous prenez sa place, vous regardez, puis vous revenez à votre compte par le
    bandeau jaune en haut de l'écran.
  </p>

  {#if !staffStore.isAdmin}
    <p role="status" class="rounded-xl bg-surface-soft p-4 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Seul un administrateur peut voir l'application à la place de quelqu'un.
    </p>
  {:else}
    <p class="mb-5 rounded-xl bg-surface-soft p-4 text-base text-ink">
      <span aria-hidden="true">⚠️</span>
      C'est un outil de mise au point. Vous ouvrez une vraie session, avec exactement les
      droits de cette personne — vos propres droits sont mis de côté le temps du détour, et
      chaque passage est inscrit au journal.
    </p>

    {#if erreur !== null}
      <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
        <span aria-hidden="true">⚠️</span> {erreur}
      </p>
    {/if}

    <label for="recherche" class="mb-2 block text-lg font-semibold text-ink">
      Chercher une personne
    </label>
    <input
      id="recherche"
      bind:value={recherche}
      class={champ}
      style="min-height: 56px;"
      placeholder="Un prénom, un poste, un service"
    />

    {#if chargement}
      <p class="mt-5 text-lg text-ink-soft">Un instant…</p>
    {:else if comptes.length === 0}
      <p class="mt-5 card p-5 text-lg text-ink-soft">
        Aucun compte pour l'instant. Créez du personnel dans « Le personnel », et des
        patients dans « Les patients ».
      </p>
    {/if}

    {#snippet carte(compte: Account)}
      {@const possible = canImpersonate(acteur, compte)}
      <li class="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 class="text-xl font-bold text-ink">{compte.label}</h3>
          <p class="text-base text-ink-soft">{compte.detail}</p>
        </div>
        {#if possible}
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy !== null}
            onclick={() => prendreLaPlace(compte)}
          >
            {busy === compte.uid ? 'Un instant…' : 'Voir à sa place'}
          </button>
        {:else}
          <p class="text-base font-semibold text-ink-soft">C'est vous</p>
        {/if}
      </li>
    {/snippet}

    {#if personnel.length > 0}
      <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Le personnel</h2>
      <ul class="grid gap-3">
        {#each personnel as compte (compte.uid)}{@render carte(compte)}{/each}
      </ul>
    {/if}

    {#if patients.length > 0}
      <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Les patients</h2>
      <ul class="grid gap-3">
        {#each patients as compte (compte.uid)}{@render carte(compte)}{/each}
      </ul>
    {/if}

    {#if !chargement && comptes.length > 0 && visibles.length === 0}
      <p class="mt-5 card p-5 text-lg text-ink-soft">
        Personne ne correspond à « {recherche} ».
      </p>
    {/if}

    <button type="button" class="btn btn-secondary mt-8" onclick={() => navigate('/soignant')}>
      <span aria-hidden="true">←</span> Retour à la semaine
    </button>
  {/if}
</section>
