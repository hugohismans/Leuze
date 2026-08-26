<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { enClair } from '../../lib/erreurs'
  import { RECHARGER } from '../../lib/domain/errors'

  let email = $state('')
  let password = $state('')
  let message = $state<string | null>(null)
  let busy = $state(false)
  /*
    La demande de nouveau mot de passe.

    Elle n'existait pas : un soignant qui oubliait le sien était bloqué dehors, et il
    fallait ouvrir la console Firebase pour lui. Pour cinquante personnes, cela ne tient
    pas — et c'est le matin, avant la réunion, qu'on s'en aperçoit.

    Le lien reste discret sous le bouton : c'est un geste rare, il n'a rien à faire sur le
    chemin de tous les jours.
  */
  let oubli = $state(false)
  let envoi = $state(false)
  let reponse = $state<string | null>(null)

  async function reinitialiser(): Promise<void> {
    if (envoi) return
    envoi = true
    reponse = null
    try {
      reponse = (await staffStore.sendPasswordReset(email)).message
    } catch (error) {
      reponse = enClair(error)
    } finally {
      envoi = false
    }
  }

  /*
    Le bouton redevient utilisable quoi qu'il arrive.

    `busy = false` était après l'attente, hors de tout `finally` : si la connexion partait
    en erreur au lieu de rendre un refus — réseau coupé en pleine bascule wifi/5G, jeton
    illisible, application qui n'a pas fini de démarrer — la promesse était rejetée, la
    ligne suivante n'était jamais atteinte, et le bouton restait sur « Un instant… » pour
    toujours. Aucun message, aucune sortie : constaté en service, sur un téléphone.

    Le rejet dit maintenant quelque chose de lisible, et le bouton revient.
  */
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    busy = true
    message = null
    try {
      const result = await staffStore.signIn(email, password)
      if (!result.ok) message = result.message ?? "L'adresse ou le mot de passe ne correspond pas."
    } catch (error) {
      message = enClair(error)
    } finally {
      busy = false
    }
  }
</script>

<section class="mx-auto max-w-xl px-4 py-8">
  <h1 class="mb-2 text-3xl font-bold text-ink">Espace soignant</h1>
  <p class="mb-6 text-lg text-ink-soft">
    Connectez-vous pour créer et modifier les activités.
  </p>

  <!--
    En démonstration, il n'y a pas de compte : n'importe quel mot de passe ouvre l'accès.

    L'écran du code patient le disait déjà ; celui-ci, non. Quelqu'un qui essaie son vrai
    mot de passe ici le voit fonctionner et croit être entré dans le vrai espace — ou,
    dans l'autre sens, croit que son compte marche alors qu'il n'a pas été vérifié. Il n'y
    a rien à protéger derrière — la version de démonstration ne contient pas une ligne du
    SDK Firebase, donc aucun accès à la base — mais il y a tout à dire.
  -->
  {#if staffStore.isDemo}
    <p class="mb-6 rounded-xl border-2 border-line p-3 text-base text-ink">
      <span aria-hidden="true">🧪</span>
      Ceci est une démonstration : n'importe quelle adresse et n'importe quel mot de passe
      ouvrent l'accès, et les données sont inventées. Rien de ce que vous ferez ici ne
      touche le vrai programme.
    </p>
  {/if}

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

      <!--
        Le seul geste qui s'en sort, offert d'un doigt.

        Quand un morceau de l'application n'a pas pu se charger, le navigateur retient
        l'échec : réessayer ne repart pas sur le réseau. Il faut recharger la page — et
        savoir le faire sur un téléphone ne va pas de soi. Le bouton évite d'avoir à
        l'expliquer.
      -->
      {#if message === RECHARGER}
        <button type="button" class="btn btn-secondary mt-3 w-full" onclick={() => location.reload()}>
          <span aria-hidden="true">🔄</span> Recharger la page
        </button>
      {/if}
    {/if}

    <button type="submit" class="btn btn-primary mt-4 w-full" disabled={busy}>
      {busy ? 'Un instant…' : 'Se connecter'}
    </button>

    <!--
      Mot de passe oublié.

      Discret, sous le bouton : c'est un geste rare. Mais il doit exister — sans lui, la
      seule sortie était d'ouvrir la console Firebase, ce qu'une seule personne sait faire.
    -->
    {#if !oubli}
      <button type="button" class="btn btn-quiet mt-3 w-full" onclick={() => (oubli = true)}>
        Mot de passe oublié ?
      </button>
    {:else}
      <div class="mt-4 rounded-xl border-2 border-line p-4">
        <p class="text-lg text-ink">
          Entrez votre adresse électronique ci-dessus, puis demandez un nouveau mot de
          passe. Vous recevrez un courriel avec un lien.
        </p>
        {#if reponse !== null}
          <p role="status" class="mt-3 rounded-xl bg-surface-soft p-3 text-lg text-ink">
            {reponse}
          </p>
        {/if}
        <div class="mt-3 grid gap-2">
          <button
            type="button"
            class="btn btn-secondary"
            disabled={envoi || email.trim() === ''}
            onclick={reinitialiser}
          >
            {envoi ? 'Un instant…' : 'Envoyer le courriel'}
          </button>
          <button type="button" class="btn btn-quiet" onclick={() => { oubli = false; reponse = null }}>
            Revenir à la connexion
          </button>
        </div>
      </div>
    {/if}
  </form>
</section>
