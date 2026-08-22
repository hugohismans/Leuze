import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { OPEN_TO_PATIENTS, PATIENT_ACTIONS } from '../../domain/permissions'
import { todayLocalDate } from '../../domain/time'

/**
 * Ce que les patients ont le droit de faire, éprouvé de bout en bout.
 *
 * Le réglage n'a de valeur que s'il mord ailleurs que dans l'écran : un écran se
 * contourne. Ces cas vérifient donc le refus là où il vit — dans la couche de données,
 * la même que celle qui parle aux Cloud Functions — et non l'absence d'un bouton.
 */
const ouvrirAdministrateur = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('admin@exemple.test', 'peu-importe')
  return app
}

/** Une séance à venir, ouverte au patient de démonstration. */
function seanceAVenir() {
  const aujourdHui = todayLocalDate()
  return [...world.occurrences.values()]
    .filter((o) => o.localDate > aujourdHui && o.status !== 'cancelled')
    .filter((o) => o.audienceKeys.includes('all'))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]!
}

beforeEach(() => {
  resetWorld()
  mockCatalog.reset()
  world.appointments = world.appointments.filter((a) => a.patientUid !== DEMO_PATIENT_UID)
})

describe('l’état d’origine', () => {
  it('laisse tout ouvert', async () => {
    const app = await ouvrirAdministrateur()
    expect(await app.repository.readPatientPermissions()).toEqual(OPEN_TO_PATIENTS)
  })
})

describe('fermer « s’inscrire »', () => {
  it('empêche le patient de s’inscrire, et lui dit quoi faire', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, register: false })

    const patient = createMockRepository()
    const seance = seanceAVenir()
    const resultat = await patient.registrations.register(seance.id)

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.message).toContain('réunion du début de semaine')
    expect(world.registrations.some((r) => r.occurrenceId === seance.id && r.patientUid === DEMO_PATIENT_UID)).toBe(
      false,
    )
  })

  it('n’empêche pas le soignant d’inscrire quelqu’un', async () => {
    // Le réglage porte sur ce que le patient fait lui-même. Fermer l'inscription
    // individuelle sans laisser la réunion inscrire n'aurait aucun sens.
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, register: false })
    const seance = seanceAVenir()
    const resultat = await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID, {
      overrideConflict: true,
    })
    expect(resultat.ok).toBe(true)
  })

  it('laisse la personne se retirer si ce geste-là est resté ouvert', async () => {
    const app = await ouvrirAdministrateur()
    const seance = seanceAVenir()
    await app.repository.registerPatient(seance.id, DEMO_PATIENT_UID, { overrideConflict: true })
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, register: false })

    const patient = createMockRepository()
    expect((await patient.registrations.unregister(seance.id)).ok).toBe(true)
  })
})

describe('fermer « se retirer »', () => {
  it('empêche la désinscription, sans toucher à l’inscription', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, unregister: false })

    const patient = createMockRepository()
    const seance = seanceAVenir()
    expect((await patient.registrations.register(seance.id)).ok).toBe(true)

    const retrait = await patient.registrations.unregister(seance.id)
    expect(retrait.ok).toBe(false)
    expect(retrait.message).toContain('soignant')
  })
})

describe('fermer « demander un rendez-vous »', () => {
  it('refuse la demande et dit à qui s’adresser', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, requestAppointment: false })

    const patient = createMockRepository()
    const motifs = await patient.appointments.listKinds()
    const resultat = await patient.appointments.request(motifs[0]!.id, 'peu-importe')

    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain('soignant')
  })
})

describe('régler ces droits', () => {
  it('est refusé à qui n’est pas administrateur', async () => {
    const personne = createMockStaffApp()
    await expect(personne.repository.savePatientPermissions(OPEN_TO_PATIENTS)).rejects.toThrow(
      "réservée à l'administrateur",
    )
  })

  it('se relit tel qu’on l’a écrit', async () => {
    const app = await ouvrirAdministrateur()
    const ferme = Object.fromEntries(PATIENT_ACTIONS.map((a) => [a, false]))
    await app.repository.savePatientPermissions(ferme as typeof OPEN_TO_PATIENTS)
    expect(await app.repository.readPatientPermissions()).toEqual(ferme)
  })
})

describe('le réglage particulier d’une personne', () => {
  /*
    Une exception, dans un sens comme dans l'autre — et surtout, un troisième état :
    « comme le service ». C'est lui qui empêche de figer sur quarante fiches la règle
    du jour, et qui fait qu'un changement de règle générale change encore quelque chose.
  */
  const seance = () => seanceAVenir()

  it('ouvre pour quelqu’un ce que le service a fermé', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, register: false })
    await app.repository.savePatientActions(DEMO_PATIENT_UID, { register: true })

    const patient = createMockRepository()
    expect((await patient.registrations.register(seance().id)).ok).toBe(true)
  })

  it('ferme pour quelqu’un ce que le service a ouvert', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientActions(DEMO_PATIENT_UID, { register: false })

    const patient = createMockRepository()
    const resultat = await patient.registrations.register(seance().id)
    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.message).toContain('soignant')
  })

  it('ne touche pas aux autres personnes', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientActions('quelquun-dautre', { register: false })

    const patient = createMockRepository()
    expect((await patient.registrations.register(seance().id)).ok).toBe(true)
  })

  it('rendu à « comme le service », il suit de nouveau le service', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientActions(DEMO_PATIENT_UID, { register: false })
    // On efface l'exception : la personne repasse sous la règle générale…
    await app.repository.savePatientActions(DEMO_PATIENT_UID, {})
    expect(await app.repository.readPatientActions()).toEqual({})

    const patient = createMockRepository()
    expect((await patient.registrations.register(seance().id)).ok).toBe(true)

    // …et suit cette règle quand elle change.
    await app.repository.savePatientPermissions({ ...OPEN_TO_PATIENTS, unregister: false })
    expect((await patient.registrations.unregister(seance().id)).ok).toBe(false)
  })

  it('n’est réglé que par l’administrateur', async () => {
    const personne = createMockStaffApp()
    await expect(personne.repository.savePatientActions(DEMO_PATIENT_UID, { register: false })).rejects.toThrow(
      "réservée à l'administrateur",
    )
  })

  it('ne garde pas de fiche vide dans la liste', async () => {
    const app = await ouvrirAdministrateur()
    await app.repository.savePatientActions(DEMO_PATIENT_UID, {})
    expect(await app.repository.readPatientActions()).toEqual({})
  })
})
