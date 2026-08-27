import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { seanceAVenir, terrainDegage } from './terrain'
import { instantOf, todayLocalDate, addLocalDays } from '../../domain/time'

/**
 * Le chevauchement d'horaire, joué de bout en bout sur la démonstration.
 *
 * **On ne peut pas être à deux endroits à la fois.** Décision de l'hôpital, prise après
 * un essai en service : un patient s'était inscrit à deux activités de quatorze heures.
 *
 * Deux refus, deux issues. Un rendez-vous ferme la porte : un patient ne le décommande
 * pas tout seul, et il n'y a rien à lui proposer. Une activité s'échange : on quitte
 * celle où l'on est pour prendre celle-ci, en un seul geste, et l'application le fait.
 *
 * Le soignant, lui, n'est jamais empêché — mais l'application le lui demande avant, et
 * lui rend la liste de ce qui tombe en même temps pour qu'il puisse en juger.
 */
const ouvrirSoignant = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test', 'peu-importe')
  return app
}

/** Le patient de démonstration est-il inscrit à cette séance ? */
const inscritA = (occurrenceId: string): boolean =>
  world.registrations.some(
    (r) => r.occurrenceId === occurrenceId && r.patientUid === DEMO_PATIENT_UID && r.status !== 'cancelled',
  )

/**
 * Le terrain, dégagé de ce que la démonstration a semé.
 *
 * Le monde de démonstration pré-remplit des inscriptions d'ambiance, et lesquelles dépend
 * du jour où l'on lance les tests : « la prochaine séance à venir » n'est pas la même un
 * lundi matin et un vendredi soir. Tant qu'un chevauchement d'activités n'arrêtait
 * personne, cela ne se voyait pas. Depuis qu'il arrête aussi le soignant, ces
 * inscriptions d'ambiance faisaient échouer les scénarios selon l'heure — la pire sorte
 * de test, celle qui passe chez soi et tombe en intégration.
 *
 * On efface donc tout : chaque test ne parle plus que de ce qu'il pose lui-même.
 */


describe('s’inscrire quand on a déjà quelque chose', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  it('est refusé au patient quand un rendez-vous tombe au même moment', async () => {
    const seance = seanceAVenir()
    // Un rendez-vous posé exactement sur la séance : c'est le cas qui doit bloquer.
    world.appointments = [
      ...world.appointments,
      {
        id: 'rdv-test',
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
    const resultat = await patient.registrations.register(seance.id)

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.reason).toBe('conflict')
    expect(resultat.ok === false && resultat.message).toContain('Docteur Lemaire')
    expect(world.registrations.some((r) => r.occurrenceId === seance.id && r.patientUid === DEMO_PATIENT_UID)).toBe(
      false,
    )
  })

  /** Une seconde séance qui recouvre exactement la première. */
  const seanceQuiRecouvre = (seance: ReturnType<typeof seanceAVenir>) => {
    const copie = {
      ...seance,
      id: `${seance.id}-bis`,
      title: 'Séance qui recouvre',
      confirmedCount: 0,
      waitlistCount: 0,
    }
    world.occurrences.set(copie.id, copie)
    return copie
  }

  it('est refusé quand une autre activité tombe au même moment', async () => {
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)

    const patient = createMockRepository()
    await patient.registrations.register(seance.id)
    const resultat = await patient.registrations.register(chevauchante.id)

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.reason).toBe('conflict')
    expect(resultat.ok === false && resultat.message).toContain(seance.title)
    expect(resultat.ok === false && resultat.message).toContain('pas être aux deux')
    // Et rien n'a bougé : ni la nouvelle, ni l'ancienne.
    expect(inscritA(chevauchante.id)).toBe(false)
    expect(inscritA(seance.id)).toBe(true)
  })

  it('dit ce qu’il faudrait quitter, sans le quitter', async () => {
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)

    const patient = createMockRepository()
    await patient.registrations.register(seance.id)
    const resultat = await patient.registrations.register(chevauchante.id)

    expect(resultat.ok === false && resultat.mustLeave).toEqual([seance.id])
    expect(inscritA(seance.id)).toBe(true)
  })

  it('échange quand la personne l’a demandé : elle quitte l’une et prend l’autre', async () => {
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)

    const patient = createMockRepository()
    await patient.registrations.register(seance.id)
    const resultat = await patient.registrations.register(chevauchante.id, { replacing: [seance.id] })

    expect(resultat.ok).toBe(true)
    expect(resultat.ok === true && resultat.left).toEqual([seance.id])
    expect(resultat.ok === true && resultat.swapMessage).toContain(seance.title)
    // Le remplacement, et non l'ajout : on est dans la nouvelle, plus dans l'ancienne.
    expect(inscritA(chevauchante.id)).toBe(true)
    expect(inscritA(seance.id)).toBe(false)
  })

  it('n’échange rien contre une séance qu’on n’a pas demandé de quitter', async () => {
    /*
      La liste rendue doit correspondre exactement à ce qui gêne. Un client qui en
      nommerait une autre — ou aucune — n'obtient rien, et surtout ne fait sortir
      personne d'une activité à son insu.
    */
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)

    const patient = createMockRepository()
    await patient.registrations.register(seance.id)
    const resultat = await patient.registrations.register(chevauchante.id, {
      replacing: ['une-autre-seance'],
    })

    expect(resultat.ok).toBe(false)
    expect(inscritA(seance.id)).toBe(true)
    expect(inscritA(chevauchante.id)).toBe(false)
  })

  it('ne fait rien perdre quand la nouvelle activité est complète', async () => {
    /*
      L'ordre compte : on prend la nouvelle place avant de quitter l'ancienne. Quitter
      d'abord, ce serait se retrouver sans rien — et voir quelqu'un d'autre prendre la
      place qu'on vient de libérer.
    */
    const seance = seanceAVenir()
    const chevauchante = seanceQuiRecouvre(seance)
    world.occurrences.set(chevauchante.id, {
      ...world.occurrences.get(chevauchante.id)!,
      capacity: 0,
      waitlistEnabled: false,
      registrationRequired: true,
    })

    const patient = createMockRepository()
    await patient.registrations.register(seance.id)
    const resultat = await patient.registrations.register(chevauchante.id, { replacing: [seance.id] })

    expect(resultat.ok).toBe(false)
    // L'essentiel : sa place d'origine est intacte.
    expect(inscritA(seance.id)).toBe(true)
  })

  it('n’empêche rien quand les horaires ne se touchent pas', async () => {
    const seance = seanceAVenir()
    const ailleurs = addLocalDays(seance.localDate, 1)
    world.appointments = [
      ...world.appointments,
      {
        id: 'rdv-autre-jour',
        patientUid: DEMO_PATIENT_UID,
        kindId: 'psychiatre',
        preference: 'peu-importe',
        status: 'scheduled',
        createdAt: new Date(),
        localDate: ailleurs,
        start: instantOf(ailleurs, '09:00'),
        end: instantOf(ailleurs, '09:30'),
        withWhom: 'Docteur Lemaire',
        practitionerId: 'docteur-lemaire',
      },
    ]

    const patient = createMockRepository()
    const resultat = await patient.registrations.register(seance.id)
    expect(resultat.ok).toBe(true)
    expect(resultat.ok === true && resultat.left).toBeUndefined()
  })
})

describe('le soignant qui inscrit quelqu’un de déjà pris', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    terrainDegage()
  })

  it('reçoit d’abord la liste de ce qui tombe en même temps', async () => {
    const app = await ouvrirSoignant()
    const seance = seanceAVenir()
    world.appointments = [
      ...world.appointments,
      {
        id: 'rdv-test',
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

    const refus = await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID)
    expect(refus.ok).toBe(false)
    expect(refus.conflicts?.[0]?.kind).toBe('appointment')
    expect(refus.conflicts?.[0]?.label).toContain('Docteur Lemaire')

    // Puis il tranche : rien ne l'empêche, il connaît la situation.
    const accepte = await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID, {
      overrideConflict: true,
    })
    expect(accepte.ok).toBe(true)
    expect(world.registrations.some((r) => r.occurrenceId === seance.id && r.patientUid === DEMO_PATIENT_UID)).toBe(
      true,
    )
  })

  it('est arrêté par une autre activité aussi, et elle est nommée', async () => {
    /*
      Décision de l'hôpital, revenue sur le choix d'origine.

      On laissait passer deux activités qui se recouvrent : cela se voit sur la feuille, et
      poser la question à chaque prénom faisait traîner la réunion. Mais inscrire quelqu'un
      à deux activités simultanées est une erreur, pas un arrangement — et c'est justement
      en réunion qu'elle se commet, en passant la liste vite, sans avoir la semaine de
      chacun en tête. Le patient qui s'inscrit seul en est empêché depuis longtemps.
    */
    const app = await ouvrirSoignant()
    const seance = seanceAVenir()
    const copie = { ...seance, id: `${seance.id}-bis`, title: 'Séance qui recouvre' }
    world.occurrences.set(copie.id, copie)

    await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID)
    const seconde = await app.repository.registerPatient(copie.id, DEMO_PATIENT_UID)

    expect(seconde.ok).toBe(false)
    expect(seconde.conflicts?.[0]?.label).toBe(seance.title)
    expect(seconde.conflicts?.[0]?.kind).toBe('activity')
    // Rien n'a bougé tant qu'il n'a pas répondu.
    expect(inscritA(copie.id)).toBe(false)
  })

  it('voit une activité d’un autre service que celui du patient de session', async () => {
    /*
      La cloison est celle du patient, pas celle du soignant.

      La démonstration filtrait ces libellés au service du patient connecté, quel que soit
      celui qui demandait. Tant que le soignant ne regardait que les rendez-vous, cela ne
      se voyait pas — un rendez-vous n'a pas d'audience. Le jour où il a fallu lui montrer
      aussi les activités, la démonstration s'est mise à taire ce que le serveur signale.

      C'est exactement ce qu'elle existe pour éprouver : elle doit refuser ce que le
      serveur refuse, et signaler ce qu'il signale.
    */
    const app = await ouvrirSoignant()
    const seance = seanceAVenir()
    const ailleurs = {
      ...seance,
      id: `${seance.id}-ailleurs`,
      title: 'Réservée à un autre service',
      audienceKeys: ['un-autre-service'],
    }
    world.occurrences.set(ailleurs.id, ailleurs)
    // Le patient de session n'est pas de ce service-là : lui, ne doit rien en lire.
    world.session = { ...world.session, serviceId: 'le-mazurel' }

    await app.repository.registerPatient(ailleurs.id, DEMO_PATIENT_UID)
    const seconde = await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID)

    expect(seconde.ok).toBe(false)
    expect(seconde.conflicts?.[0]?.label).toBe('Réservée à un autre service')
  })

  it('mais il tranche, et l’inscription passe', async () => {
    // Il n'est jamais empêché : il connaît la salle, le groupe et la personne.
    const app = await ouvrirSoignant()
    const seance = seanceAVenir()
    const copie = { ...seance, id: `${seance.id}-ter`, title: 'Séance qui recouvre' }
    world.occurrences.set(copie.id, copie)

    await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID)
    const accepte = await app.repository.registerPatient(copie.id, DEMO_PATIENT_UID, {
      overrideConflict: true,
    })
    expect(accepte.ok).toBe(true)
    expect(inscritA(copie.id)).toBe(true)
  })

  it('ne repose pas la question au deuxième appui du cycle', async () => {
    /*
      Le prénom est déjà sur la séance : on ne fait que changer la nature de sa venue.
      Reposer le même écran rouge apprendrait à cliquer sans lire — y compris sur
      l'avertissement qui compte.
    */
    const app = await ouvrirSoignant()
    const seance = seanceAVenir()
    const copie = { ...seance, id: `${seance.id}-quater`, title: 'Séance qui recouvre' }
    world.occurrences.set(copie.id, copie)

    await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID)
    await app.repository.registerPatient(copie.id, DEMO_PATIENT_UID, { overrideConflict: true })

    const spectateur = await app.repository.registerPatient(copie.id, DEMO_PATIENT_UID, {
      as: 'spectator',
    })
    expect(spectateur.ok).toBe(true)
    expect(spectateur.conflicts).toBeUndefined()
  })
})
