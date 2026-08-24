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

    expect((await app.repository.declareLeave('claire', { from: demain, to: demain })).ok).toBe(true)

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
    await app.repository.declareLeave('docteur-lemaire', {
      from: demain,
      to: addLocalDays(demain, 30),
    })

    const repo = (await import('./index')).createMockRepository()
    const resultat = await repo.appointments.request('psychiatre', 'peu-importe', 'docteur-lemaire')
    expect(resultat.ok).toBe(true)
    expect(resultat.scheduled).toBe(false)
    expect(world.appointments.at(-1)?.status).toBe('requested')
  })
})
