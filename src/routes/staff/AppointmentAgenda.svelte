<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { suggestionMessage } from '../../lib/domain/agenda'
  import type { AppointmentPlanning } from '../../lib/data/staffPorts'
  import {
    addMinutes,
    formatDayLabel,
    formatFullWhen,
    formatTime,
    instantOf,
  } from '../../lib/domain/time'
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
    onchoisir,
  }: {
    practitionerId: string
    patientUid?: string
    preference: 'matin' | 'apres-midi' | 'peu-importe'
    durationMin: number
    practitionerName: string
    patientFirstName?: string
    onchoisir: (localDate: LocalDate, time: LocalTime) => void
  } = $props()

  let planning = $state<AppointmentPlanning | null>(null)
  let chargement = $state(false)

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

  const message = $derived(
    planning === null
      ? null
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
    onchoisir(proposition.localDate, proposition.time)
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
      {#if planning.suggestion !== null}
        <button type="button" class="btn btn-primary mt-3" onclick={prendreLaProposition}>
          <span aria-hidden="true">✓</span> Prendre ce créneau
        </button>
      {/if}

      <!--
        La semaine, jour par jour : ce qui est annoncé, ce qui est déjà pris, ce qui reste.
        Une liste plutôt qu'une grille — elle se lit sur un téléphone, et elle se lit à
        voix haute.
      -->
      <ul class="mt-4 grid gap-3">
        {#each planning.week as jour (jour.localDate)}
          {#if jour.windows.length > 0 || jour.taken.length > 0}
            <li class="rounded-lg bg-surface-soft p-3">
              <p class="text-lg font-bold text-ink">{formatDayLabel(jour.localDate)}</p>
              {#if jour.windows.length > 0}
                <p class="text-base text-ink-soft">
                  <span aria-hidden="true">🗓️</span>
                  Reçoit de {plages(jour.windows)}
                </p>
              {/if}
              {#each jour.taken as pris (pris.label + pris.start.toISOString())}
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

      <p class="mt-3 text-base text-ink-soft">
        « Pris » rassemble les deux agendas : celui de {practitionerName}
        {#if patientFirstName !== ''}et celui de {patientFirstName}{/if}.
      </p>
    {/if}
  </section>
{/if}
