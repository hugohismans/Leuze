<script lang="ts">
  import { progressLabel, tutorialSteps } from '../domain/tutoriel'

  /**
   * Le petit tour de l'application, en six écrans.
   *
   * **Pourquoi des dessins de boutons, et non des cercles posés sur l'écran réel.**
   * L'idée d'entourer les vrais boutons est la bonne, et c'est bien ce qu'on fait — mais
   * sur une reproduction, à l'intérieur de la carte. Un halo posé par-dessus la page
   * demanderait que la personne soit sur le bon écran, au bon endroit de défilement, avec
   * le bouton effectivement présent — « Mes inscriptions » n'existe pas tant qu'aucune
   * session n'est ouverte. Chaque condition non tenue donne un halo qui pointe le vide,
   * pour des personnes que le moindre écran cassé décourage. La reproduction, elle, est
   * toujours juste, à toutes les tailles d'écran, et se lit même quand l'administrateur
   * regarde ce petit tour depuis son propre espace.
   *
   * **Les dessins sont invisibles aux lecteurs d'écran.** Le texte nomme déjà chaque
   * bouton mot pour mot ; de faux boutons dans l'arbre d'accessibilité ajouteraient du
   * bruit et des cibles qui ne mènent nulle part.
   *
   * **« Retour » ne bouge jamais.** À la première étape il est désactivé, pas retiré :
   * un bouton qui change de place d'un écran à l'autre est un motif de refus en revue,
   * et c'est exactement ce qu'il ne faut pas faire à quelqu'un qui apprend.
   */
  let {
    serviceName,
    onclose,
  }: {
    /** Le nom de l'unité, écrit dans la phrase d'accueil. `null` tant qu'on ne le sait pas. */
    serviceName: string | null
    /** Appelé quand la personne a fini, ou a choisi d'arrêter. */
    onclose: () => void
  } = $props()

  const etapes = $derived(tutorialSteps(serviceName))
  let index = $state(0)
  const etape = $derived(etapes[Math.min(index, etapes.length - 1)]!)
  const derniere = $derived(index >= etapes.length - 1)

  /*
    Le focus revient d'où il venait.

    « avantOuverture » est volontairement un `let` ordinaire, non réactif : le lire et
    l'écrire dans un effet en ferait une dépendance de cet effet, qui se relancerait
    aussitôt. C'est le piège que ce projet a déjà payé trois fois.
  */
  let avantOuverture: HTMLElement | null = null
  let boite = $state<HTMLElement | null>(null)

  $effect(() => {
    avantOuverture = document.activeElement instanceof HTMLElement ? document.activeElement : null
    boite?.focus()
    /*
      Le fond ne défile pas pendant le petit tour.

      Sans cela, un doigt posé à côté de la carte fait glisser le calendrier derrière :
      on referme, et l'on ne reconnaît plus l'écran qu'on vient d'apprendre.
    */
    const avant = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = avant
      avantOuverture?.focus()
    }
  })

  function precedent(): void {
    if (index > 0) index -= 1
  }

  function suivant(): void {
    if (derniere) onclose()
    else index += 1
  }

  /**
   * Le clavier : « Échap » ferme, la tabulation tourne en rond dans la carte.
   *
   * Tourner en rond n'est pas un piège au clavier — « Échap » sort, et le bouton
   * « Arrêter ce petit tour » aussi. C'est ce qu'on attend d'une fenêtre de ce genre :
   * sans cela, la tabulation s'en va dans le calendrier resté derrière, que l'on ne voit
   * plus.
   */
  function auClavier(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
      return
    }
    if (event.key !== 'Tab' || boite === null) return
    const cibles = [...boite.querySelectorAll<HTMLElement>('button:not(:disabled)')]
    if (cibles.length === 0) return
    const premier = cibles[0]!
    const dernier = cibles[cibles.length - 1]!
    if (event.shiftKey && document.activeElement === premier) {
      event.preventDefault()
      dernier.focus()
    } else if (!event.shiftKey && document.activeElement === dernier) {
      event.preventDefault()
      premier.focus()
    }
  }
</script>

<!--
  Le fond sombre arrête les appuis à côté de la carte.

  Il ne referme pas le petit tour : un doigt posé de travers ne doit pas faire disparaître
  ce qu'on est en train de lire. On sort par un bouton, ou par « Échap ».
-->
<div class="voile" role="presentation">
  <div
    class="boite card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="tuto-titre"
    tabindex="-1"
    bind:this={boite}
    onkeydown={auClavier}
  >
    <div class="contenu" aria-live="polite">
      <p class="image" aria-hidden="true">{etape.emoji}</p>
      <h2 id="tuto-titre" class="titre">{etape.title}</h2>

      <!--
        Le dessin vient avant les phrases, et non après.

        Après, il tombait sous le pli d'un téléphone : on lisait trois phrases qui
        parlaient d'un bouton qu'on ne voyait pas. Sous le titre, il est toujours à
        l'écran — et l'ordre « une image, puis les mots » est de toute façon le bon pour
        qui lit avec effort.

        Décorative : « aria-hidden ». Ce qu'elle montre est écrit juste en dessous, en
        toutes lettres et avec les mêmes mots que les vrais boutons.
      -->
      {#if etape.id === 'programme'}
        <div class="dessin" aria-hidden="true">
          <div class="entoure">
            <div class="rangee">
              <span class="faux-btn faux-choisi">Jour</span>
              <span class="faux-btn">Semaine</span>
              <span class="faux-btn">Mois</span>
            </div>
          </div>
          <div class="rangee sous-dessin">
            <span class="faux-btn faux-clair">← Jour précédent</span>
            <span class="faux-btn faux-clair">Jour suivant →</span>
          </div>
        </div>
      {:else if etape.id === 'activite'}
        <div class="dessin" aria-hidden="true">
          <div class="entoure">
            <div class="fausse-carte">
              <p class="fausse-carte-titre">🧘 Relaxation</p>
              <p class="fausse-carte-detail">Mardi, de 14h00 à 15h30</p>
            </div>
          </div>
          <p class="fleche">↓</p>
          <div class="entoure">
            <span class="faux-btn faux-fort">Je m’inscris</span>
          </div>
        </div>
      {:else if etape.id === 'ma-semaine'}
        <!--
          Les deux boutons, l'un au-dessus de l'autre, comme sur le calendrier. C'est leur
          voisinage qui se retient : « et moi, dans tout ça ? » se demande à deux endroits.
        -->
        <div class="dessin" aria-hidden="true">
          <div class="entoure">
            <span class="faux-btn faux-fort">🗓️ Voir ma semaine</span>
          </div>
          <div class="entoure">
            <span class="faux-btn">📅 Demander un rendez-vous</span>
          </div>
        </div>
      {:else if etape.id === 'mes-inscriptions'}
        <div class="dessin" aria-hidden="true">
          <!-- Le bandeau, pour qu'on reconnaisse l'endroit : tout en haut, sur fond sombre. -->
          <div class="faux-bandeau">
            <span class="faux-marque">Hodie</span>
            <span class="entoure entoure-serre">
              <span class="faux-btn faux-clair">📋 Mes inscriptions</span>
            </span>
          </div>
        </div>
      {/if}

      {#each etape.lines as ligne (ligne)}
        <p class="ligne">{ligne}</p>
      {/each}
    </div>

    <!--
      Le pied de carte reste collé en bas.

      La carte défile d'un seul tenant — c'est elle qui a le focus, donc les flèches du
      clavier la font glisser — mais « Suivant » ne quitte jamais l'écran. Quelqu'un qui
      ne sait pas qu'un écran se fait glisser resterait sinon bloqué devant un texte sans
      issue visible.
    -->
    <div class="pied">
      <!--
        Où l'on en est : en toutes lettres d'abord, les points ensuite. L'information ne
        se porte jamais par la seule couleur.
      -->
      <p class="progression">{progressLabel(index, etapes.length)}</p>
      <div class="points" aria-hidden="true">
        {#each etapes as pas, rang (pas.id)}
          <span class="point" class:point-fait={rang <= index}></span>
        {/each}
      </div>

      <div class="boutons">
        <button type="button" class="btn btn-secondary" disabled={index === 0} onclick={precedent}>
          <span aria-hidden="true">←</span>
          <span>Retour</span>
        </button>
        <button type="button" class="btn btn-primary" onclick={suivant}>
          {#if derniere}
            <span>J’ai compris</span>
            <span aria-hidden="true">✓</span>
          {:else}
            <span>Suivant</span>
            <span aria-hidden="true">→</span>
          {/if}
        </button>
      </div>

      <!--
        Sortir est possible à tout moment, et c'est dit.

        En dessous des deux autres, et plus discret : on n'invite pas à partir, on rassure
        celui qui voudrait le faire.
      -->
      {#if !derniere}
        <button type="button" class="btn btn-quiet arreter" onclick={onclose}>
          Arrêter ce petit tour
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  /*
    Un cas justifié de style propre au composant.

    Le halo qui entoure un bouton, le bandeau reproduit et les points de progression
    n'existent nulle part ailleurs dans l'application : les porter dans le système de
    design en ferait des motifs à réutiliser, alors qu'ils n'ont de sens qu'ici.
  */
  .voile {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(26, 26, 56, 0.72);
    overflow-y: auto;
  }

  /*
    Le bas de la carte ne bouge pas ; seul le texte défile.

    Sur un téléphone, l'écran des activités est plus haut que la fenêtre : la carte
    entière défilait, et « Suivant » se retrouvait sous le pli. Quelqu'un qui ne sait pas
    qu'un écran se fait glisser reste bloqué là, devant un texte sans issue visible. Les
    boutons sont donc collés en bas, toujours à l'écran, et c'est le texte qui glisse
    au-dessus d'eux.
  */
  .boite {
    width: 100%;
    max-width: 40rem;
    padding: 1.75rem 1.5rem 0;
    display: grid;
    gap: 1rem;
    align-content: start;
    max-height: 100%;
    overflow-y: auto;
  }

  .contenu {
    display: grid;
    gap: 0.75rem;
    text-align: center;
    /* Un élément de grille ne rétrécit pas sous son contenu sans cela. */
    min-width: 0;
  }

  /*
    Le pied tient en trois cent huit pixels de moins qu'au premier jet.

    Sur un téléphone, il occupait plus du tiers de la hauteur : le dessin du bouton dont
    parle le texte — le cœur de cet écran — passait sous le pli. Les deux boutons de
    navigation reviennent donc côte à côte, avec moins de marge intérieure, et l'espace
    gagné va au dessin.
  */
  .pied {
    position: sticky;
    bottom: 0;
    display: grid;
    gap: 0.35rem;
    padding-block: 0.5rem 1.25rem;
    background: var(--color-surface);
    /* Le texte qui passe sous le pied se devine : sinon la coupure ressemble à une fin. */
    box-shadow: 0 -10px 12px -10px rgba(22, 32, 43, 0.35);
  }

  .image {
    font-size: 2.25rem;
    line-height: 1;
  }

  /* De la place à revendre : l'image peut respirer. */
  @media (min-height: 56rem) {
    .image {
      font-size: 3.25rem;
    }
  }

  .titre {
    font-size: 1.85rem;
    font-weight: 700;
    color: var(--color-ink);
  }

  .ligne {
    font-size: 1.2rem;
    color: var(--color-ink);
  }

  .dessin {
    display: grid;
    gap: 0.5rem;
    max-width: 100%;
    min-width: 0;
    justify-items: center;
    margin-top: 0.25rem;
    padding: 0.7rem 0.5rem;
    border-radius: 14px;
    background: var(--color-surface-soft);
  }

  .sous-dessin {
    opacity: 0.75;
  }

  .rangee {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
  }

  /*
    Le halo. Il est doublé par le texte, qui nomme le bouton ; la couleur seule ne dit
    jamais rien dans cette application.
  */
  .entoure {
    display: inline-block;
    padding: 0.35rem;
    border-radius: 16px;
    outline: 4px solid var(--color-brand-500);
    outline-offset: 4px;
    animation: respire 1.8s ease-in-out infinite;
  }

  .entoure-serre {
    padding: 0.15rem;
    outline-offset: 2px;
  }

  @keyframes respire {
    0%,
    100% {
      outline-color: var(--color-brand-500);
    }
    50% {
      outline-color: var(--color-brand-900);
    }
  }

  /* Exigence non négociable du projet : rien ne bouge pour qui a demandé le calme. */
  @media (prefers-reduced-motion: reduce) {
    .entoure {
      animation: none;
    }
  }

  /*
    Des reproductions, et non de vrais boutons : ni cliquables, ni atteignables au
    clavier, ni annoncées. Elles ont l'apparence des vraies, ce qui est tout l'objet.
  */
  .faux-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    padding: 0.55rem 1rem;
    border-radius: 12px;
    border: 2px solid var(--color-line);
    background: var(--color-surface);
    color: var(--color-ink);
    font-size: 1.05rem;
    font-weight: 600;
    /*
      Le libellé peut passer à la ligne, comme celui du vrai bouton.

      Il était insécable, et sur un écran de trois cent vingt pixels — un vieux téléphone,
      il y en a — « 🗓️ Voir ma semaine » sortait de la carte en emportant le texte avec
      lui. Un dessin qui déborde ment sur ce qu'on verra ; celui-ci se comporte comme
      l'original.
    */
    white-space: normal;
    text-align: center;
  }

  .faux-choisi {
    background: var(--color-brand-700);
    border-color: var(--color-brand-700);
    color: #fff;
  }

  .faux-fort {
    background: var(--color-brand-700);
    border-color: var(--color-brand-700);
    color: #fff;
    min-height: 52px;
    font-size: 1.15rem;
  }

  .faux-clair {
    background: var(--color-surface);
    color: var(--color-brand-900);
    border-color: var(--color-brand-700);
  }

  .fausse-carte {
    width: min(20rem, 100%);
    padding: 0.6rem 0.85rem;
    border-radius: 14px;
    border: 2px solid var(--color-line);
    background: var(--color-surface);
    text-align: left;
  }

  .fausse-carte-titre {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--color-ink);
  }

  .fausse-carte-detail {
    font-size: 1rem;
    color: var(--color-ink-soft);
  }

  .fleche {
    font-size: 1.2rem;
    line-height: 1;
    color: var(--color-ink-soft);
  }

  /*
    Le bandeau reproduit tient dans la largeur d'un téléphone.

    « 📋 Mes inscriptions » ne se coupe pas — c'est le libellé exact du vrai bouton, et
    c'est tout l'objet du dessin. À taille normale, l'ensemble réclamait trois cent douze
    pixels pour deux cent quatre-vingt-seize : la carte débordait et tout le texte se
    trouvait rogné à droite. On réduit donc l'échelle du dessin, pas son contenu.
  */
  .faux-bandeau {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: min(22rem, 100%);
    min-width: 0;
    padding: 0.6rem;
    border-radius: 12px;
    background: var(--color-brand-900);
  }

  .faux-marque {
    font-size: 1rem;
    font-weight: 700;
    color: #fff;
  }

  .faux-bandeau .faux-btn {
    font-size: 0.95rem;
    padding-inline: 0.7rem;
  }

  .progression {
    text-align: center;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-ink-soft);
  }

  .points {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
  }

  .point {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 999px;
    border: 2px solid var(--color-brand-700);
  }

  .point-fait {
    background: var(--color-brand-700);
  }

  /*
    Les deux boutons l'un sous l'autre sur un téléphone, côte à côte dès qu'il y a la
    place.

    Côte à côte de force, ils réclamaient trois cent trente-deux pixels pour deux cent
    quatre-vingt-seize disponibles : la carte débordait, et « Suivant » sortait de
    l'écran. Empilés, ils gardent leur pleine hauteur et leur pleine largeur — deux
    grandes cibles, ce qui est exactement ce qu'il faut ici. « Retour » reste au même
    endroit d'un écran à l'autre, ce qui est la règle.
  */
  .boutons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    min-width: 0;
    margin-top: 0.35rem;
  }

  /*
    Les boutons du petit tour se contentent d'une marge intérieure réduite.

    Ceux de l'application gardent la leur : c'est ici, et ici seulement, que deux boutons
    doivent tenir côte à côte dans une carte déjà étroite. La hauteur, elle, ne bouge pas
    — cinquante-six pixels, le plancher du projet.
  */
  .boutons :global(.btn),
  .arreter {
    padding-inline: 0.75rem;
    min-width: 0;
  }

  .arreter {
    width: 100%;
  }
</style>
