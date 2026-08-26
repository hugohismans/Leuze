import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { todayLocalDate } from '../../domain/time'

/**
 * Venir regarder, joué de bout en bout sur la démonstration.
 *
 * Ce fichier garde les deux promesses faites à l'hôpital, et il les garde **par le même
 * chemin que le vrai serveur** — la décision, les phrases et les compteurs viennent tous
 * du domaine, que les deux adapters partagent.
 *
 * 1. Un spectateur ne prend la place de personne. Une séance complète lui reste ouverte,
 *    et le nombre de spectateurs n'est pas limité.
 * 2. Un spectateur est quelque part. Il ne peut donc pas regarder deux activités à la
 *    même heure, ni regarder quoi que ce soit pendant un rendez-vous avec un
 *    professionnel — que lui-même ne peut pas décommander.
 */

const ouvrirSoignant = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test', 'peu-importe')
  return app
}

/**
 * Le terrain, dégagé de ce que la démonstration a semé.
 *
 * Le monde de démonstration pré-remplit des inscriptions d'ambiance, et lesquelles dépend
 * du jour où l'on lance les tests : « la prochaine séance à venir » n'est pas la même un
 * lundi matin et un vendredi soir. Tant qu'un chevauchement d'activités n'arrêtait
 * personne, cela ne se voyait pas. Depuis qu'il arrête aussi le soignant, ces
 * inscriptions d'ambiance faisaient échouer les scénarios une fois sur deux — selon
 * l'heure, ce qui est la pire sorte de test.
 *
 * On efface donc tout : chaque test ne parle plus que de ce qu'il pose lui-même.
 */
function terrainDegage(): void {
  world.registrations = []
  world.appointments = []
  for (const [id, occurrence] of world.occurrences) {
    world.occurrences.set(id, { ...occurrence, confirmedCount: 0, waitlistCount: 0, spectatorCount: 0 })
  }
}

/** Une séance à venir, ouverte à tout le monde. */
function seanceAVenir() {
  const aujourdHui = todayLocalDate()
  return [...world.occurrences.values()]
    .filter((o) => o.localDate > aujourdHui && o.status !== 'cancelled')
    .filter((o) => o.audienceKeys.includes('all'))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]!
}

/** Une seconde séance qui recouvre exactement la première. */
function seanceQuiRecouvre(seance: ReturnType<typeof seanceAVenir>) {
  const copie = {
    ...seance,
    id: `${seance.id}-bis`,
    title: 'Séance qui recouvre',
    confirmedCount: 0,
    waitlistCount: 0,
    spectatorCount: 0,
  }
  world.occurrences.set(copie.id, copie)
  return copie
}

/**
 * Rend la séance complète et ferme la liste d'attente.
 *
 * On ne force pas le compteur : la démonstration part avec des inscriptions déjà en
 * place, et le compteur se recalcule à chaque geste. On fixe donc la capacité **au
 * nombre de personnes réellement inscrites** — c'est ce qui rend la séance complète pour
 * de bon, quel que soit le jeu de départ.
 */
function rendreComplete(occurrenceId: string): void {
  const occurrence = world.occurrences.get(occurrenceId)!
  const inscrits = world.registrations.filter(
    (r) => r.occurrenceId === occurrenceId && r.status === 'confirmed',
  ).length
  if (inscrits === 0) {
    world.registrations = [
      ...world.registrations,
      {
        id: 'occupee',
        occurrenceId,
        patientUid: 'quelquun-dautre',
        status: 'confirmed',
        createdAt: new Date(),
        queuedAt: new Date(),
        createdBy: 'staff',
      },
    ]
  }
  /*
    Le compteur suit, sinon la séance n'est complète qu'à moitié.

    `capacityOf` lit `confirmedCount` sur la séance, pas les inscriptions : laisser le
    compteur à zéro pendant qu'une place est prise faisait dire « il reste une place » à
    une séance pleine, et l'inscription passait. Ce qu'on pose ici doit être cohérent
    avec ce que le domaine lira.
  */
  const pris = Math.max(inscrits, 1)
  world.occurrences.set(occurrenceId, {
    ...occurrence,
    capacity: pris,
    confirmedCount: pris,
    waitlistEnabled: false,
  })
}

describe('venir regarder', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  it('est possible là où l’inscription est refusée faute de place', async () => {
    const seance = seanceAVenir()
    rendreComplete(seance.id)
    const patient = createMockRepository()

    const refus = await patient.registrations.register(seance.id)
    expect(refus.ok).toBe(false)
    const inscritsAvant = world.occurrences.get(seance.id)!.confirmedCount

    const regard = await patient.registrations.register(seance.id, { as: 'spectator' })
    expect(regard.ok).toBe(true)
    expect(regard.ok === true && regard.status).toBe('spectator')
    // Aucune place prise à personne : le nombre d'inscrits n'a pas bougé d'un.
    expect(world.occurrences.get(seance.id)!.confirmedCount).toBe(inscritsAvant)
    expect(world.occurrences.get(seance.id)!.spectatorCount).toBe(1)
  })

  it('apparaît dans « Mes inscriptions », dit comme tel', async () => {
    const seance = seanceAVenir()
    const patient = createMockRepository()
    await patient.registrations.register(seance.id, { as: 'spectator' })

    const miennes = await patient.registrations.listMine()
    expect(miennes.map((m) => m.occurrence.id)).toContain(seance.id)
    expect(miennes.find((m) => m.occurrence.id === seance.id)!.status).toBe('spectator')
  })

  it('se retire avec des mots qui ne parlent pas d’inscription', async () => {
    const seance = seanceAVenir()
    const patient = createMockRepository()
    await patient.registrations.register(seance.id, { as: 'spectator' })

    const sortie = await patient.registrations.unregister(seance.id)
    expect(sortie.ok).toBe(true)
    // « Vous n'êtes plus inscrit » serait faux : la personne ne s'était pas inscrite.
    expect(sortie.message).not.toContain('inscrit')
    expect(world.occurrences.get(seance.id)!.spectatorCount).toBe(0)
  })
})

describe('un spectateur est quelque part', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  it('ne peut pas regarder deux activités à la même heure', async () => {
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)
    const patient = createMockRepository()

    await patient.registrations.register(seance.id, { as: 'spectator' })
    const resultat = await patient.registrations.register(chevauchante.id, { as: 'spectator' })

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.reason).toBe('conflict')
    // Et la phrase dit ce que la personne avait fait : regarder, pas s'inscrire.
    expect(resultat.ok === false && resultat.message).toContain('venez déjà regarder')
    expect(world.occurrences.get(chevauchante.id)!.spectatorCount).toBe(0)
  })

  it('ne peut pas regarder pendant un rendez-vous, et rien ne lui est proposé', async () => {
    const seance = seanceAVenir()
    world.appointments = [
      ...world.appointments,
      {
        id: 'rdv-spectateur',
        patientUid: DEMO_PATIENT_UID,
        kindId: 'psychiatre',
        preference: 'peu-importe',
        status: 'scheduled',
        createdAt: new Date(),
        localDate: seance.localDate,
        start: seance.start,
        end: seance.end,
        withWhom: 'Docteur Lemaire',
        practitionerId: 'docteur-lemaire',
      },
    ]

    const patient = createMockRepository()
    const resultat = await patient.registrations.register(seance.id, { as: 'spectator' })

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.message).toContain('Docteur Lemaire')
    // Aucun échange proposé : un patient ne décommande pas un rendez-vous tout seul.
    expect(resultat.ok === false && resultat.mustLeave).toBeUndefined()
  })

  it('empêche aussi de s’inscrire ailleurs à la même heure', async () => {
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)
    const patient = createMockRepository()

    await patient.registrations.register(seance.id, { as: 'spectator' })
    const resultat = await patient.registrations.register(chevauchante.id)

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.mustLeave).toEqual([seance.id])
  })

  it('s’échange comme le reste, quand la personne l’a demandé', async () => {
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)
    const patient = createMockRepository()

    await patient.registrations.register(seance.id, { as: 'spectator' })
    const resultat = await patient.registrations.register(chevauchante.id, { replacing: [seance.id] })

    expect(resultat.ok).toBe(true)
    expect(resultat.ok === true && resultat.left).toEqual([seance.id])
    // La phrase nomme ce qui vient d'être quitté, dans les mots de ce que c'était.
    expect(resultat.ok === true && resultat.swapMessage).toContain('ne venez plus regarder')
  })
})

describe('changer d’avis sur place', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  it('rend sa place sans laisser deux lignes derrière soi', async () => {
    const seance = seanceAVenir()
    const patient = createMockRepository()

    const avant = world.occurrences.get(seance.id)!.confirmedCount
    await patient.registrations.register(seance.id)
    expect(world.occurrences.get(seance.id)!.confirmedCount).toBe(avant + 1)

    const regard = await patient.registrations.register(seance.id, { as: 'spectator' })
    expect(regard.ok).toBe(true)
    // La place est rendue : c'est bien un changement, pas une seconde inscription.
    expect(world.occurrences.get(seance.id)!.confirmedCount).toBe(avant)
    expect(world.occurrences.get(seance.id)!.spectatorCount).toBe(1)

    const actives = world.registrations.filter(
      (r) => r.occurrenceId === seance.id && r.patientUid === DEMO_PATIENT_UID && r.status !== 'cancelled',
    )
    expect(actives).toHaveLength(1)
  })
})

describe('ce que l’animateur voit', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  it('range les spectateurs à part sur la feuille, sans les compter comme inscrits', async () => {
    const seance = seanceAVenir()
    const patient = createMockRepository()
    await patient.registrations.register(seance.id, { as: 'spectator' })

    const app = await ouvrirSoignant()
    const { lines } = await app.repository.roster(seance.id)
    const mienne = lines.find((l) => l.patientUid === DEMO_PATIENT_UID)
    expect(mienne?.status).toBe('spectator')
    // Et il n'est pas compté parmi les inscrits : la feuille dirait sinon un de trop.
    expect(lines.filter((l) => l.patientUid === DEMO_PATIENT_UID && l.status === 'confirmed')).toHaveLength(0)
  })
})

describe('le cycle de la réunion du lundi', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  /** L'état d'un prénom, lu dans le monde de la démonstration. */
  const etatDe = (occurrenceId: string, patientUid: string) =>
    world.registrations.find(
      (r) => r.occurrenceId === occurrenceId && r.patientUid === patientUid && r.status !== 'cancelled',
    )?.status ?? 'rien'

  it('fait le tour en trois appuis : inscrit, spectateur, plus rien', async () => {
    const seance = seanceAVenir()
    const app = await ouvrirSoignant()
    const qui = world.patients[0]!.uid

    await app.repository.registerPatient(seance.id, qui)
    expect(etatDe(seance.id, qui)).toBe('confirmed')

    await app.repository.registerPatient(seance.id, qui, { as: 'spectator' })
    expect(etatDe(seance.id, qui)).toBe('spectator')
    // Une seule ligne à son nom : deux fausseraient tous les compteurs.
    expect(
      world.registrations.filter(
        (r) => r.occurrenceId === seance.id && r.patientUid === qui && r.status !== 'cancelled',
      ),
    ).toHaveLength(1)

    await app.repository.unregisterPatient(seance.id, qui)
    expect(etatDe(seance.id, qui)).toBe('rien')
  })

  it('rend la place au premier de la file au deuxième appui', async () => {
    const seance = seanceAVenir()
    // Une seule place, pour que la file se forme.
    const occurrence = world.occurrences.get(seance.id)!
    world.registrations = world.registrations.filter((r) => r.occurrenceId !== seance.id)
    world.occurrences.set(seance.id, { ...occurrence, capacity: 1, waitlistEnabled: true })

    const app = await ouvrirSoignant()
    const premier = world.patients[0]!.uid
    const second = world.patients[1]!.uid

    await app.repository.registerPatient(seance.id, premier)
    await app.repository.registerPatient(seance.id, second)
    expect(etatDe(seance.id, second)).toBe('waitlist')

    // Le premier « ne fera pas, mais viendra » : sa place doit revenir au second.
    await app.repository.registerPatient(seance.id, premier, { as: 'spectator' })
    expect(etatDe(seance.id, premier)).toBe('spectator')
    expect(etatDe(seance.id, second)).toBe('confirmed')
    expect(world.occurrences.get(seance.id)!.confirmedCount).toBe(1)
    expect(world.occurrences.get(seance.id)!.spectatorCount).toBe(1)
  })

  it('dit au soignant ce qui vient de se passer, dans ses mots', async () => {
    const seance = seanceAVenir()
    const app = await ouvrirSoignant()
    const qui = world.patients[0]!.uid
    const resultat = await app.repository.registerPatient(seance.id, qui, { as: 'spectator' })
    expect(resultat.ok).toBe(true)
    expect(resultat.message).toContain('regarder')
    expect(resultat.message).toContain('sans prendre de place')
  })
})
