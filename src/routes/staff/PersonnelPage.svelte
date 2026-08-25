<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { store } from '../../lib/appState.svelte'
  import { uniqueSlug } from '../../lib/domain/slug'
  import {
    availabilityLabel,
    normalizeAvailability,
    weekdayName,
  } from '../../lib/domain/availability'
  import type { AvailabilityWindow, IsoWeekday, Practitioner } from '../../lib/domain/types'
  import { canSeePractitionerPlanning } from '../../lib/domain/appointmentAccess'
  import { practitionerAudience } from '../../lib/domain/practitioners'
  import { daysCovered, leaveRefusal, type Leave } from '../../lib/domain/leave'
  import type { LeaveOutcome } from '../../lib/data/staffPorts'
  import { formatLongDayLabel, formatTime, todayLocalDate } from '../../lib/domain/time'
  import type { LocalDate } from '../../lib/domain/types'
  import { proposed } from '../../lib/domain/catalog'
  import type { Account } from '../../lib/domain/impersonation'
  import { navigate } from '../../lib/router.svelte'
  import { enClair } from '../../lib/erreurs'

  /**
   * Le personnel : qui anime, qui reçoit.
   *
   * Écran jumeau de celui des patients, et pour la même raison — c'est une liste de
   * personnes, pas un réglage. Les lieux et les catégories restent dans le catalogue ;
   * les gens ont leur propre page.
   *
   * ⚠️ Aucune donnée personnelle au-delà de ce qui s'affiche sur un planning : un nom
   * tel qu'il sera lu par les patients, et une fonction. Ni adresse, ni téléphone, ni
   * matricule — l'écran ne propose même pas de champ pour en saisir.
   */
  let nom = $state('')
  let poste = $state('')
  let motifId = $state('')
  /**
   * Les unités où cette personne intervient.
   *
   * Tout le monde ne passe pas partout : l'assistante sociale de La Couturelle ne reçoit
   * pas les patients de L'Ancrive, tandis que l'animateur sportif passe dans toutes.
   * C'est ce qui décide à qui l'application la propose quand un patient demande à voir
   * quelqu'un en particulier.
   *
   * « Toutes les unités » reste l'état d'origine : une personne enregistrée avant ce
   * réglage continue de couvrir tout l'hôpital, et rien ne se restreint en silence.
   */
  let pourToutes = $state(true)
  let unites = $state<string[]>([])

  // Un service retiré n'est plus proposé ; ceux déjà cochés restent tels quels.
  const servicesProposes = $derived(proposed(store.services))

  /**
   * Les congés : une exception datée posée par-dessus les plages.
   *
   * « Je reçois le mardi de 9 h à 12 h » ne sait pas dire « sauf la semaine du 15 ».
   * Sans cette exception, l'application proposait des rendez-vous en pleine absence, et
   * c'est le patient qui l'apprenait devant une porte fermée.
   *
   * Le motif n'est pas demandé et ne le sera pas : la raison d'une absence ne regarde
   * pas une application de programme d'activités.
   */
  let congesOuverts = $state<string | null>(null)
  let congeDu = $state<LocalDate>(todayLocalDate())
  let congeAu = $state<LocalDate>(todayLocalDate())
  let congeErreur = $state<string | null>(null)
  /** Ce que le congé bousculerait, quand le serveur a demandé confirmation. */
  let aConfirmer = $state<LeaveOutcome | null>(null)
  /**
   * Les dates pour lesquelles cette confirmation a été calculée.
   *
   * L'encadré nommait une séance et n'était jamais recalculé : on changeait les dates
   * sans le fermer, on appuyait sur « Déclarer le congé », et c'était une **autre**
   * séance — jamais affichée — qui était annulée. On lisait « mercredi 2 septembre » et
   * l'on annulait le mercredi 9. Une confirmation qui ne décrit plus ce qu'on valide est
   * pire que pas de confirmation du tout.
   */
  let confirmePour = $state('')
  const confirmationAJour = $derived(aConfirmer !== null && confirmePour === `${congeDu}|${congeAu}`)
  const datesOntChange = $derived(aConfirmer !== null && !confirmationAJour)
  /**
   * Annuler aussi les séances animées pendant le congé.
   *
   * Coché d'emblée, parce que c'est le cas courant : on s'absente, personne ne les
   * anime plus, et les laisser au programme met des gens devant une salle vide. Le
   * décocher reste un geste — un collègue peut très bien les assurer, et l'application
   * n'a aucun moyen de le deviner.
   */
  let annulerLesSeances = $state(true)

  /**
   * Le libellé d'un jour, au milieu d'une phrase.
   *
   * « Du Mardi 25 août » porte une majuscule qui n'a rien à y faire : le libellé est
   * écrit pour commencer une ligne, pas pour suivre « du ».
   */
  const enPhrase = (jour: LocalDate): string => {
    const libelle = formatLongDayLabel(jour)
    return libelle.charAt(0).toLowerCase() + libelle.slice(1)
  }

  function ouvrirLesConges(practitionerId: string): void {
    congesOuverts = practitionerId
    congeDu = todayLocalDate()
    congeAu = todayLocalDate()
    congeErreur = null
    aConfirmer = null
    confirmePour = ''
    annulerLesSeances = true
  }

  function fermerLesConges(): void {
    congesOuverts = null
    aConfirmer = null
    confirmePour = ''
    congeErreur = null
  }

  async function declarerLeConge(practitionerId: string, force = false): Promise<void> {
    const conge = { from: congeDu, to: congeAu }
    /*
      On ne valide que ce qui est écrit à l'écran.

      Le garde-fou est ici et non seulement dans le gabarit : le bouton disparaît quand
      les dates changent, mais un appui déjà parti ne doit pas aboutir sur des dates que
      personne n'a relues.
    */
    if (force && confirmePour !== `${conge.from}|${conge.to}`) {
      aConfirmer = null
      return
    }
    const refus = leaveRefusal(conge)
    if (refus !== null) {
      congeErreur = refus
      return
    }
    congeErreur = null
    await tenter(async () => {
      const resultat = await staffStore.declareLeave(practitionerId, conge, {
        force,
        ...(force && annulerLesSeances ? { cancelSessions: true } : {}),
      })
      if (resultat.needsConfirmation === true) {
        // On ne ferme rien : l'écran nomme ce qui va bouger, et l'on tranche en le lisant.
        aConfirmer = resultat
        confirmePour = `${conge.from}|${conge.to}`
        return
      }
      if (!resultat.ok) {
        congeErreur = resultat.message
        return
      }
      fermerLesConges()
    })
  }

  async function retirerLeConge(practitionerId: string, conge: Leave): Promise<void> {
    await tenter(async () => {
      await staffStore.removeLeave(practitionerId, conge)
    })
  }

  function basculerUnite(id: string): void {
    unites = unites.includes(id) ? unites.filter((u) => u !== id) : [...unites, id]
  }
  let busy = $state(false)
  let erreur = $state<string | null>(null)

  /**
   * Les comptes existants, pour savoir qui est administrateur.
   *
   * Un intervenant n'est pas un compte : la case « Administrateur » n'a de sens que si
   * quelqu'un se connecte avec ce nom-là. On lit donc les comptes, et la case n'apparaît
   * que sur les fiches qui en ont un.
   */
  let comptes = $state<Account[]>([])

  /*
    « Déjà demandé » plutôt que « la liste est vide ».

    Se garder sur « comptes.length > 0 » revenait à relire indéfiniment tant que la
    réponse était vide : la réponse vide réécrit l'état, l'effet se relance, la garde ne
    retient plus rien, et l'on repart. Un service sans aucun compte aurait interrogé le
    serveur en boucle. Ce drapeau n'est pas réactif — le lire ne doit pas relancer l'effet
    qui l'écrit.
  */
  let deja = false

  $effect(() => {
    if (!staffStore.isAdmin || deja) return
    deja = true
    // Une réponse qui arrive après qu'on a quitté l'écran n'a rien à y écrire.
    let perimee = false
    void staffStore
      .listAccounts()
      .then((valeur) => {
        if (!perimee) comptes = valeur
      })
      .catch(() => {
        // Une lecture qui échoue ne doit pas condamner l'écran : on pourra réessayer.
        deja = false
      })
    return () => {
      perimee = true
    }
  })

  const compteDe = (practitionerId: string): Account | undefined =>
    comptes.find((c) => c.kind === 'staff' && c.practitionerId === practitionerId)

  async function basculerAdministrateur(compte: Account, administrateur: boolean): Promise<void> {
    await tenter(async () => {
      const ok = await staffStore.setStaffRole(compte.uid, administrateur ? 'admin' : 'staff', {
        ...(compte.practitionerId === undefined ? {} : { practitionerId: compte.practitionerId }),
        firstName: compte.label,
      })
      // La liste vient du serveur : on la relit plutôt que de deviner ce qu'il a écrit.
      if (ok) comptes = await staffStore.listAccounts()
    })
  }

  /** Qui regarde : la règle d'accès aux plannings vit dans le domaine, pas ici. */
  const moi = $derived({
    role: staffStore.identity.role,
    practitionerId: staffStore.identity.practitionerId,
  })

  /** Modification d'une personne existante, dépliée sous sa fiche. */
  let edition = $state<string | null>(null)
  /** Retrait, confirmé sur place. */
  let aRetirer = $state<string | null>(null)
  /** Accès : l'adresse saisie, puis le mot de passe affiché une seule fois. */
  let accesPour = $state<string | null>(null)
  let adresse = $state('')
  let motDePasse = $state<{ email: string; valeur: string } | null>(null)

  /**
   * Les plages où quelqu'un reçoit : une semaine type, saisie par l'intéressé lui-même —
   * il est le seul à savoir quand il est là — ou par l'administrateur. Les règles
   * Firestore appliquent la même chose : chacun ne touche qu'à ses propres plages, et à
   * rien d'autre de sa fiche.
   */
  let plagesOuvertes = $state<string | null>(null)
  let brouillon = $state<AvailabilityWindow[]>([])
  const JOURS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7]

  const peutModifierLesPlages = (practitionerId: string): boolean =>
    staffStore.isAdmin || staffStore.identity.practitionerId === practitionerId

  function ouvrirLesPlages(personne: Practitioner): void {
    plagesOuvertes = personne.id
    const existantes = personne.availability ?? []
    // Une liste vide n'offrirait rien à remplir : on pose une première plage.
    brouillon =
      existantes.length > 0
        ? existantes.map((f) => ({ ...f }))
        : [{ weekday: 2, from: '09:00', to: '12:00' }]
  }

  async function basculerAutoAccept(practitionerId: string, valeur: boolean): Promise<void> {
    await tenter(async () => {
      await staffStore.setAutoAccept(practitionerId, valeur)
    })
  }

  async function enregistrerLesPlages(practitionerId: string): Promise<void> {
    // Le domaine remet de l'ordre avant l'enregistrement : tri, fusion, rejet du vide.
    const propres = normalizeAvailability(brouillon)
    await tenter(async () => {
      await staffStore.saveAvailability(practitionerId, propres)
      plagesOuvertes = null
    })
  }

  const enPoste = $derived(store.practitioners.filter((p) => p.isActive))
  const retires = $derived(store.practitioners.filter((p) => !p.isActive))

  async function tenter(action: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    erreur = null
    try {
      await action()
    } catch (error) {
      erreur = enClair(error)
    } finally {
      busy = false
    }
  }

  function ouvrirEdition(id: string): void {
    const personne = store.practitionerOf(id)
    edition = id
    nom = personne?.name ?? ''
    poste = personne?.role ?? ''
    motifId = personne?.kindId ?? ''
    const public_ = personne === null ? null : practitionerAudience(personne)
    pourToutes = public_ === null || public_.audience === 'all'
    unites = public_?.serviceIds ?? []
  }

  function fermer(): void {
    edition = null
    nom = ''
    poste = ''
    motifId = ''
    // Une nouvelle personne couvre tout l'hôpital tant qu'on n'a pas dit le contraire.
    pourToutes = true
    unites = []
  }

  async function enregistrer(): Promise<void> {
    if (nom.trim().length === 0) return
    const id = edition ?? uniqueSlug(nom, store.practitioners.map((p) => p.id))
    await tenter(async () => {
      await staffStore.savePractitioner({
        id,
        name: nom.trim(),
        role: poste.trim(),
        ...(motifId ? { kindId: motifId } : {}),
        /*
          Les deux champs sont toujours écrits, jamais l'un sans l'autre : l'écriture se
          fait par fusion, et n'écrire que « audience » laisserait derrière une ancienne
          liste d'unités qui contredirait le choix qu'on vient de faire.
        */
        audience: pourToutes ? ('all' as const) : ('services' as const),
        serviceIds: pourToutes ? [] : unites,
        isActive: true,
      })
      fermer()
    })
  }

  async function retirer(id: string): Promise<void> {
    await tenter(async () => {
      await staffStore.removeCatalogEntry('practitioner', id)
      aRetirer = null
    })
  }

  async function remettre(id: string): Promise<void> {
    const personne = store.practitionerOf(id)
    if (personne === null) return
    await tenter(async () => {
      await staffStore.savePractitioner({ ...personne, isActive: true })
    })
  }

  async function donnerAcces(id: string): Promise<void> {
    if (adresse.trim().length === 0) return
    const email = adresse.trim()
    await tenter(async () => {
      const valeur = await staffStore.createStaffAccount(email, id)
      accesPour = null
      adresse = ''
      motDePasse = valeur === null ? null : { email, valeur }
    })
  }

  const champ = 'w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink'
</script>

<section class="mx-auto max-w-4xl px-4 py-6">
  <h1 class="mb-2 text-3xl font-bold text-ink">Le personnel</h1>
  <p class="mb-4 text-lg text-ink-soft">
    Les personnes qui animent une activité ou reçoivent en rendez-vous. Leur nom est
    proposé partout où il faut en désigner une, et chacune a son planning.
  </p>

  {#if !staffStore.isAdmin}
    <p role="status" class="mb-4 rounded-xl bg-surface-soft p-3 text-lg text-ink">
      <span aria-hidden="true">🔒</span>
      Seul un administrateur peut modifier cette liste. Vous pouvez la consulter.
    </p>
  {/if}

  {#if erreur !== null}
    <p role="alert" class="mb-4 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
      <span aria-hidden="true">⚠️</span> {erreur}
    </p>
  {/if}

  {#if motDePasse !== null}
    <!-- Affiché une seule fois, comme un code patient : rien ne le retrouve ensuite. -->
    <div class="card mb-4 border-4 border-brand-700 p-5">
      <h2 class="text-2xl font-bold text-ink">Mot de passe provisoire</h2>
      <p class="my-3 text-center text-4xl font-bold tracking-widest text-brand-900">{motDePasse.valeur}</p>
      <p class="text-lg text-ink">À remettre avec l'adresse {motDePasse.email}.</p>
      <p class="mt-2 text-base text-ink-soft">
        Il ne sera plus affiché. S'il est perdu, refaites « Lui donner un accès » : le
        compte existant sera relié sans changer son mot de passe.
      </p>
      <button type="button" class="btn btn-primary mt-3" onclick={() => (motDePasse = null)}>
        J'ai noté le mot de passe
      </button>
    </div>
  {/if}

  {#if staffStore.message !== null}
    <p role="status" class="mb-4 rounded-xl bg-brand-100 p-3 text-lg font-semibold text-brand-900">
      {staffStore.message}
    </p>
  {/if}

  {#if staffStore.isAdmin && edition === null}
    <form
      class="card mb-6 p-4"
      onsubmit={(event) => {
        event.preventDefault()
        void enregistrer()
      }}
    >
      <h2 class="mb-3 text-2xl font-bold text-ink">Ajouter une personne</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label for="nom" class="mb-2 block text-lg font-semibold text-ink">
            Son nom — les patients le liront
          </label>
          <input id="nom" bind:value={nom} class={champ} style="min-height: 56px;" autocomplete="off" />
        </div>
        <div>
          <label for="poste" class="mb-2 block text-lg font-semibold text-ink">Son poste</label>
          <input
            id="poste"
            bind:value={poste}
            class={champ}
            style="min-height: 56px;"
            placeholder="Psychiatre, kinésithérapeute, animateur"
          />
        </div>
      </div>

      <label for="motif" class="mt-4 mb-2 block text-lg font-semibold text-ink">
        Motif de rendez-vous correspondant — facultatif
      </label>
      <select id="motif" bind:value={motifId} class={champ} style="min-height: 56px;">
        <option value="">Aucun</option>
        {#each store.appointmentKinds as motif (motif.id)}
          <option value={motif.id}>{motif.icon} {motif.name}</option>
        {/each}
      </select>
      <p class="mt-1 text-base text-ink-soft">
        Sert à proposer cette personne en premier quand on fixe un rendez-vous de ce motif.
      </p>

      {@render ouUnite('nouvelle')}

      <p class="mt-3 text-base text-ink-soft">
        N'inscrivez ni adresse, ni téléphone, ni matricule. Un nom et un poste suffisent
        à s'y retrouver.
      </p>

      <button type="submit" class="btn btn-primary mt-4" disabled={busy || nom.trim().length === 0}>
        {busy ? 'Un instant…' : 'Ajouter'}
      </button>
    </form>
  {/if}

  <!--
    Où cette personne intervient.

    Deux boutons plutôt qu'une case à cocher : « Toutes les unités » est un choix, pas
    l'absence d'un autre — l'animateur sportif passe réellement partout, et l'écrire est
    plus juste que de laisser une liste vide vouloir dire deux choses.
  -->
  {#snippet ouUnite(prefixe: string)}
    <fieldset class="mt-4">
      <legend class="mb-2 block text-lg font-semibold text-ink">Où cette personne intervient</legend>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn"
          class:btn-primary={pourToutes}
          class:btn-secondary={!pourToutes}
          aria-pressed={pourToutes}
          onclick={() => (pourToutes = true)}
        >
          Toutes les unités
        </button>
        <button
          type="button"
          class="btn"
          class:btn-primary={!pourToutes}
          class:btn-secondary={pourToutes}
          aria-pressed={!pourToutes}
          onclick={() => (pourToutes = false)}
        >
          Seulement certaines
        </button>
      </div>

      {#if !pourToutes}
        <div class="mt-3 flex flex-wrap gap-2" id={`unites-${prefixe}`}>
          {#each servicesProposes as service (service.id)}
            <button
              type="button"
              class="btn"
              class:btn-primary={unites.includes(service.id)}
              class:btn-secondary={!unites.includes(service.id)}
              aria-pressed={unites.includes(service.id)}
              onclick={() => basculerUnite(service.id)}
            >
              <span aria-hidden="true">{unites.includes(service.id) ? '✓' : '·'}</span>
              {service.name}
            </button>
          {/each}
        </div>
        {#if unites.length === 0}
          <p class="mt-2 text-base font-semibold text-ink">
            <span aria-hidden="true">⚠️</span>
            Aucune unité choisie : aucun patient ne pourra demander à voir cette personne.
          </p>
        {/if}
      {/if}

      <p class="mt-2 text-base text-ink-soft">
        Un patient ne peut demander à voir que quelqu'un qui passe dans son unité. Cela
        n'empêche aucun soignant de fixer un rendez-vous : c'est ce que l'application
        propose au patient.
      </p>
    </fieldset>
  {/snippet}

  {#snippet plages(personne: Practitioner)}
    {@const resume = availabilityLabel(personne.availability ?? [])}
    <div class="mt-3 rounded-xl border-2 border-line p-4">
      <h4 class="text-lg font-semibold text-ink">Quand cette personne reçoit</h4>
      <p class="mt-1 text-base text-ink-soft">
        {resume === ''
          ? 'Rien n’est indiqué. Personne ne sait donc quand proposer un rendez-vous.'
          : resume}
      </p>

      {#if peutModifierLesPlages(personne.id)}
        {#if plagesOuvertes === personne.id}
          <ul class="mt-3 grid gap-2">
            {#each brouillon as plage, index (index)}
              <li class="flex flex-wrap items-end gap-2">
                <div>
                  <label for={`jour-${index}`} class="mb-1 block text-base font-semibold text-ink">
                    Le jour
                  </label>
                  <select
                    id={`jour-${index}`}
                    class={champ}
                    style="min-height: 56px; width: auto;"
                    value={String(plage.weekday)}
                    onchange={(event) =>
                      (brouillon[index]!.weekday = Number(event.currentTarget.value) as IsoWeekday)}
                  >
                    {#each JOURS as jour (jour)}
                      <option value={String(jour)}>{weekdayName(jour)}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label for={`de-${index}`} class="mb-1 block text-base font-semibold text-ink">De</label>
                  <input
                    id={`de-${index}`}
                    type="time"
                    bind:value={brouillon[index]!.from}
                    class={champ}
                    style="min-height: 56px; width: auto;"
                  />
                </div>
                <div>
                  <label for={`a-${index}`} class="mb-1 block text-base font-semibold text-ink">À</label>
                  <input
                    id={`a-${index}`}
                    type="time"
                    bind:value={brouillon[index]!.to}
                    class={champ}
                    style="min-height: 56px; width: auto;"
                  />
                </div>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={() => (brouillon = brouillon.filter((_, i) => i !== index))}
                >
                  Retirer cette plage
                </button>
              </li>
            {/each}
          </ul>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => (brouillon = [...brouillon, { weekday: 2, from: '09:00', to: '12:00' }])}
            >
              <span aria-hidden="true">＋</span> Ajouter une plage
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              onclick={() => enregistrerLesPlages(personne.id)}
            >
              {busy ? 'Un instant…' : 'Enregistrer'}
            </button>
            <button type="button" class="btn btn-secondary" onclick={() => (plagesOuvertes = null)}>
              Annuler
            </button>
          </div>
          <p class="mt-2 text-base text-ink-soft">
            Une semaine type. Cela n'interdit rien : un rendez-vous peut toujours être fixé
            en dehors, l'application prévient simplement.
          </p>
        {:else}
          <button
            type="button"
            class="btn btn-secondary mt-3"
            onclick={() => ouvrirLesPlages(personne)}
          >
            {resume === '' ? 'Indiquer ses disponibilités' : 'Modifier ses disponibilités'}
          </button>
        {/if}

        <!--
          L'acceptation automatique tient dans la même boîte que les plages : c'est la
          même question posée deux fois — quand cette personne reçoit, et si l'on peut
          retenir une place sans la déranger. Sans plage déclarée, elle ne servirait à
          rien, et l'écran ne la propose pas.
        -->
        {#if resume !== ''}
          <label class="bascule mt-3">
            <input
              type="checkbox"
              checked={personne.autoAccept === true}
              disabled={busy}
              onchange={(event) => basculerAutoAccept(personne.id, event.currentTarget.checked)}
            />
            <span>
              <strong>Accepter automatiquement les demandes de rendez-vous.</strong>
              La première place libre dans ces plages est retenue dès la demande, et le
              patient sait tout de suite quand il vient. Sinon, la demande attend une
              réponse.
            </span>
          </label>
        {/if}
      {/if}
    </div>
  {/snippet}

  <!--
    Les congés d'une personne : une exception datée posée par-dessus ses plages.

    Le geste est courant — on s'absente une semaine — mais il n'est pas anodin : des
    rendez-vous sont peut-être déjà fixés sur ces jours-là. L'écran les nomme avant de
    rien changer, et c'est un humain qui tranche en les lisant.
  -->
  {#snippet conges(personne: Practitioner)}
    {@const siens = staffStore.leavesOf(personne.id)}
    <div class="mt-3 rounded-xl border-2 border-line p-4">
      <h4 class="text-lg font-semibold text-ink">Congés</h4>

      {#if siens.length === 0}
        <p class="mt-1 text-base text-ink-soft">Aucun congé déclaré.</p>
      {:else}
        <ul class="mt-2 grid gap-2">
          {#each siens as conge (conge.from + conge.to)}
            <li class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-base text-ink">
                <span aria-hidden="true">🌴</span>
                {#if conge.from === conge.to}
                  Le {enPhrase(conge.from)}
                {:else}
                  Du {enPhrase(conge.from)} au {enPhrase(conge.to)} ({daysCovered(conge)} jours)
                {/if}
              </span>
              {#if peutModifierLesPlages(personne.id)}
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={busy}
                  onclick={() => retirerLeConge(personne.id, conge)}
                >
                  Retirer
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if peutModifierLesPlages(personne.id)}
        {#if congesOuverts === personne.id}
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div class="min-w-0">
              <label for={`conge-du-${personne.id}`} class="mb-2 block text-lg font-semibold text-ink">
                Premier jour
              </label>
              <input
                id={`conge-du-${personne.id}`}
                type="date"
                bind:value={congeDu}
                class={champ}
                style="min-height: 56px;"
              />
            </div>
            <div class="min-w-0">
              <label for={`conge-au-${personne.id}`} class="mb-2 block text-lg font-semibold text-ink">
                Dernier jour
              </label>
              <input
                id={`conge-au-${personne.id}`}
                type="date"
                bind:value={congeAu}
                class={champ}
                style="min-height: 56px;"
              />
            </div>
          </div>

          {#if congeErreur !== null}
            <p role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-lg font-semibold text-red-900">
              <span aria-hidden="true">⚠️</span> {congeErreur}
            </p>
          {/if}

          <!--
            L'avertissement, quand des rendez-vous sont déjà fixés.

            Il les nomme un par un : « trois rendez-vous » ne dit rien, « Camille mardi à
            10 h » se pèse. Et il dit ce qui va leur arriver — retourner dans la file, non
            disparaître — avant qu'on appuie, jamais après.
          -->
          {#if datesOntChange}
            <!--
              Les dates ont bougé depuis le dernier examen : l'encadré ne décrirait plus
              ce qu'on validerait. On le retire et l'on redemande, plutôt que de laisser
              lire une liste devenue fausse.
            -->
            <p role="status" class="mt-3 rounded-xl border-2 border-line bg-surface-soft p-4 text-lg text-ink">
              <span aria-hidden="true">🔄</span>
              Les dates ont changé. Appuyez de nouveau sur « Enregistrer ce congé » pour
              voir ce que ce congé touche.
            </p>
          {/if}

          {#if confirmationAJour && aConfirmer !== null}
            <div role="status" class="mt-3 rounded-xl border-2 border-amber-500 bg-amber-50 p-4">
              <p class="text-lg font-bold text-ink">
                <span aria-hidden="true">⚠️</span> {aConfirmer.message}
              </p>

              <!--
                Les séances animées : nommées, datées, avec le nombre d'inscrits.

                C'est ce nombre qui fait hésiter — annuler un atelier vide et annuler un
                atelier où onze personnes sont inscrites ne sont pas le même geste.
              -->
              {#if (aConfirmer.sessions ?? []).length > 0}
                <h5 class="mt-3 text-base font-bold text-ink">Séances que vous animez</h5>
                <ul class="mt-1 grid gap-1">
                  {#each aConfirmer.sessions ?? [] as seance (seance.occurrenceId)}
                    <li class="text-base text-ink">
                      <span aria-hidden="true">📅</span>
                      {seance.title} — {enPhrase(seance.localDate)}{#if seance.start !== undefined && seance.end !== undefined}, de {formatTime(new Date(seance.start))} à {formatTime(new Date(seance.end))}{/if}
                      {#if seance.confirmedCount > 0}
                        · <strong>{seance.confirmedCount} inscrit{seance.confirmedCount > 1 ? 's' : ''}</strong>
                      {:else}
                        · personne d'inscrit
                      {/if}
                    </li>
                  {/each}
                </ul>

                <label class="mt-3 flex items-start gap-3" style="min-height: 56px;">
                  <input type="checkbox" class="mt-1 h-6 w-6" bind:checked={annulerLesSeances} />
                  <span>
                    <span class="block text-lg font-semibold text-ink">
                      Annuler aussi ces séances
                    </span>
                    <span class="block text-base text-ink-soft">
                      {#if annulerLesSeances}
                        Elles seront barrées au programme, avec le motif
                        « L'animateur est absent ». Les personnes inscrites le liront.
                      {:else}
                        Elles resteront au programme. Ne décochez que si quelqu'un d'autre
                        les assure : l'application n'a aucun moyen de le savoir.
                      {/if}
                    </span>
                  </span>
                </label>
              {/if}

              <!--
                Les rendez-vous, eux, ne sont pas un choix : une date qui ne peut plus
                tenir ne tient plus. Ils retournent dans la file plutôt que d'être
                annulés — le patient a demandé à voir quelqu'un, et cette demande tient
                toujours ; c'est la date qui saute.
              -->
              {#if (aConfirmer.conflicts ?? []).length > 0}
                <h5 class="mt-3 text-base font-bold text-ink">Rendez-vous fixés</h5>
                <ul class="mt-1 grid gap-1">
                  {#each aConfirmer.conflicts ?? [] as conflit (conflit.appointmentId)}
                    <li class="text-base text-ink">
                      <span aria-hidden="true">🩺</span>
                      {conflit.firstName} — {enPhrase(conflit.localDate)}{#if conflit.start !== undefined && conflit.end !== undefined}, de {formatTime(new Date(conflit.start))} à {formatTime(new Date(conflit.end))}{/if}
                    </li>
                  {/each}
                </ul>
                <p class="mt-2 text-base text-ink">
                  {#if (aConfirmer.conflicts ?? []).length === 1}
                    Ce rendez-vous retourne dans la file des demandes et devra être refixé.
                    La personne concernée le lira dans son application.
                  {:else}
                    Ces rendez-vous retournent dans la file des demandes et devront être
                    refixés. Les personnes concernées le liront dans leur application.
                  {/if}
                </p>
              {/if}

              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy}
                  onclick={() => declarerLeConge(personne.id, true)}
                >
                  {busy ? 'Un instant…' : 'Déclarer le congé'}
                </button>
                <button type="button" class="btn btn-secondary" onclick={fermerLesConges}>
                  Ne rien changer
                </button>
              </div>
            </div>
          {:else}
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-primary"
                disabled={busy}
                onclick={() => declarerLeConge(personne.id)}
              >
                {busy ? 'Un instant…' : 'Enregistrer ce congé'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={fermerLesConges}>Annuler</button>
            </div>
          {/if}

          <p class="mt-2 text-base text-ink-soft">
            Pendant ces jours, aucun rendez-vous ne sera proposé — ni par l'agenda, ni
            automatiquement. Le motif du congé n'est pas demandé.
          </p>
        {:else}
          <button
            type="button"
            class="btn btn-secondary mt-3"
            onclick={() => ouvrirLesConges(personne.id)}
          >
            Déclarer un congé
          </button>
        {/if}
      {/if}
    </div>
  {/snippet}

  {#snippet fiche(id: string)}
    {@const personne = store.practitionerOf(id)}
    {#if personne !== null}
      <li class="card p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 class="text-xl font-bold text-ink">{personne.name}</h3>
            <p class="text-base text-ink-soft">{personne.role}</p>
          </div>
        </div>

        {#if personne.isActive}{@render plages(personne)}{@render conges(personne)}{/if}

        <div class="mt-3 flex flex-wrap gap-2">
          {#if canSeePractitionerPlanning(moi, personne.id)}
            <!--
              Le planning de quelqu'un nomme les patients qu'il reçoit : chacun ouvre le
              sien, l'administrateur ouvre ceux de tous. Proposer le bouton aux autres
              reviendrait à annoncer une porte que le serveur referme.
            -->
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => navigate(`/soignant/intervenant/${personne.id}`)}
            >
              {staffStore.identity.practitionerId === personne.id ? 'Voir mon planning' : 'Voir son planning'}
            </button>
          {/if}
          {#if staffStore.isAdmin}
            {#if personne.isActive}
              <button type="button" class="btn btn-secondary" onclick={() => ouvrirEdition(personne.id)}>
                Modifier
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                onclick={() => { accesPour = personne.id; adresse = ''; motDePasse = null }}
              >
                {compteDe(personne.id) === undefined ? 'Lui donner un accès' : 'Refaire un accès'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={() => (aRetirer = personne.id)}>
                Retirer
              </button>
            {:else}
              <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => remettre(personne.id)}>
                Remettre
              </button>
            {/if}
          {/if}
        </div>

        {#if staffStore.isAdmin && compteDe(personne.id) !== undefined}
          {@const compte = compteDe(personne.id)!}
          <!--
            Le rôle vit dans le jeton, pas dans un document : le changer déconnecte la
            personne, qui devra se reconnecter. On le dit, plutôt que de la laisser
            constater que « rien n'a changé ».
          -->
          <label class="bascule mt-3">
            <input
              type="checkbox"
              checked={compte.role === 'admin'}
              disabled={busy || compte.uid === staffStore.identity.uid}
              onchange={(event) => basculerAdministrateur(compte, event.currentTarget.checked)}
            />
            <span>
              <strong>Administrateur.</strong>
              {#if compte.uid === staffStore.identity.uid}
                C'est votre compte : vous ne pouvez pas retirer vos propres droits.
              {:else}
                Voit tous les plannings et tous les rendez-vous, gère les patients, le
                personnel et le catalogue. La personne devra se reconnecter pour que le
                changement s'applique.
              {/if}
            </span>
          </label>
        {/if}

        {#if aRetirer === personne.id}
          <div class="mt-3 rounded-xl border-2 border-line p-4">
            <p class="text-lg text-ink">
              Retirer {personne.name} ? Si des activités ou des rendez-vous la nomment, elle
              cessera seulement d'être proposée : rien ne sera effacé.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn btn-primary" disabled={busy} onclick={() => retirer(personne.id)}>
                {busy ? 'Un instant…' : 'Oui, retirer'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={() => (aRetirer = null)}>Annuler</button>
            </div>
          </div>
        {/if}

        {#if accesPour === personne.id}
          <form
            class="mt-3 rounded-xl border-2 border-line p-4"
            onsubmit={(event) => {
              event.preventDefault()
              void donnerAcces(personne.id)
            }}
          >
            <label for={`acces-${personne.id}`} class="mb-2 block text-lg font-semibold text-ink">
              Son adresse électronique
            </label>
            <input
              id={`acces-${personne.id}`}
              type="email"
              autocomplete="off"
              bind:value={adresse}
              class={champ}
              style="min-height: 56px;"
            />
            <p class="mt-2 text-base text-ink-soft">
              Si un compte existe déjà avec cette adresse, il est simplement relié à
              {personne.name} — son mot de passe ne change pas.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="submit" class="btn btn-primary" disabled={busy || adresse.trim().length === 0}>
                {busy ? 'Un instant…' : "Créer l'accès"}
              </button>
              <button type="button" class="btn btn-secondary" onclick={() => (accesPour = null)}>Annuler</button>
            </div>
          </form>
        {/if}

        {#if edition === personne.id}
          <form
            class="mt-3 rounded-xl border-2 border-line p-4"
            onsubmit={(event) => {
              event.preventDefault()
              void enregistrer()
            }}
          >
            <label for={`nom-${personne.id}`} class="mb-2 block text-lg font-semibold text-ink">Son nom</label>
            <input id={`nom-${personne.id}`} bind:value={nom} class={champ} style="min-height: 56px;" />

            <label for={`poste-${personne.id}`} class="mt-4 mb-2 block text-lg font-semibold text-ink">
              Son poste
            </label>
            <input id={`poste-${personne.id}`} bind:value={poste} class={champ} style="min-height: 56px;" />

            <label for={`motif-${personne.id}`} class="mt-4 mb-2 block text-lg font-semibold text-ink">
              Motif de rendez-vous correspondant — facultatif
            </label>
            <select id={`motif-${personne.id}`} bind:value={motifId} class={champ} style="min-height: 56px;">
              <option value="">Aucun</option>
              {#each store.appointmentKinds as motif (motif.id)}
                <option value={motif.id}>{motif.icon} {motif.name}</option>
              {/each}
            </select>

            {@render ouUnite(personne.id)}

            <div class="mt-3 flex flex-wrap gap-2">
              <button type="submit" class="btn btn-primary" disabled={busy || nom.trim().length === 0}>
                {busy ? 'Un instant…' : 'Enregistrer'}
              </button>
              <button type="button" class="btn btn-secondary" onclick={fermer}>Annuler</button>
            </div>
            <p class="mt-2 text-base text-ink-soft">
              Identifiant : {personne.id} — il ne change pas.
            </p>
          </form>
        {/if}
      </li>
    {/if}
  {/snippet}

  {#if enPoste.length === 0}
    <p class="card p-5 text-lg text-ink-soft">
      Personne n'est encore enregistré. Ajoutez-en une ci-dessus : elle sera proposée
      dans les activités et les rendez-vous.
    </p>
  {:else}
    <ul class="grid gap-3">
      {#each enPoste as personne (personne.id)}{@render fiche(personne.id)}{/each}
    </ul>
  {/if}

  {#if retires.length > 0}
    <details class="mt-6">
      <summary
        class="flex cursor-pointer items-center rounded-xl border-2 border-line bg-white px-4 text-lg font-semibold text-ink"
        style="min-height: 56px;"
      >
        Les personnes retirées ({retires.length})
      </summary>
      <p class="mt-3 text-base text-ink-soft">
        Elles ne sont plus proposées, mais restent nommées sur les activités et les
        rendez-vous passés : leur retirer leur nom réécrirait l'histoire.
      </p>
      <ul class="mt-3 grid gap-3">
        {#each retires as personne (personne.id)}{@render fiche(personne.id)}{/each}
      </ul>
    </details>
  {/if}
</section>

<style>
  /* Toute la ligne est cliquable, la case est grande, et le focus clavier se voit. */
  .bascule {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    min-height: 56px;
    padding: 0.9rem 1rem;
    border: 2px solid var(--color-line);
    border-radius: 0.85rem;
    background: var(--color-surface);
    font-size: 1.0625rem;
    line-height: 1.45;
    color: var(--color-ink);
    cursor: pointer;
  }
  .bascule:hover {
    background: var(--color-surface-soft);
  }
  .bascule:focus-within {
    outline: 3px solid var(--color-brand-500);
    outline-offset: 2px;
  }
  .bascule input {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    margin-top: 0.15rem;
    accent-color: var(--color-brand-900);
  }
</style>
