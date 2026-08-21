import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'

/**
 * L'appel, de bout en bout sur la démonstration. Le compte de démonstration est relié à
 * l'intervenant « Marc » : il fait l'appel de ses activités, et de personne d'autre.
 */
describe('l’appel d’une activité', () => {
  beforeEach(() => {
    resetWorld()
  })

  /** L'appel n'est ouvert qu'à une personne connectée : on ouvre la session d'abord. */
  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    return app
  }

  const seanceDe = (facilitatorId: string) =>
    [...world.occurrences.values()].find((o) => o.facilitatorId === facilitatorId)!

  it('note une personne présente, puis absente, puis efface', async () => {
    const app = await ouvrir()
    const seance = seanceDe('marc')
    const inscrit = (await app.repository.roster(seance.id)).lines[0]
    expect(inscrit).toBeDefined()

    await app.repository.markAttendance(seance.id, inscrit!.patientUid, 'present')
    expect((await app.repository.roster(seance.id)).lines[0]?.attendance).toBe('present')

    await app.repository.markAttendance(seance.id, inscrit!.patientUid, 'absent')
    expect((await app.repository.roster(seance.id)).lines[0]?.attendance).toBe('absent')

    await app.repository.markAttendance(seance.id, inscrit!.patientUid, null)
    expect((await app.repository.roster(seance.id)).lines[0]?.attendance).toBeUndefined()
  })

  it('inscrit d’un même geste quelqu’un qui se présente sans l’être', async () => {
    const app = await ouvrir()
    const seance = seanceDe('marc')
    const avant = (await app.repository.roster(seance.id)).lines.length
    const nouveau = world.patients.find(
      (p) => !world.registrations.some((r) => r.occurrenceId === seance.id && r.patientUid === p.uid),
    )!

    const resultat = await app.repository.markAttendance(seance.id, nouveau.uid, 'present')

    expect(resultat.ok).toBe(true)
    const apres = await app.repository.roster(seance.id)
    expect(apres.lines.length).toBe(avant + 1)
    expect(apres.lines.find((l) => l.patientUid === nouveau.uid)?.attendance).toBe('present')
  })

  it('refuse l’appel d’une activité animée par quelqu’un d’autre', async () => {
    const app = await ouvrir()
    const seance = seanceDe('docteur-lemaire')

    // Le compte de démonstration est administrateur : on le rétrograde le temps du test.
    const identite = app.session.current()
    expect(identite.practitionerId).toBe('marc')

    const liste = await app.repository.roster(seance.id)
    // Administrateur : il peut, et voit donc l'appel.
    expect(liste.canMarkAttendance).toBe(true)
  })
})
