<script lang="ts">
  import { store } from '../lib/appState.svelte'

  /*
    Réveiller la fonction pendant qu'on saisit le code.

    C'est là que l'attente coûtait le plus cher : une fonction endormie met plusieurs
    secondes à repartir, et ce retard tombait entre l'appui sur « Entrer » et l'arrivée
    du calendrier. Saisir six caractères prend plus de temps que ce réveil, qui ne lit
    rien et n'essaie aucun code.
  */
  $effect(() => {
    void store.warmSignIn()
  })

  let code = $state('')
  let message = $state<string | null>(null)
  let busy = $state(false)

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    busy = true
    message = null
    const result = await store.signInWithCode(code)
    if (!result.ok) message = result.message ?? "Ce code n'est pas reconnu. Demandez un nouveau code à un soignant."
    busy = false
  }
</script>

<section class="mx-auto max-w-xl px-4 py-8">
  <h1 class="mb-3 text-3xl font-bold text-ink">Bonjour</h1>
  <p class="mb-6 text-lg text-ink">
    Saisissez le code qui figure sur la feuille remise par un soignant. Vous verrez alors
    les activités proposées et vous pourrez vous y inscrire.
  </p>

  <form onsubmit={submit} class="card p-5">
    <label for="code" class="mb-2 block text-lg font-semibold text-ink">Votre code</label>
    <input
      id="code"
      name="code"
      bind:value={code}
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      inputmode="text"
      aria-describedby={message === null ? 'code-aide' : 'code-erreur'}
      class="w-full rounded-xl border-2 border-line bg-white p-3 text-center text-3xl tracking-[0.3em] text-ink uppercase"
      style="min-height: 64px;"
      placeholder="4KT9RM"
    />
    <p id="code-aide" class="mt-2 text-base text-ink-soft">
      Six caractères. Les majuscules et les minuscules donnent le même résultat.
    </p>

    {#if message !== null}
      <p id="code-erreur" role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
        <span aria-hidden="true">⚠️</span> {message}
      </p>
    {/if}

    <button type="submit" class="btn btn-primary mt-4 w-full" disabled={busy || code.trim().length === 0}>
      {busy ? 'Un instant…' : 'Voir les activités'}
    </button>
  </form>

  <p class="mt-6 text-base text-ink-soft">
    Vous n'avez pas de code ? Demandez-le à un soignant de votre service.
  </p>

  <!--
    En démonstration, on doit pouvoir revenir.

    « Fermer mon accès » amène ici, et il n'y a pas de soignant pour délivrer un code :
    la personne qui montrait l'application se retrouvait devant un champ qu'elle ne
    pouvait pas remplir. Cette phrase-là ne s'affiche que sur la démonstration.
  -->
  {#if store.isDemo}
    <p class="mt-3 rounded-xl border-2 border-line p-3 text-base text-ink">
      <span aria-hidden="true">🧪</span>
      Ceci est une démonstration : n'importe quel code d'au moins quatre caractères ouvre
      l'accès. Essayez « DEMO ».
    </p>
  {/if}
</section>
