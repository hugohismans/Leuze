<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import {
    AGENDA_INLINE_DAYS,
    bookableSlots,
    noAvailabilityDeclared,
    noAvailabilityMessage,
    suggestionMessage,
  } from '../../lib/domain/agenda'
  import type { AppointmentPlanning } from '../../lib/data/staffPorts'
  import {
    addMinutes,
    formatDayLabel,
    formatFullWhen,
    formatTime,
    instantOf,
  } from '../../lib/domain/time'
  import { de } from '../../lib/domain/francais'
  import type { LocalDate, LocalTime } from '../../lib/domain/types'

  /**
   * L'agenda croisé d'un intervenant et d'un patient, avec le créneau proposé.
   *
   * Il sert aux deux manières de fixer un rendez-vous — depuis la file des demandes, et
   * sans demande préalable. C'est la même question dans les deux cas (« quand les mettre
   * ensemble ? ») et il n'y avait aucune raison qu'elle reçoive deux réponses
   * différentes : la file n'avait pas d'agenda du tout, et on y choisissait une date de
   * mémoire.
   *
   * Le croisement est calculé par le serveur, jamais ici : croiser deux agendas depuis le
   * navigateur supposerait de lui donner celui d'un collègue. On ne reçoit que des heures,
   * un état libre ou pris, et une proposition.
   */
  const {
    practitionerId,
    patientUid = '',
    preference,
    durationMin,
    practitionerName,
    patientFirstName = '',
    /**
     * Le nom exact du bouton qui enregistre, dans l'écran qui nous accueille.
     *
     * Il diffère d'un formulaire à l'autre — « Fixer le rendez-vous » depuis la file,
     * « Enregistrer ce rendez-vous » sans demande préalable. Nommer le mauvais bouton
     * serait pire que de n'en nommer aucun.
     */
    validationLabel,
    onchoisir,
  }: {
    practitionerId: string
    patientUid?: string
    preference: 'matin' | 'apres-midi' | 'peu-importe'
    durationMin: number
    practitionerName: string
    patientFirstName?: string
    validationLabel: string
    onchoisir: (localDate: LocalDate, time: LocalTime) => void
  } = $props()

  let planning = $state<AppointmentPlanning | null>(null)
  let chargement = $state(false)

  /**
   * Ce qui vient d'être posé dans le formulaire, en toutes lettres.
   *
   * Le bouton remplit des champs situés **plus haut**, souvent hors de l'écran sur un
   * téléphone : on appuie, et rien ne bouge sous les yeux. Sans un mot, le geste passe
   * pour sans effet, et l'on appuie encore.
   */
  let posee = $state<string | null>(null)

  /**
   * La clef décrit ce qui a été demandé. Tant qu'elle ne change pas, on ne relit rien —
   * sans quoi le moindre rendu relancerait une lecture.
   */
  const clef = $derived(
    practitionerId === '' ? '' : `${practitionerId}|${patientUid}|${durationMin}|${preference}`,
  )
  /*
    Volontairement PAS un « $state ».

    Le lire puis l'écrire dans le même effet en ferait une dépendance de cet effet : il se
    relancerait aussitôt, le nettoyage du premier passage marquerait la lecture périmée, et
    sa réponse serait jetée. L'écran resterait sur « Un instant… » pour toujours, sans la
    moindre erreur en console.
  */
  let luePour = ''

  /**
   * Au-delà de ce délai, on cesse d'attendre et l'on rend la main.
   *
   * Un agenda qu'on ne peut pas lire n'a jamais empêché de fixer un rendez-vous : le
   * message de repli le dit déjà, et le soignant choisit son heure. Une attente sans fin,
   * elle, bloque — et ne se distingue pas d'une panne.
   */
  const PATIENCE_MS = 12_000

  $effect(() => {
    const demandee = clef
    if (demandee === '' || demandee === luePour) return
    luePour = demandee
    chargement = true
    // Changer d'intervenant ou de durée périme l'annonce : elle nommait l'ancien créneau.
    posee = null

    /*
      La réponse retenue est celle du dernier choix, jamais celle d'un choix d'avant.

      On change d'intervenant, puis de durée : deux lectures partent, et rien ne garantit
      qu'elles reviennent dans l'ordre. Poser un rendez-vous d'après la disponibilité de
      quelqu'un d'autre, c'est exactement ce que cet écran doit empêcher.

      La comparaison se fait sur la clef, et non sur un drapeau posé par le nettoyage de
      l'effet : un effet relancé pour une raison sans rapport abandonnerait alors la
      lecture en cours sans en repartir aucune, et l'écran resterait sur « Un instant… »
      pour toujours. C'est exactement ce que cet écran a fait en production.
    */
    const aJour = () => luePour === demandee

    const abandon = setTimeout(() => {
      if (aJour() && chargement) {
        planning = null
        chargement = false
      }
    }, PATIENCE_MS)

    void staffStore
      .appointmentPlanning({
        practitionerId,
        ...(patientUid === '' ? {} : { patientUid }),
        preference,
        durationMin,
      })
      .then((valeur) => {
        if (aJour()) planning = valeur
      })
      .finally(() => {
        if (aJour()) chargement = false
        clearTimeout(abandon)
      })
  })

  /*
    La boîte de dialogue native, et non un panneau bricolé : le navigateur retient le
    clavier à l'intérieur, rend le focus au bouton qui l'a ouverte, et ferme sur « Échap ».
    Aucun de ces trois comportements n'est gratuit à réécrire, et chacun d'eux manque
    toujours dans les panneaux faits à la main.

    Volontairement PAS un « $state » : on ne la lit que dans des gestionnaires
    d'événement, jamais dans un effet — la rendre réactive n'apporterait rien et
    ouvrirait la porte au piège « lire et écrire dans le même effet ».
  */
  // svelte-ignore non_reactive_update
  let boite: HTMLDialogElement | null = null
  let ouverte = $state(false)

  /**
   * Tous les créneaux où le rendez-vous tiendrait, découpés dans ce que le serveur a
   * déjà rendu libre. Rien n'est relu : c'est la même information, autrement présentée.
   */
  const creneaux = $derived(planning === null ? [] : bookableSlots(planning.week, durationMin))
  const combien = $derived(creneaux.reduce((total, jour) => total + jour.times.length, 0))

  /**
   * Ce que l'écran déroule de lui-même : la semaine qui vient.
   *
   * Le serveur en envoie trois — c'est l'horizon sur lequel il propose, et une
   * proposition absente de la liste serait incompréhensible. Les dérouler toutes
   * enterrerait la proposition sous vingt et un jours de détail.
   */
  const semaineVisible = $derived(planning === null ? [] : planning.week.slice(0, AGENDA_INLINE_DAYS))

  function ouvrirLesCreneaux(): void {
    ouverte = true
    boite?.showModal()
  }

  /** Poser un créneau dans le formulaire, d'où qu'il vienne — la proposition ou la liste. */
  function choisir(localDate: LocalDate, time: LocalTime): void {
    onchoisir(localDate, time)
    posee = formatFullWhen(
      localDate,
      instantOf(localDate, time),
      addMinutes(instantOf(localDate, time), durationMin),
    )
    boite?.close()
  }

  /*
    Une plage jamais déclarée n'est pas un agenda plein.

    L'écran disait « aucun créneau ne convient aux deux dans les trois semaines qui
    viennent » à qui n'avait tout simplement jamais dit quand il recevait : on cherchait
    une saturation qui n'existait pas, et rien ne disait où déclarer les plages.
  */
  const aucunePlage = $derived(planning !== null && noAvailabilityDeclared(planning.week))

  const message = $derived(
    planning === null
      ? null
      : aucunePlage
        ? noAvailabilityMessage(practitionerName)
        : suggestionMessage(
          planning.suggestion,
          preference,
          planning.suggestion === null
            ? ''
            : formatFullWhen(
                planning.suggestion.localDate,
                instantOf(planning.suggestion.localDate, planning.suggestion.time),
                addMinutes(
                  instantOf(planning.suggestion.localDate, planning.suggestion.time),
                  durationMin,
                ),
              ),
        ),
  )

  function prendreLaProposition(): void {
    const proposition = planning?.suggestion
    if (proposition === null || proposition === undefined) return
    choisir(proposition.localDate, proposition.time)
  }

  const plages = (fenetres: { from: LocalTime; to: LocalTime }[]): string =>
    fenetres.map((f) => `${f.from.replace(':', 'h')} à ${f.to.replace(':', 'h')}`).join(' et de ')
</script>

{#if practitionerId !== ''}
  <section class="mt-4 rounded-xl border-2 border-line p-4">
    <h3 class="text-xl font-bold text-ink">Quand les mettre ensemble</h3>

    {#if chargement}
      <p class="mt-1 text-lg text-ink-soft">Un instant…</p>
    {:else if planning === null}
      <p class="mt-1 text-lg text-ink-soft">
        L'agenda n'a pas pu être lu. Vous pouvez fixer le rendez-vous à l'heure de votre choix.
      </p>
    {:else}
      {#if message !== null}
        <p role="status" class="mt-1 text-lg font-semibold text-ink">{message}</p>
      {/if}
      <div class="mt-3 flex flex-wrap gap-2">
        {#if planning.suggestion !== null}
          <button type="button" class="btn btn-primary" onclick={prendreLaProposition}>
            <span aria-hidden="true">✓</span> Prendre ce créneau
          </button>
        {/if}
        <!--
          La proposition répond à « quand au plus tôt ? ». Ce n'est pas toujours la
          question : on connaît la personne, on sait qu'il vaut mieux jeudi, ou plus tard
          dans la matinée. Sans la liste, il ne restait qu'à saisir une heure de mémoire
          et à espérer qu'elle soit libre.
        -->
        {#if combien > 0}
          <button type="button" class="btn btn-secondary" onclick={ouvrirLesCreneaux}>
            <span aria-hidden="true">🕑</span> Voir tous les créneaux possibles
          </button>
        {/if}
      </div>

      <!--
        « role=status » plutôt qu'une simple phrase : le changement est annoncé aussi à
        qui n'a pas les yeux sur l'écran. Et il est dit en toutes lettres, jamais par la
        seule couleur.
      -->
      {#if posee !== null}
        <p role="status" class="mt-3 rounded-xl bg-surface-soft p-4 text-lg text-ink">
          <strong>C'est noté : {posee}.</strong>
          La date et l'heure sont remplies plus haut. Vérifiez-les, puis appuyez sur
          « {validationLabel} », plus bas, pour enregistrer.
        </p>
      {/if}

      <!--
        La semaine, jour par jour : ce qui est annoncé, ce qui est déjà pris, ce qui reste.
        Une liste plutôt qu'une grille — elle se lit sur un téléphone, et elle se lit à
        voix haute.

        La frontière d'erreur n'est pas une précaution de principe. Un rendu qui échoue
        laisse le navigateur sur l'affichage précédent — ici « Un instant… » — sans rien
        dire, ni à l'écran ni dans l'état de l'application. Le soignant attend devant une
        phrase qui ment. Une donnée inattendue doit coûter cette liste, pas l'écran.
      -->
      <svelte:boundary>
      <ul class="mt-4 grid gap-3">
        {#each semaineVisible as jour (jour.localDate)}
          {#if jour.onLeave === true || jour.windows.length > 0 || jour.taken.length > 0}
            <li class="rounded-lg bg-surface-soft p-3">
              <p class="text-lg font-bold text-ink">{formatDayLabel(jour.localDate)}</p>
              <!--
                Un jour de congé n'a ni plage ni créneau : il ressemblerait trait pour
                trait à un jour où la personne ne reçoit jamais. On l'écrit, sinon
                l'absence se cherche.
              -->
              {#if jour.onLeave === true}
                <p class="text-base font-semibold text-ink">
                  <span aria-hidden="true">🌴</span> En congé — aucun rendez-vous ce jour-là.
                </p>
              {/if}
              {#if jour.windows.length > 0}
                <p class="text-base text-ink-soft">
                  <span aria-hidden="true">🗓️</span>
                  Reçoit de {plages(jour.windows)}
                </p>
              {/if}
              <!--
                La clef est le rang, et non le contenu : deux occupations identiques
                arrêteraient le rendu de Svelte, et l'écran resterait figé sur son état
                précédent — « Un instant… » pour toujours, sans que rien ne le dise. La
                liste est remplacée en entier à chaque lecture ; le rang suffit.
              -->
              {#each jour.taken as pris, rang (rang)}
                <p class="text-base text-ink">
                  <span aria-hidden="true">{pris.kind === 'appointment' ? '🩺' : '📅'}</span>
                  Pris de {formatTime(pris.start)} à {formatTime(pris.end)} — {pris.label}
                </p>
              {/each}
              {#if jour.free.length > 0}
                <p class="text-base font-semibold text-brand-900">
                  <span aria-hidden="true">✅</span>
                  Libre de {plages(jour.free)}
                </p>
              {:else if jour.windows.length > 0}
                <p class="text-base font-semibold text-ink-soft">Plus rien de libre ce jour-là.</p>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>

      <!--
        « les deux agendas : celui de Docteur Lemaire . » — la phrase promettait deux
        agendas puis n'en nommait qu'un, avec un espace avant le point. Sans patient
        désigné, il n'y en a qu'un, et la phrase le dit.
      -->
      <p class="mt-3 text-base text-ink-soft">
        {#if patientFirstName !== ''}
          « Pris » rassemble les deux agendas : celui {de(practitionerName)} et celui
          {de(patientFirstName)}.
        {:else}
          « Pris », c'est l'agenda {de(practitionerName)}.
        {/if}
        Ci-dessus, la semaine qui vient ; « Voir tous les créneaux possibles » va jusqu'à
        trois semaines.
      </p>

      {#snippet failed()}
        <p role="status" class="mt-4 rounded-xl bg-surface-soft p-4 text-lg text-ink">
          Le détail de la semaine n'a pas pu être affiché. Le créneau proposé ci-dessus
          reste valable, et vous pouvez fixer le rendez-vous à l'heure de votre choix.
        </p>
      {/snippet}
      </svelte:boundary>
    {/if}

    <!--
      La liste complète, dans une boîte de dialogue native.

      Elle n'est pas rendue tant qu'elle n'est pas ouverte : trois semaines de créneaux
      quart d'heure par quart d'heure font quelques centaines de boutons, et rien ne
      justifie de les construire pour qui ne les demande pas.

      Elle vit hors de la branche qui affiche la semaine : une relecture de l'agenda la
      fermerait sinon d'un coup, en plein choix.
    -->
    <dialog bind:this={boite} class="creneaux" onclose={() => (ouverte = false)}>
      {#if ouverte}
        <div class="max-h-[85vh] overflow-y-auto p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-2xl font-bold text-ink">Tous les créneaux possibles</h2>
            <button type="button" class="btn btn-quiet" onclick={() => boite?.close()}>
              <span aria-hidden="true">✕</span> Fermer
            </button>
          </div>

          {#if chargement}
            <p class="mt-3 text-lg text-ink-soft">Un instant…</p>
          {:else if creneaux.length === 0}
            <p class="mt-3 text-lg text-ink-soft">
              Il ne reste aucun créneau libre dans les trois semaines qui viennent. Vous pouvez
              tout de même fixer le rendez-vous à l'heure de votre choix.
            </p>
          {:else}
            <p class="mt-2 text-lg text-ink">
              Appuyez sur une heure : elle se remplit dans le formulaire. Rien n'est enregistré
              avant que vous appuyiez sur « {validationLabel} ».
            </p>
            <p class="mt-1 text-base text-ink-soft">
              {durationMin} minutes, dans l'agenda de {practitionerName}{#if patientFirstName !== ''}{' '}et
                de {patientFirstName}{/if}.
            </p>

            <ul class="mt-4 grid gap-4">
              {#each creneaux as jour (jour.localDate)}
                <li>
                  <h3 class="text-lg font-bold text-ink">{formatDayLabel(jour.localDate)}</h3>
                  <ul class="mt-2 flex flex-wrap gap-2">
                    {#each jour.times as heure (heure)}
                      <li>
                        <button
                          type="button"
                          class="btn btn-quiet"
                          onclick={() => choisir(jour.localDate, heure)}
                        >
                          {heure.replace(':', 'h')}
                        </button>
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>

            <button type="button" class="btn btn-quiet mt-4" onclick={() => boite?.close()}>
              <span aria-hidden="true">✕</span> Fermer sans rien changer
            </button>
          {/if}
        </div>
      {/if}
    </dialog>
  </section>
{/if}

<style>
  /*
    Une boîte lisible sur un téléphone comme sur un poste : elle occupe la largeur
    disponible, sans jamais dépasser l'écran ni s'étirer sur un grand moniteur.
  */
  .creneaux {
    width: min(46rem, calc(100vw - 2rem));
    max-width: 100%;
    /* La remise à zéro des marges du projet défait le centrage que le navigateur donne
       aux boîtes modales : sans cette ligne, elle se colle en haut à gauche. */
    margin: auto;
    padding: 0;
    border: 2px solid var(--color-line);
    border-radius: 14px;
    background: var(--color-surface);
    color: var(--color-ink);
  }
  .creneaux::backdrop {
    background: rgb(0 0 0 / 0.55);
  }
</style>
