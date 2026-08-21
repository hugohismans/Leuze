<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { proposed } from '../../lib/domain/catalog'
  import {
    PREFERENCE_LABELS,
    kindIcon,
    kindName,
    pendingFirst,
    waitingDays,
    waitingLabel,
  } from '../../lib/domain/appointments'
  import { formatFullWhen, todayLocalDate } from '../../lib/domain/time'
  import type { LocalDate, LocalTime } from '../../lib/domain/types'

  /**
   * La file des demandes de rendez-vous.
   *
   * Faute de notification, la seule chose qui protège d'un oubli est que l'attente se
   * voie : les demandes les plus anciennes sont en tête, et leur ancienneté est écrite
   * en toutes lettres. Une demande qui traîne doit sauter aux yeux.
   */
  const kinds = $derived(store.appointmentKinds)
  const enAttente = $derived(pendingFirst(staffStore.appointments))
  const fixes = $derived(
    staffStore.appointments
      .filter((a) => a.status === 'scheduled')
      .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0)),
  )

  const DUREES = [15, 30, 45, 60]

  let ouvert = $state<string | null>(null)
  let date = $state<LocalDate>(todayLocalDate())
  let heure = $state<LocalTime>('10:00')
  let duree = $state(30)
  let avecQui = $state('')
  let lieu = $state('')
  let busy = $state(false)

  const patient = (uid: string) => staffStore.patients.find((p) => p.uid === uid)

  /**
   * Fixer un rendez-vous sans demande préalable.
   *
   * Beaucoup de patients ne se serviront jamais de l'application : ils en parlent à un
   * soignant, qui note. Ne pas le permettre reviendrait à réserver l'agenda à ceux qui
   * ont un téléphone — exactement l'inverse de ce que cette application doit faire.
   */
  let formulaireOuvert = $state(false)
  let quiUid = $state('')
  let quelKind = $state('')
  let dateDirecte = $state<LocalDate>(todayLocalDate())
  let heureDirecte = $state<LocalTime>('10:00')
  let dureeDirecte = $state(30)
  let avecQuiDirecte = $state('')
  let lieuDirecte = $state('')

  // Les personnes sont groupées par service : c'est ainsi qu'un soignant les cherche.
  const patientsParService = $derived(
    proposed(store.services)
      .map((service) => ({
        service,
        patients: staffStore.patients
          .filter((p) => p.serviceId === service.id)
          .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr')),
      }))
      .filter((groupe) => groupe.patients.length > 0),
  )

  $effect(() => {
    if (quelKind === '' && kinds.length > 0) quelKind = kinds[0]!.id
  })

  // Le professionnel est pré-rempli par son rôle ; le soignant met un prénom s'il veut.
  $effect(() => {
    const choisi = kinds.find((k) => k.id === quelKind)
    if (choisi !== undefined && avecQuiDirecte === '') avecQuiDirecte = choisi.name
  })

  async function fixerDirectement(): Promise<void> {
    if (busy || quiUid === '' || quelKind === '' || avecQuiDirecte.trim().length === 0) return
    busy = true
    const ok = await staffStore.createAppointment({
      patientUid: quiUid,
      kindId: quelKind,
      date: dateDirecte,
      time: heureDirecte,
      durationMin: dureeDirecte,
      withWhom: avecQuiDirecte.trim(),
      ...(lieuDirecte ? { locationId: lieuDirecte } : {}),
    })
    if (ok) {
      formulaireOuvert = false
      quiUid = ''
      lieuDirecte = ''
    }
    busy = false
  }

  function ouvrir(appointmentId: string, kindId: string): void {
    ouvert = appointmentId
    date = todayLocalDate()
    heure = '10:00'
    duree = 30
    // Pré-rempli avec le rôle : le soignant remplace par un prénom s'il le souhaite.
    avecQui = kindName(kinds, kindId)
    lieu = ''
  }

  async function fixer(appointmentId: string): Promise<void> {
    if (busy || avecQui.trim().length === 0) return
    busy = true
    await staffStore.scheduleAppointment(appointmentId, {
      date,
      time: heure,
      durationMin: duree,
      withWhom: avecQui.trim(),
      ...(lieu ? { locationId: lieu } : {}),
    })
    ouvert = null
    busy = false
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Demandes de rendez-vous</h1>
  <p class="mb-5 text-lg text-ink-soft">
    Les demandes les plus anciennes sont en tête. Consultez l'agenda, fixez la date, puis
    dites-le au patient : il le verra aussi dans son application.
  </p>

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  <!--
    Avant la file : c'est le geste le plus courant. La plupart des rendez-vous seront
    demandés de vive voix, pas par l'application.
  -->
  {#if !formulaireOuvert}
    <button type="button" class="btn btn-primary mb-6" onclick={() => (formulaireOuvert = true)}>
      <span aria-hidden="true">＋</span> Fixer un rendez-vous
    </button>
  {:else}
    <form
      class="card mb-6 p-4"
      onsubmit={(event) => {
        event.preventDefault()
        void fixerDirectement()
      }}
    >
      <h2 class="mb-1 text-2xl font-bold text-ink">Fixer un rendez-vous</h2>
      <p class="mb-3 text-lg text-ink-soft">
        Pour une personne qui vous l'a demandé de vive voix. Elle n'a rien à faire dans
        l'application : le rendez-vous apparaîtra dans son calendrier.
      </p>

      <label for="qui" class="mb-2 block text-lg font-semibold text-ink">Pour qui</label>
      <select id="qui" bind:value={quiUid} class={champ} style="min-height: 56px;">
        <option value="">Choisissez une personne</option>
        {#each patientsParService as groupe (groupe.service.id)}
          <optgroup label={groupe.service.name}>
            {#each groupe.patients as personne (personne.uid)}
              <option value={personne.uid}>{personne.firstName}</option>
            {/each}
          </optgroup>
        {/each}
      </select>

      <label for="motif" class="mt-4 mb-2 block text-lg font-semibold text-ink">Avec quel professionnel</label>
      <select id="motif" bind:value={quelKind} class={champ} style="min-height: 56px;">
        {#each kinds as genre (genre.id)}
          <option value={genre.id}>{genre.icon} {genre.name}</option>
        {/each}
      </select>

      <div class="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label for="jour" class="mb-2 block text-lg font-semibold text-ink">Le jour</label>
          <input id="jour" type="date" bind:value={dateDirecte} class={champ} style="min-height: 56px;" />
        </div>
        <div>
          <label for="quand" class="mb-2 block text-lg font-semibold text-ink">À quelle heure</label>
          <input id="quand" type="time" bind:value={heureDirecte} class={champ} style="min-height: 56px;" />
        </div>
        <div>
          <label for="combien" class="mb-2 block text-lg font-semibold text-ink">Combien de temps</label>
          <select id="combien" bind:value={dureeDirecte} class={champ} style="min-height: 56px;">
            {#each DUREES as minutes (minutes)}
              <option value={minutes}>{minutes} minutes</option>
            {/each}
          </select>
        </div>
      </div>

      <label for="nom" class="mt-4 mb-2 block text-lg font-semibold text-ink">
        Nom du professionnel — le patient le lira
      </label>
      <input id="nom" bind:value={avecQuiDirecte} class={champ} style="min-height: 56px;" />

      <label for="ou" class="mt-4 mb-2 block text-lg font-semibold text-ink">Où — facultatif</label>
      <select id="ou" bind:value={lieuDirecte} class={champ} style="min-height: 56px;">
        <option value="">Non précisé</option>
        {#each proposed(store.locations) as endroit (endroit.id)}
          <option value={endroit.id}>{endroit.name}</option>
        {/each}
      </select>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          class="btn btn-primary"
          disabled={busy || quiUid === '' || avecQuiDirecte.trim().length === 0}
        >
          {busy ? 'Un instant…' : 'Enregistrer ce rendez-vous'}
        </button>
        <button type="button" class="btn btn-secondary" onclick={() => (formulaireOuvert = false)}>
          Annuler
        </button>
      </div>
    </form>
  {/if}

  <h2 class="mb-3 text-2xl font-bold text-ink">
    En attente {enAttente.length > 0 ? `(${enAttente.length})` : ''}
  </h2>

  {#if enAttente.length === 0}
    <p class="card p-5 text-lg text-ink-soft">Aucune demande en attente.</p>
  {:else}
    <ul class="grid gap-4">
      {#each enAttente as demande (demande.id)}
        {@const jours = waitingDays(demande)}
        {@const personne = patient(demande.patientUid)}
        <li class="card p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-xl font-bold text-ink">
              <span aria-hidden="true">{kindIcon(kinds, demande.kindId)}</span>
              {personne?.firstName ?? 'Prénom inconnu'} — {kindName(kinds, demande.kindId)}
            </h3>
            <!-- L'attente est doublée d'un mot : jamais la couleur seule. -->
            <span class="badge" class:font-bold={jours >= 3} style="background: var(--color-surface-soft); color: var(--color-ink);">
              {#if jours >= 3}<span aria-hidden="true">⏳</span>{/if}
              {waitingLabel(jours)}
            </span>
          </div>

          <p class="text-base text-ink-soft">
            {store.serviceOf(personne?.serviceId ?? null)?.name ?? 'Service inconnu'}
            · {PREFERENCE_LABELS[demande.preference]}
          </p>

          {#if ouvert === demande.id}
            <div class="mt-3 rounded-xl border-2 border-line p-4">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label for="date" class="mb-2 block text-lg font-semibold text-ink">Date</label>
                  <input id="date" type="date" bind:value={date} class={champ} style="min-height: 56px;" />
                </div>
                <div>
                  <label for="heure" class="mb-2 block text-lg font-semibold text-ink">Heure</label>
                  <input id="heure" type="time" bind:value={heure} class={champ} style="min-height: 56px;" />
                </div>
                <div>
                  <label for="duree" class="mb-2 block text-lg font-semibold text-ink">Durée</label>
                  <select id="duree" bind:value={duree} class={champ} style="min-height: 56px;">
                    {#each DUREES as minutes (minutes)}
                      <option value={minutes}>{minutes} minutes</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label for="avecqui" class="mb-2 block text-lg font-semibold text-ink">Avec qui</label>
                  <input id="avecqui" bind:value={avecQui} class={champ} style="min-height: 56px;" />
                </div>
              </div>

              <label for="lieu" class="mt-4 mb-2 block text-lg font-semibold text-ink">Où — facultatif</label>
              <select id="lieu" bind:value={lieu} class={champ} style="min-height: 56px;">
                <option value="">Non précisé</option>
                {#each proposed(store.locations) as l (l.id)}
                  <option value={l.id}>{l.name}</option>
                {/each}
              </select>

              <div class="mt-4 flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary" disabled={busy} onclick={() => fixer(demande.id)}>
                  Fixer le rendez-vous
                </button>
                <button type="button" class="btn btn-secondary" onclick={() => (ouvert = null)}>Annuler</button>
              </div>
            </div>
          {:else}
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn btn-primary" onclick={() => ouvrir(demande.id, demande.kindId)}>
                Fixer le rendez-vous
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                onclick={() => staffStore.cancelAppointment(demande.id, "Un soignant en a parlé avec la personne")}
              >
                Retirer de la file
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h2 class="mt-8 mb-3 text-2xl font-bold text-ink">Rendez-vous fixés</h2>
  {#if fixes.length === 0}
    <p class="card p-5 text-lg text-ink-soft">Aucun rendez-vous fixé pour le moment.</p>
  {:else}
    <ul class="grid gap-3">
      {#each fixes as rendezVous (rendezVous.id)}
        <li class="card p-4">
          <p class="text-lg font-bold text-ink">
            <span aria-hidden="true">{kindIcon(kinds, rendezVous.kindId)}</span>
            {patient(rendezVous.patientUid)?.firstName ?? 'Prénom inconnu'} — {rendezVous.withWhom}
          </p>
          {#if rendezVous.localDate && rendezVous.start && rendezVous.end}
            <p class="text-base text-ink">
              {formatFullWhen(rendezVous.localDate, rendezVous.start, rendezVous.end)}
              {#if rendezVous.locationId}· {store.locationOf(rendezVous.locationId)?.name}{/if}
            </p>
          {/if}
          <button
            type="button"
            class="btn btn-secondary mt-2"
            onclick={() => staffStore.cancelAppointment(rendezVous.id, 'Le rendez-vous a été déplacé')}
          >
            Annuler ce rendez-vous
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
