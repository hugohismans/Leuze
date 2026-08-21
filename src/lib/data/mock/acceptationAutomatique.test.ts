import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository, createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world, DEMO_PATIENT_UID } from './state'
import { AUTO_DURATION_MIN } from '../../domain/autoAccept'
import { addLocalDays, isoWeekdayOf, todayLocalDate } from '../../domain/time'

/**
 * L'acceptation automatique, jouée de bout en bout sur la démonstration.
 *
 * Ce qui compte ici n'est pas l'algorithme — il est testé à part, dans le domaine — mais
 * le fait que la démonstration se comporte comme le serveur : une demande faite à
 * quelqu'un qui accepte automatiquement ressort **fixée**, avec un jour, une heure et un
 * nom ; une demande faite à quelqu'un d'autre reste dans la file.
 */
const ouvrirSoignant = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test', 'peu-importe')
  return app
}

/** Une plage qui tombe forcément dans les trois semaines à venir : demain, toute la journée. */
function plageDeDemain(): { weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; from: string; to: string } {
  return { weekday: isoWeekdayOf(addLocalDays(todayLocalDate(), 1)), from: '09:00', to: '12:00' }
}

describe('demander un rendez-vous à quelqu’un qui accepte automatiquement', () => {
  beforeEach(() => {
    resetWorld()
    // Le catalogue vit à côté du monde partagé : un réglage laissé par un cas précédent
    // fausserait le suivant.
    mockCatalog.reset()
    // La démonstration donne déjà un rendez-vous à venir à cette personne, et l'on ne
    // demande pas deux fois le même professionnel : on part d'un agenda vide pour elle.
    world.appointments = world.appointments.filter((a) => a.patientUid !== DEMO_PATIENT_UID)
  })

  it('le fixe tout de suite, dans ses plages, et jamais aujourd’hui', async () => {
    const app = await ouvrirSoignant()
    await app.catalogAdmin.saveAvailability('docteur-lemaire', [plageDeDemain()])
    await app.catalogAdmin.setAutoAccept('docteur-lemaire', true)

    const patient = createMockRepository()
    const resultat = await patient.appointments.request('psychiatre', 'matin')

    expect(resultat.ok).toBe(true)
    expect(resultat.scheduled).toBe(true)
    expect(resultat.message).toContain('Docteur Lemaire')

    const fixe = world.appointments.find((a) => a.patientUid === DEMO_PATIENT_UID && a.autoAccepted)
    expect(fixe?.status).toBe('scheduled')
    expect(fixe?.practitionerId).toBe('docteur-lemaire')
    expect(fixe?.withWhom).toBe('Docteur Lemaire')
    expect(fixe?.localDate).toBe(addLocalDays(todayLocalDate(), 1))
    // La durée est celle du domaine, pas un nombre inventé ici.
    expect((fixe!.end!.getTime() - fixe!.start!.getTime()) / 60_000).toBe(AUTO_DURATION_MIN)
  })

  it('ne pose jamais deux rendez-vous à la même heure', async () => {
    const app = await ouvrirSoignant()
    await app.catalogAdmin.saveAvailability('docteur-lemaire', [plageDeDemain()])
    await app.catalogAdmin.setAutoAccept('docteur-lemaire', true)

    const premier = createMockRepository()
    await premier.appointments.request('psychiatre', 'matin')
    // Un deuxième patient demande la même chose : il doit passer après.
    world.appointments = world.appointments.map((a) =>
      a.patientUid === DEMO_PATIENT_UID ? { ...a, patientUid: 'demo-p2' } : a,
    )
    const second = createMockRepository()
    await second.appointments.request('psychiatre', 'matin')

    // La démonstration contient déjà des rendez-vous : on ne regarde que ceux qui
    // viennent d'être posés automatiquement, et l'on vérifie qu'aucun ne se superpose
    // à quoi que ce soit chez cette personne.
    const chezLemaire = world.appointments
      .filter((a) => a.practitionerId === 'docteur-lemaire' && a.status === 'scheduled')
      .map((a) => a.start!.getTime())
    expect(new Set(chezLemaire).size).toBe(chezLemaire.length)
    expect(world.appointments.filter((a) => a.autoAccepted === true)).toHaveLength(2)
  })

  it('laisse la demande dans la file quand la personne n’a pas activé le réglage', async () => {
    const patient = createMockRepository()
    const resultat = await patient.appointments.request('psychiatre', 'matin')

    expect(resultat.ok).toBe(true)
    expect(resultat.scheduled).toBe(false)
    expect(resultat.message).toContain('Un soignant vous dira quand')
    // Le monde de démonstration contient déjà un rendez-vous pour cette personne : c'est
    // la demande qui vient d'être faite que l'on regarde.
    const demande = world.appointments.find(
      (a) => a.patientUid === DEMO_PATIENT_UID && a.kindId === 'psychiatre' && a.status === 'requested',
    )
    expect(demande).toBeDefined()
    expect(world.appointments.some((a) => a.autoAccepted === true)).toBe(false)
  })

  it('laisse la demande dans la file quand aucune plage n’est déclarée', async () => {
    const app = await ouvrirSoignant()
    // « Julien » accepte automatiquement, mais n'a jamais dit quand il reçoit : il n'y a
    // aucune place à retenir, et la demande doit attendre plutôt qu'échouer.
    await app.catalogAdmin.setAutoAccept('julien', true)

    const patient = createMockRepository()
    const resultat = await patient.appointments.request('kinesitherapeute', 'peu-importe')

    expect(resultat.scheduled).toBe(false)
    const demande = world.appointments.find(
      (a) => a.patientUid === DEMO_PATIENT_UID && a.kindId === 'kinesitherapeute',
    )
    expect(demande?.status).toBe('requested')
  })

  it('n’est jamais décidé par un compte qui n’est pas le sien', async () => {
    const app = createMockStaffApp()
    // Sans session ouverte, personne ne règle l'agenda de personne.
    await expect(app.catalogAdmin.setAutoAccept('docteur-lemaire', true)).rejects.toThrow()
    expect(mockCatalog.practitioners().find((p) => p.id === 'docteur-lemaire')?.autoAccept).not.toBe(
      true,
    )
  })
})

describe('demander deux fois la même chose', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
  })

  it('est refusé tant que le rendez-vous précédent n’a pas eu lieu', async () => {
    // La démonstration donne déjà à cette personne un rendez-vous à venir avec le
    // psychiatre : en redemander un prendrait un second créneau pour rien.
    const patient = createMockRepository()
    const resultat = await patient.appointments.request('psychiatre', 'matin')

    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain('déjà un rendez-vous prévu')
    expect(
      world.appointments.filter((a) => a.patientUid === DEMO_PATIENT_UID && a.kindId === 'psychiatre'),
    ).toHaveLength(1)
  })
})
