<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'

  let email = $state('')
  let password = $state('')
  let message = $state<string | null>(null)
  let busy = $state(false)

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    busy = true
    message = null
    const result = await staffStore.signIn(email, password)
    if (!result.ok) message = result.message ?? "L'adresse ou le mot de passe ne correspond pas."
    busy = false
  }
</script>

<section class="mx-auto max-w-xl px-4 py-8">
  <h1 class="mb-2 text-3xl font-bold text-ink">Espace soignant</h1>
  <p class="mb-6 text-lg text-ink-soft">
    Connectez-vous pour créer et modifier les activités.
  </p>

  <form onsubmit={submit} class="card p-5">
    <label for="courriel" class="mb-2 block text-lg font-semibold text-ink">Adresse électronique</label>
    <input
      id="courriel"
      type="email"
      autocomplete="username"
      bind:value={email}
      class="mb-4 w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
      style="min-height: 56px;"
    />

    <label for="motdepasse" class="mb-2 block text-lg font-semibold text-ink">Mot de passe</label>
    <input
      id="motdepasse"
      type="password"
      autocomplete="current-password"
      bind:value={password}
      class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
      style="min-height: 56px;"
    />

    {#if message !== null}
      <p role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
        <span aria-hidden="true">⚠️</span> {message}
      </p>
    {/if}

    <button type="submit" class="btn btn-primary mt-4 w-full" disabled={busy}>
      {busy ? 'Un instant…' : 'Se connecter'}
    </button>
  </form>
</section>
