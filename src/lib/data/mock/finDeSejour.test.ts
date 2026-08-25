import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world } from './state'
import { groupByService } from '../../domain/patientList'
import { todayLocalDate, weekDays } from '../../domain/time'

/**
 * Ce que « Fin de séjour » doit vraiment faire.
 *
 * Le geste ne faisait qu'expirer le code. La personne disparaissait des listes, mais son
 * inscription de jeudi tenait toujours un siège sur douze : la liste d'attente n'avançait
 * pas, la séance affichait « complet » pour quelqu'un qui n'était plus là, et plus aucun
 * écran ne permettait de l'en retirer — elle avait quitté les listes où l'on désinscrit.
 *
 * Sa feuille de semaine continuait par ailleurs de s'imprimer dans « Les plannings »,
 * pendant que « Les patients » ne la connaissait plus : deux écrans qui se contredisent.
 */
describe('la fin d’un séjour', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
  })

  const admin = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  /** Quelqu'un qui a au moins une inscription confirmée sur une séance à venir. */
  const inscritAVenir = () => {
    const maintenant = Date.now()
    for (const inscription of world.registrations) {
      if (inscription.status !== 'confirmed') continue
      const seance = world.occurrences.get(inscription.occurrenceId)
      if (seance === undefined || seance.start.getTime() < maintenant) continue
      const patient = world.patients.find((p) => p.uid === inscription.patientUid)
      if (patient !== undefined) return { patient, inscription }
    }
    return null
  }

  it('rend les places retenues sur les séances à venir', async () => {
    const cible = inscritAVenir()
    expect(cible).not.toBeNull()
    const app = await admin()

    const avant = world.occurrences.get(cible!.inscription.occurrenceId)!.confirmedCount
    await app.repository.endStay(cible!.patient.uid)

    const apres = world.occurrences.get(cible!.inscription.occurrenceId)!.confirmedCount
    // Soit la place est rendue, soit elle est reprise par le premier de la liste d'attente.
    expect(apres).toBeLessThanOrEqual(avant)
    const encore = world.registrations.find(
      (r) =>
        r.patientUid === cible!.patient.uid &&
        r.occurrenceId === cible!.inscription.occurrenceId &&
        r.status !== 'cancelled',
    )
    expect(encore).toBeUndefined()
  })

  it('ne touche pas au passé : une feuille d’appel déjà remplie ne se réécrit pas', async () => {
    const maintenant = Date.now()
    const passee = world.registrations.find((inscription) => {
      const seance = world.occurrences.get(inscription.occurrenceId)
      return (
        inscription.status === 'confirmed' && seance !== undefined && seance.end.getTime() < maintenant
      )
    })
    if (passee === undefined) return

    const app = await admin()
    await app.repository.endStay(passee.patientUid)

    const apres = world.registrations.find(
      (r) => r.patientUid === passee.patientUid && r.occurrenceId === passee.occurrenceId,
    )
    expect(apres?.status).toBe('confirmed')
  })

  it('n’imprime plus la feuille de la personne dans « Les plannings »', async () => {
    const app = await admin()
    const qui = world.patients[0]!
    const jours = weekDays(todayLocalDate())

    const avant = await app.repository.weekPlannings(jours[0]!, jours[6]!)
    expect(avant.some((p) => p.patientUid === qui.uid)).toBe(true)

    await app.repository.endStay(qui.uid)

    const apres = await app.repository.weekPlannings(jours[0]!, jours[6]!)
    expect(apres.some((p) => p.patientUid === qui.uid)).toBe(false)
    // Et les deux écrans disent la même chose.
    const listes = await app.repository.listPatients()
    expect(listes.some((p) => p.uid === qui.uid)).toBe(false)
  })

  it('dit de qui il s’agit, et combien de places sont rendues', async () => {
    const cible = inscritAVenir()
    expect(cible).not.toBeNull()
    const app = await admin()
    const resultat = await app.repository.endStay(cible!.patient.uid)
    expect(resultat.ok).toBe(true)
    expect(resultat.message).toMatch(/place(s)? retenue(s)? (a|ont) été rendue(s)?/)
  })
})

describe('un service retiré du catalogue', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
  })

  it('garde ses personnes dans « Les patients », comme le catalogue le promet', async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    const patients = await app.repository.listPatients()
    const qui = patients[0]!

    await app.catalogAdmin.removeEntry('service', qui.serviceId)

    const groupes = groupByService(patients, mockCatalog.services())
    const groupe = groupes.find((g) => g.serviceId === qui.serviceId)
    expect(groupe?.patients.some((p) => p.uid === qui.uid)).toBe(true)
    // L'écran le dit, plutôt que de faire disparaître la personne en silence.
    expect(groupe?.retired).toBe(true)
  })
})
