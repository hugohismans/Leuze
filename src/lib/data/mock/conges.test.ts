import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { addLocalDays, todayLocalDate } from '../../domain/time'
import { firstBookableDay } from '../../domain/agenda'

/**
 * Déclarer un congé, de bout en bout.
 *
 * Une plage de disponibilité dit « je reçois le mardi », en semaine type ; elle ne sait
 * pas dire « sauf la semaine du 15 ». Sans le congé, l'application proposait des
 * rendez-vous en pleine absence, et c'est le patient qui l'apprenait devant une porte
 * fermée.
 *
 * Trois choses doivent tenir, et la troisième est celle qu'on oublie :
 *   1. plus aucun créneau n'est proposé pendant le congé ;
 *   2. les rendez-vous déjà fixés sont nommés avant que rien ne change ;
 *   3. confirmés, ils **retournent dans la file** au lieu d'être annulés — le patient a
 *      demandé à voir quelqu'un, et cette demande tient toujours.
 */
describe('les congés', () => {
  const demain = firstBookableDay(todayLocalDate())
  const surlendemain = addLocalDays(demain, 1)

  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = []
    world.leaves = {}
    /*
      Le programme de démonstration est vidé.

      Sans cela, ces tests dépendaient du jour de la semaine : « demain » tombait un
      mercredi, jour où le Docteur Lemaire anime un groupe de parole, et la déclaration
      demandait soudain confirmation. Deux tests verts la veille sont devenus rouges à
      minuit sans qu'une ligne de code ait bougé. Un test qui change d'avis avec le
      calendrier ne prouve plus rien.
    */
    world.occurrences.clear()
    // Une personne qui reçoit tous les jours : le congé est alors la seule chose qui
    // puisse fermer une journée.
    mockCatalog.savePractitioner({
      id: 'docteur-lemaire',
      name: 'Docteur Lemaire',
      role: 'Psychiatre',
      kindId: 'psychiatre',
      audience: 'all',
      serviceIds: [],
      availability: [1, 2, 3, 4, 5, 6, 7].map((j) => ({
        weekday: j as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        from: '09:00',
        to: '17:00',
      })),
      isActive: true,
    })
  })

  const admin = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  const planning = async (app: Awaited<ReturnType<typeof admin>>) =>
    app.repository.appointmentPlanning({
      practitionerId: 'docteur-lemaire',
      patientUid: DEMO_PATIENT_UID,
      preference: 'peu-importe',
      durationMin: 30,
    })

  it('ferme les jours déclarés : plus de plage, plus de créneau', async () => {
    const app = await admin()
    const avant = await planning(app)
    expect(avant.suggestion?.localDate).toBe(demain)

    const resultat = await app.repository.declareLeave('docteur-lemaire', {
      from: demain,
      to: demain,
    })
    expect(resultat.ok).toBe(true)

    const apres = await planning(app)
    expect(apres.suggestion?.localDate).toBe(surlendemain)
    const jour = apres.week.find((j) => j.localDate === demain)
    expect(jour?.onLeave).toBe(true)
    expect(jour?.windows).toEqual([])
    expect(jour?.free).toEqual([])
  })

  it('nomme les rendez-vous déjà fixés, sans rien changer', async () => {
    const app = await admin()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: demain,
      time: '10:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })

    const demande = await app.repository.declareLeave('docteur-lemaire', { from: demain, to: demain })
    expect(demande.ok).toBe(false)
    expect(demande.needsConfirmation).toBe(true)
    expect(demande.conflicts).toHaveLength(1)
    expect(demande.conflicts?.[0]?.firstName).toBe('Camille')
    // Rien n'a bougé : ni le congé, ni le rendez-vous.
    expect(world.leaves['docteur-lemaire']).toBeUndefined()
    expect(world.appointments[0]?.status).toBe('scheduled')
  })

  it('confirmé, rouvre les rendez-vous au lieu de les annuler', async () => {
    const app = await admin()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: demain,
      time: '10:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })

    const resultat = await app.repository.declareLeave(
      'docteur-lemaire',
      { from: demain, to: demain },
      { force: true },
    )
    expect(resultat.ok).toBe(true)
    expect(resultat.reopened).toBe(1)

    const rendezVous = world.appointments[0]!
    // Rouvert, pas annulé : la demande de voir cette personne tient toujours.
    expect(rendezVous.status).toBe('requested')
    expect(rendezVous.reopenedForLeave).toBe(true)
    expect(rendezVous.localDate).toBeUndefined()
    expect(rendezVous.start).toBeUndefined()
    // Le nom demeure : c'est lui qui ramène la demande dans la file de la personne.
    expect(rendezVous.practitionerId).toBe('docteur-lemaire')
  })

  it('n’en rouvre aucun en dehors du congé', async () => {
    const app = await admin()
    await app.repository.createAppointment({
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      date: surlendemain,
      time: '10:00',
      durationMin: 30,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
    })
    const resultat = await app.repository.declareLeave('docteur-lemaire', { from: demain, to: demain })
    expect(resultat.ok).toBe(true)
    expect(resultat.reopened).toBe(0)
    expect(world.appointments[0]?.status).toBe('scheduled')
  })

  it('refuse un dernier jour avant le premier, en disant quoi faire', async () => {
    const app = await admin()
    const resultat = await app.repository.declareLeave('docteur-lemaire', {
      from: surlendemain,
      to: demain,
    })
    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain('avant le premier')
  })

  it('se retire, et les jours rouvrent', async () => {
    const app = await admin()
    await app.repository.declareLeave('docteur-lemaire', { from: demain, to: demain })
    await app.repository.removeLeave('docteur-lemaire', { from: demain, to: demain })
    expect((await planning(app)).suggestion?.localDate).toBe(demain)
  })

  it('un intervenant déclare le sien, jamais celui d’un collègue', async () => {
    const app = await admin()
    await app.superAdmin.impersonate('staff-claire')

    // « force » : c'est ce qu'on fait après avoir lu l'avertissement, puisque le
    // programme de démonstration porte des séances sur ces jours-là.
    const sien = await app.repository.declareLeave('claire', { from: demain, to: demain }, { force: true })
    expect(sien.ok).toBe(true)

    const refus = await app.repository.declareLeave('docteur-lemaire', { from: demain, to: demain })
    expect(refus.ok).toBe(false)
    expect(refus.message).toContain('que pour vous-même')
  })

  it("l'acceptation automatique ne retient rien pendant un congé", async () => {
    const app = await admin()
    mockCatalog.savePractitioner({
      id: 'docteur-lemaire',
      name: 'Docteur Lemaire',
      role: 'Psychiatre',
      kindId: 'psychiatre',
      audience: 'all',
      serviceIds: [],
      availability: [1, 2, 3, 4, 5, 6, 7].map((j) => ({
        weekday: j as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        from: '09:00',
        to: '17:00',
      })),
      autoAccept: true,
      isActive: true,
    })
    // Tout l'horizon en congé : il ne doit rester aucune place à retenir.
    await app.repository.declareLeave(
      'docteur-lemaire',
      { from: demain, to: addLocalDays(demain, 30) },
      { force: true },
    )

    const repo = (await import('./index')).createMockRepository()
    const resultat = await repo.appointments.request('psychiatre', 'peu-importe', 'docteur-lemaire')
    expect(resultat.ok).toBe(true)
    expect(resultat.scheduled).toBe(false)
    expect(world.appointments.at(-1)?.status).toBe('requested')
  })
})

/**
 * Un congé posé sur une journée qui ne portait qu'un atelier.
 *
 * Constaté en service : l'avertissement ne se déclenchait que sur les rendez-vous. Une
 * activité seule passait donc sans un mot, et restait au programme sans personne pour
 * l'animer.
 */
describe('un congé qui tombe sur une séance', () => {
  const demain = firstBookableDay(todayLocalDate())

  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = []
    world.leaves = {}
    /*
      Le programme de la démonstration est vidé : il porte déjà des séances de Marc sur
      la période, et l'on veut ici compter exactement celles que le test a posées.
    */
    world.occurrences.clear()
  })

  const admin = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  /** Une séance animée par Marc, demain, avec des inscrits. */
  const poserUneSeance = (inscrits = 3): string => {
    const id = `occ-conge-${demain}`
    world.occurrences.set(id, {
      id,
      activityId: 'gymnastique-douce',
      seriesId: 'gymnastique-douce',
      title: 'Gymnastique douce',
      description: 'Des mouvements lents.',
      categoryId: 'sport',
      locationId: 'salle-de-sport',
      localDate: demain,
      start: new Date(`${demain}T08:00:00.000Z`),
      end: new Date(`${demain}T09:00:00.000Z`),
      facilitatorId: 'marc',
      facilitator: 'Marc',
      audienceKeys: ['all'],
      capacity: 12,
      registrationRequired: true,
      waitlistEnabled: true,
      status: 'scheduled',
      overridden: false,
      confirmedCount: inscrits,
      waitlistCount: 0,
    })
    return id
  }

  it('demande confirmation, même sans aucun rendez-vous', async () => {
    poserUneSeance()
    const app = await admin()
    const resultat = await app.repository.declareLeave('marc', { from: demain, to: demain })

    expect(resultat.ok).toBe(false)
    expect(resultat.needsConfirmation).toBe(true)
    expect(resultat.conflicts ?? []).toHaveLength(0)
    expect(resultat.sessions).toHaveLength(1)
    expect(resultat.sessions?.[0]?.title).toBe('Gymnastique douce')
    // Le nombre d'inscrits est ce qui fait hésiter : il doit remonter.
    expect(resultat.sessions?.[0]?.confirmedCount).toBe(3)
    // Rien n'a bougé tant qu'on n'a pas confirmé.
    expect(world.leaves['marc']).toBeUndefined()
  })

  it('annule les séances quand on le demande, avec un motif lisible', async () => {
    const id = poserUneSeance()
    const app = await admin()
    const resultat = await app.repository.declareLeave(
      'marc',
      { from: demain, to: demain },
      { force: true, cancelSessions: true },
    )
    expect(resultat.ok).toBe(true)
    expect(resultat.cancelledSessions).toBe(1)

    const seance = world.occurrences.get(id)!
    expect(seance.status).toBe('cancelled')
    expect(seance.cancellationReason).toBe("L'animateur est absent")
    // Touchée à la main : une régénération de la série doit l'épargner.
    expect(seance.overridden).toBe(true)
  })

  it('les laisse au programme quand on décoche — un collègue les assure peut-être', async () => {
    const id = poserUneSeance()
    const app = await admin()
    const resultat = await app.repository.declareLeave(
      'marc',
      { from: demain, to: demain },
      { force: true },
    )
    expect(resultat.ok).toBe(true)
    expect(resultat.cancelledSessions).toBe(0)
    expect(world.occurrences.get(id)?.status).toBe('scheduled')
    // Le congé, lui, est bien enregistré : c'était la demande.
    expect(world.leaves['marc']).toHaveLength(1)
  })

  it('ne compte pas une séance déjà annulée', async () => {
    const id = poserUneSeance()
    world.occurrences.set(id, { ...world.occurrences.get(id)!, status: 'cancelled' })
    const app = await admin()
    const resultat = await app.repository.declareLeave('marc', { from: demain, to: demain })
    expect(resultat.ok).toBe(true)
  })

  it('ne touche pas à la séance d’un collègue', async () => {
    const id = poserUneSeance()
    const app = await admin()
    await app.repository.declareLeave(
      'claire',
      { from: demain, to: demain },
      { force: true, cancelSessions: true },
    )
    expect(world.occurrences.get(id)?.status).toBe('scheduled')
  })
})
