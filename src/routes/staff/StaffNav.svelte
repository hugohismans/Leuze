<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { pendingForViewer } from '../../lib/domain/appointmentAccess'
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
   *
   * Sur un grand écran, il ne se cache plus : il devient une colonne fixe à gauche, et
   * la barre disparaît. Quelqu'un qui passe la journée là-dedans ne doit pas cliquer pour
   * atteindre son menu ; sur un téléphone ou une tablette, la place manque et le tiroir
   * reprend ses droits. Le seuil est déclaré ici **et** dans `App.svelte`, qui décale
   * l'application d'autant : les deux doivent rester d'accord.
   */
  const GRAND_ECRAN = '(min-width: 1280px)'
  // « Mon planning » n'apparaît que pour un compte relié à un intervenant : ailleurs,
  // l'entrée ne mènerait nulle part.
  const monPlanning = $derived(staffStore.identity.practitionerId)

  /**
   * La seule notification de l'application : un nombre, à côté de « Rendez-vous ».
   *
   * Rien n'est envoyé, rien ne sonne. Une demande oubliée est pourtant le vrai risque de
   * cet écran — on n'y va que lorsqu'on y pense. Un compteur suffit à y penser, et il
   * disparaît de lui-même dès qu'il n'y a plus rien à traiter.
   */
  const enAttente = $derived(
    pendingForViewer(
      { role: staffStore.identity.role, practitionerId: staffStore.identity.practitionerId },
      staffStore.appointments,
      store.practitioners,
    ),
  )

  const quotidiens = $derived([
    { chemin: '/soignant', libelle: 'La semaine' },
    { chemin: '/soignant/reunion', libelle: 'Réunion du lundi' },
    { chemin: '/soignant/aujourdhui', libelle: "Aujourd'hui" },
    // Les plannings des patients ne regardent que l'administrateur : l'entrée n'apparaît
    // pas ailleurs, et l'écran refuse de lui-même si l'on y arrive par l'adresse.
    ...(staffStore.isAdmin ? [{ chemin: '/soignant/plannings', libelle: 'Les plannings' }] : []),
    ...(monPlanning === null ? [] : [{ chemin: `/soignant/intervenant/${monPlanning}`, libelle: 'Mon planning' }]),
    { chemin: '/soignant/rendez-vous', libelle: 'Rendez-vous', enAttente },
    // Les idées des patients : c'est l'administrateur qui construit le programme, donc
    // c'est lui qui répond. Le nombre en attente se voit — une idée oubliée décourage
    // plus sûrement qu'un refus.
    ...(staffStore.isAdmin
      ? [{ chemin: '/soignant/idees', libelle: 'Les idées', enAttente: staffStore.proposalsWaiting }]
      : []),
  ])

  // « Voir à leur place » est un outil de mise au point, réservé à l'administrateur :
  // l'entrée ne s'affiche pas pour les autres, et le serveur revérifie de toute façon.
  const occasionnels = $derived([
    { chemin: '/soignant/patients', libelle: 'Les patients' },
    { chemin: '/soignant/personnel', libelle: 'Le personnel' },
    { chemin: '/soignant/activites', libelle: 'Les activités' },
    { chemin: '/soignant/catalogue', libelle: 'Le catalogue' },
    ...(staffStore.isAdmin ? [{ chemin: '/soignant/a-leur-place', libelle: 'Voir à leur place' }] : []),
    // Ce que les patients ont le droit de faire : une décision de service, donc
    // l'administrateur. Rangé dans les écrans occasionnels — on n'y va pas tous les jours.
    ...(staffStore.isAdmin ? [{ chemin: '/soignant/reglages', libelle: 'Réglages' }] : []),
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
  let grand = $state(typeof window === 'undefined' ? false : window.matchMedia(GRAND_ECRAN).matches)

  $effect(() => {
    const media = window.matchMedia(GRAND_ECRAN)
    const suivre = (event: MediaQueryListEvent): void => {
      grand = event.matches
      // Redevenu large, un tiroir resté « ouvert » verrouillerait le défilement pour rien.
      if (event.matches) ouvert = false
    }
    media.addEventListener('change', suivre)
    return () => media.removeEventListener('change', suivre)
  })

  function fermer(rendreLeFocus = true): void {
    if (!ouvert) return
    ouvert = false
    // Le focus revient d'où il vient : on se sait de nouveau dans la barre, pas nulle part.
    if (rendreLeFocus) bouton?.focus()
  }

  function allerA(chemin: string): void {
    navigate(chemin)
    // Dépliée à demeure, la colonne n'a rien à refermer.
    if (!grand) fermer()
  }

  // Ouvert, le tiroir prend le focus et retient la page derrière lui. « Échap » en sort.
  // Rien de tout cela quand il est déplié à demeure : ce n'est plus une boîte de dialogue.
  $effect(() => {
    if (!ouvert || grand) return
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

{#snippet entree(chemin: string, libelle: string, attente = 0)}
  <li>
    <button
      type="button"
      class="lien"
      class:courant={actif(chemin)}
      aria-current={actif(chemin) ? 'page' : undefined}
      onclick={() => allerA(chemin)}
    >
      <span class="intitule">{libelle}</span>
      {#if attente > 0}
        <!-- Le nombre est doublé d'un texte lu à voix haute : jamais une pastille muette. -->
        <span class="compteur">
          {attente}
          <span class="sr-only">
            {attente === 1 ? 'demande en attente' : 'demandes en attente'}
          </span>
        </span>
      {/if}
    </button>
  </li>
{/snippet}

{#if !grand}
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
      {#if enAttente > 0}
        <span class="compteur">
          {enAttente}
          <span class="sr-only">
            {enAttente === 1 ? 'demande de rendez-vous en attente' : 'demandes de rendez-vous en attente'}
          </span>
        </span>
      {/if}
    </button>
    <p class="ecran">{ecranCourant}</p>
  </div>
</div>
{/if}

{#if ouvert && !grand}
  <!--
    Le fond n'est pas qu'un décor : c'est la façon la plus naturelle de refermer un
    tiroir. Il porte donc un vrai bouton, et non une division cliquable.
  -->
  <button type="button" class="voile no-print" aria-label="Fermer le menu" onclick={() => fermer()}
  ></button>
{/if}

{#if ouvert || grand}
  <nav id="tiroir-soignant" class="tiroir no-print" bind:this={tiroir} aria-label="Espace soignant">
    <div class="tete">
      {#if !grand}
        <button type="button" class="btn btn-secondary" onclick={() => fermer()}>
          <span aria-hidden="true">✕</span> Fermer
        </button>
      {/if}
      <p class="qui">{staffStore.identity.firstName ?? staffStore.identity.email}</p>
    </div>

    <p class="groupe">Tous les jours</p>
    <ul>
      {#each quotidiens as item (item.chemin)}{@render entree(item.chemin, item.libelle, 'enAttente' in item ? item.enAttente : 0)}{/each}
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

  /*
    Dépliée à demeure : plus une boîte posée par-dessus, mais une colonne du décor. Elle
    perd donc son ombre et son entrée en scène, et rend sa place au contenu — c'est
    `App.svelte` qui décale l'application de la même largeur.
  */
  @media screen and (min-width: 1280px) {
    .tiroir {
      /*
        Plus étroite que le tiroir : chaque point pris ici est un point de moins pour la
        semaine, qui a sept colonnes à loger. 18 rem suffisent à « Réunion du lundi ».
      */
      width: 18rem;
      box-shadow: none;
      animation: none;
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
    gap: 0.5rem;
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

  .intitule {
    flex: 1;
    min-width: 0;
  }

  /* Un nombre, rond, lisible de loin — et jamais seul : un texte le double pour les
     lecteurs d'écran, et il disparaît dès qu'il n'y a plus rien à traiter. */
  .compteur {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--color-brand-900);
    color: #ffffff;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .lien.courant .compteur {
    background: #ffffff;
    color: var(--color-brand-900);
  }

  .pied {
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--color-line);
  }
</style>
