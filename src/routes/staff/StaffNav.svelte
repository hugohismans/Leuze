<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { navigate, router } from '../../lib/router.svelte'

  /**
   * La navigation de l'espace soignant : un bouton, un tiroir.
   *
   * Elle était une rangée de dix onglets posée sous l'en-tête. Sur un téléphone, elle
   * occupait quatre rangées et repoussait le contenu hors de l'écran ; il avait fallu
   * replier la moitié des entrées derrière « Autres écrans », ce qui laissait deux façons
   * de naviguer selon la largeur de l'écran. Une seule vaut mieux.
   *
   * La barre ne porte donc plus que deux choses : de quoi ouvrir le tiroir, et le nom de
   * l'écran où l'on se trouve — sans quoi on ne saurait plus où l'on est, ce que la
   * rangée d'onglets disait en permanence. Le reste — les écrans, le compte, la
   * déconnexion — vit dans le tiroir.
   *
   * Le tiroir est une vraie boîte de dialogue : « Échap » le ferme, le fond cliquable
   * aussi, et le focus revient sur le bouton qui l'a ouvert. On n'y est jamais enfermé.
   */
  // « Mon planning » n'apparaît que pour un compte relié à un intervenant : ailleurs,
  // l'entrée ne mènerait nulle part.
  const monPlanning = $derived(staffStore.identity.practitionerId)

  const quotidiens = $derived([
    { chemin: '/soignant', libelle: 'La semaine' },
    { chemin: '/soignant/reunion', libelle: 'Réunion du lundi' },
    { chemin: '/soignant/aujourdhui', libelle: "Aujourd'hui" },
    // Les plannings des patients ne regardent que l'administrateur : l'entrée n'apparaît
    // pas ailleurs, et l'écran refuse de lui-même si l'on y arrive par l'adresse.
    ...(staffStore.isAdmin ? [{ chemin: '/soignant/plannings', libelle: 'Les plannings' }] : []),
    ...(monPlanning === null ? [] : [{ chemin: `/soignant/intervenant/${monPlanning}`, libelle: 'Mon planning' }]),
    { chemin: '/soignant/rendez-vous', libelle: 'Rendez-vous' },
  ])

  // « Voir à leur place » est un outil de mise au point, réservé à l'administrateur :
  // l'entrée ne s'affiche pas pour les autres, et le serveur revérifie de toute façon.
  const occasionnels = $derived([
    { chemin: '/soignant/patients', libelle: 'Les patients' },
    { chemin: '/soignant/personnel', libelle: 'Le personnel' },
    { chemin: '/soignant/activites', libelle: 'Les activités' },
    { chemin: '/soignant/catalogue', libelle: 'Le catalogue' },
    ...(staffStore.isAdmin ? [{ chemin: '/soignant/a-leur-place', libelle: 'Voir à leur place' }] : []),
  ])

  const actif = (chemin: string): boolean => router.path === chemin

  /** Le nom de l'écran affiché, y compris pour ceux qui n'ont pas d'entrée au menu. */
  const ecranCourant = $derived(
    [...quotidiens, ...occasionnels].find((item) => actif(item.chemin))?.libelle ??
      (router.path.startsWith('/soignant/activite/')
        ? 'Une activité'
        : router.path.startsWith('/soignant/appel/')
          ? "L'appel"
          : router.path.startsWith('/soignant/planning/')
            ? 'Le planning d’un patient'
            : router.path.startsWith('/soignant/intervenant/')
              ? 'Le planning d’un intervenant'
              : router.path === '/soignant/impression'
                ? 'Imprimer le programme'
                : 'Espace soignant'),
  )

  let ouvert = $state(false)
  let bouton = $state<HTMLButtonElement | null>(null)
  let tiroir = $state<HTMLElement | null>(null)

  function fermer(rendreLeFocus = true): void {
    if (!ouvert) return
    ouvert = false
    // Le focus revient d'où il vient : on se sait de nouveau dans la barre, pas nulle part.
    if (rendreLeFocus) bouton?.focus()
  }

  function allerA(chemin: string): void {
    navigate(chemin)
    fermer()
  }

  // Ouvert, le tiroir prend le focus et retient la page derrière lui. « Échap » en sort.
  $effect(() => {
    if (!ouvert) return
    tiroir?.querySelector<HTMLElement>('button')?.focus()

    const precedent = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const auClavier = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      fermer()
    }
    window.addEventListener('keydown', auClavier)
    return () => {
      window.removeEventListener('keydown', auClavier)
      document.body.style.overflow = precedent
    }
  })
</script>

{#snippet entree(chemin: string, libelle: string)}
  <li>
    <button
      type="button"
      class="lien"
      class:courant={actif(chemin)}
      aria-current={actif(chemin) ? 'page' : undefined}
      onclick={() => allerA(chemin)}
    >
      {libelle}
    </button>
  </li>
{/snippet}

<div class="barre no-print">
  <div class="dedans">
    <button
      type="button"
      class="btn btn-secondary bouton-menu"
      bind:this={bouton}
      aria-expanded={ouvert}
      aria-controls="tiroir-soignant"
      onclick={() => (ouvert = true)}
    >
      <span class="barres" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      Menu
    </button>
    <p class="ecran">{ecranCourant}</p>
  </div>
</div>

{#if ouvert}
  <!--
    Le fond n'est pas qu'un décor : c'est la façon la plus naturelle de refermer un
    tiroir. Il porte donc un vrai bouton, et non une division cliquable.
  -->
  <button type="button" class="voile no-print" aria-label="Fermer le menu" onclick={() => fermer()}
  ></button>

  <nav id="tiroir-soignant" class="tiroir no-print" bind:this={tiroir} aria-label="Espace soignant">
    <div class="tete">
      <button type="button" class="btn btn-secondary" onclick={() => fermer()}>
        <span aria-hidden="true">✕</span> Fermer
      </button>
      <p class="qui">{staffStore.identity.firstName ?? staffStore.identity.email}</p>
    </div>

    <p class="groupe">Tous les jours</p>
    <ul>
      {#each quotidiens as item (item.chemin)}{@render entree(item.chemin, item.libelle)}{/each}
    </ul>

    <p class="groupe">De temps en temps</p>
    <ul>
      {#each occasionnels as item (item.chemin)}{@render entree(item.chemin, item.libelle)}{/each}
    </ul>

    <div class="pied">
      <button
        type="button"
        class="btn btn-secondary"
        onclick={() => {
          // Pas de retour du focus : le bouton du menu disparaît avec la session.
          fermer(false)
          void staffStore.signOut()
        }}
      >
        Se déconnecter
      </button>
    </div>
  </nav>
{/if}

<style>
  .barre {
    border-bottom: 1px solid var(--color-line);
    background: var(--color-surface-soft);
  }
  .dedans {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 1600px;
    margin: 0 auto;
    padding: 0.75rem 1rem;
  }
  .ecran {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-ink);
    /* Un nom d'écran long ne doit pas repousser le bouton hors de l'écran. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bouton-menu {
    flex-shrink: 0;
    gap: 0.6rem;
  }
  /* Trois traits, dessinés plutôt qu'écrits : le caractère « ☰ » ne se rend pas partout. */
  .barres {
    display: inline-flex;
    flex-direction: column;
    justify-content: space-between;
    width: 1.25rem;
    height: 0.95rem;
  }
  .barres span {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: currentColor;
  }

  .voile {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: 0;
    padding: 0;
    background: rgb(0 0 0 / 45%);
    cursor: pointer;
  }

  .tiroir {
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    width: min(21rem, 86vw);
    overflow-y: auto;
    padding: 1rem;
    background: var(--color-surface);
    border-inline-end: 2px solid var(--color-line);
    box-shadow: 0 0 2rem rgb(0 0 0 / 25%);
    animation: entrer 180ms ease-out;
  }

  @keyframes entrer {
    from {
      transform: translateX(-100%);
    }
  }

  /* Une animation qui gêne ne doit jamais s'imposer. */
  @media (prefers-reduced-motion: reduce) {
    .tiroir {
      animation: none;
    }
  }

  .tete {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .qui {
    font-size: 1.125rem;
    color: var(--color-ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .groupe {
    margin: 1rem 0 0.25rem;
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-ink-soft);
  }

  .tiroir ul {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .lien {
    /* La cible tactile fait 56 px de haut, comme partout ailleurs. */
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 56px;
    padding: 0 0.9rem;
    border: 2px solid transparent;
    border-radius: 0.75rem;
    background: transparent;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-ink);
    text-align: start;
    cursor: pointer;
  }
  .lien:hover {
    background: var(--color-surface-soft);
  }
  /* L'écran courant est doublé d'un trait épais à gauche : jamais la couleur seule. */
  .lien.courant {
    background: var(--color-brand-900);
    color: #ffffff;
    border-inline-start: 6px solid var(--color-brand-500);
  }

  .pied {
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--color-line);
  }
</style>
