import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { instantOf, todayLocalDate, addLocalDays } from '../../domain/time'

/**
 * Le chevauchement d'horaire, joué de bout en bout sur la démonstration.
 *
 * Deux poids : un rendez-vous refuse l'inscription d'un patient qui s'inscrit seul, une
 * autre activité se contente de le prévenir. Le soignant, lui, n'est jamais empêché —
 * mais l'application le lui demande avant, et lui rend la liste de ce qui tombe en même
 * temps pour qu'il puisse en juger.
 */
const ouvrirSoignant = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test', 'peu-importe')
  return app
}

/** Une séance à venir, à laquelle le patient de démonstration a le droit de s'inscrire. */
function seanceAVenir() {
  const aujourdHui = todayLocalDate()
  return [...world.occurrences.values()]
    .filter((o) => o.localDate > aujourdHui && o.status !== 'cancelled')
    .filter((o) => o.audienceKeys.includes('all'))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]!
}

describe('s’inscrire quand on a déjà quelque chose', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = world.appointments.filter((a) => a.patientUid !== DEMO_PATIENT_UID)
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

  it('est accepté, mais annoncé, quand c’est une autre activité', async () => {
    const seance = seanceAVenir()
    // Une seconde séance qui recouvre la première : deux activités, aucun rendez-vous.
    const voisine = [...world.occurrences.values()].find(
      (o) =>
        o.id !== seance.id &&
        o.localDate === seance.localDate &&
        o.start < seance.end &&
        seance.start < o.end &&
        o.audienceKeys.includes('all'),
    )
    if (voisine === undefined) {
      // Le jeu de démonstration ne contient pas toujours deux séances qui se recouvrent :
      // on en fabrique une, plutôt que de laisser le cas non vérifié.
      const copie = { ...seance, id: `${seance.id}-bis`, title: 'Séance qui recouvre' }
      world.occurrences.set(copie.id, copie)
    }
    const chevauchante = voisine ?? world.occurrences.get(`${seance.id}-bis`)!

    const patient = createMockRepository()
    await patient.registrations.register(seance.id)
    const resultat = await patient.registrations.register(chevauchante.id)

    expect(resultat.ok).toBe(true)
    expect(resultat.ok === true && resultat.warning).toContain(seance.title)
    expect(resultat.ok === true && resultat.warning).toContain('Vous pouvez tout de même')
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
    expect(resultat.ok === true && resultat.warning).toBeUndefined()
  })
})

describe('le soignant qui inscrit quelqu’un de déjà pris', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
    world.appointments = world.appointments.filter((a) => a.patientUid !== DEMO_PATIENT_UID)
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

  it('n’est pas arrêté par une autre activité — on ne demande que pour un rendez-vous', async () => {
    /*
      Un programme chargé fait se recouvrir des activités tout le temps. Poser la question
      à chaque prénom, c'était une réunion qui n'avance plus — et l'on finissait par
      cliquer « oui » sans lire. On inscrit ; ce qui se chevauche se voit sur la feuille.
    */
    const app = await ouvrirSoignant()
    const seance = seanceAVenir()
    const copie = { ...seance, id: `${seance.id}-bis`, title: 'Séance qui recouvre' }
    world.occurrences.set(copie.id, copie)

    await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID)
    const seconde = await app.repository.registerPatient(copie.id, DEMO_PATIENT_UID)

    expect(seconde.ok).toBe(true)
    expect(seconde.conflicts).toBeUndefined()
  })
})
