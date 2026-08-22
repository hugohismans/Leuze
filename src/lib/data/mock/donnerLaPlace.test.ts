import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, world } from './state'
import { todayLocalDate } from '../../domain/time'

/**
 * Donner sa place à quelqu'un de la liste d'attente, sans attendre qu'elle se libère.
 *
 * La liste n'avance d'elle-même que si quelqu'un se désinscrit **dans l'application**.
 * Un désistement dit de vive voix — « finalement je ne viens pas », à la réunion — ne
 * faisait rien avancer : la place restait vide et la personne suivante attendait sans le
 * savoir. C'est le seul trou que ce geste comble, et il n'en ouvre aucun autre : on ne
 * peut promouvoir que quelqu'un qui est réellement en attente.
 */
const ouvrirSoignant = async () => {
  const app = createMockStaffApp()
  await app.session.signIn('soignant@exemple.test', 'peu-importe')
  return app
}

/** Une séance à venir, dont on ramène la capacité à une seule place. */
function seanceDUnePlace() {
  const aujourdHui = todayLocalDate()
  const seance = [...world.occurrences.values()]
    .filter((o) => o.localDate > aujourdHui && o.status !== 'cancelled')
    .filter((o) => o.audienceKeys.includes('all'))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]!
  const serree = { ...seance, capacity: 1, waitlistEnabled: true, registrationRequired: true }
  world.occurrences.set(serree.id, serree)
  world.registrations = world.registrations.filter((r) => r.occurrenceId !== serree.id)
  return serree
}

describe('donner sa place à quelqu’un de la liste d’attente', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
  })

  it('inscrit la personne en attente sans que personne ne se désinscrive', async () => {
    const app = await ouvrirSoignant()
    const seance = seanceDUnePlace()
    await app.repository.registerPatient(seance.id, 'p_1', { overrideConflict: true })
    await app.repository.registerPatient(seance.id, 'p_2', { overrideConflict: true })

    const avant = await app.repository.roster(seance.id)
    expect(avant.lines.map((l) => [l.patientUid, l.status])).toEqual([
      ['p_1', 'confirmed'],
      ['p_2', 'waitlist'],
    ])

    const resultat = await app.repository.promotePatient(seance.id, 'p_2')
    expect(resultat.ok).toBe(true)

    const apres = await app.repository.roster(seance.id)
    // Les deux sont inscrits : personne n'a été retiré pour faire de la place.
    expect(apres.lines.every((l) => l.status === 'confirmed')).toBe(true)
    expect(apres.lines).toHaveLength(2)
  })

  it('refuse quelqu’un qui est déjà inscrit', async () => {
    const app = await ouvrirSoignant()
    const seance = seanceDUnePlace()
    await app.repository.registerPatient(seance.id, 'p_1', { overrideConflict: true })
    const resultat = await app.repository.promotePatient(seance.id, 'p_1')
    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain("liste d'attente")
  })

  it('refuse quelqu’un qui n’a rien à voir avec la séance', async () => {
    const app = await ouvrirSoignant()
    const seance = seanceDUnePlace()
    const resultat = await app.repository.promotePatient(seance.id, 'inconnu')
    expect(resultat.ok).toBe(false)
  })

  it('refuse sur une séance qui n’existe pas', async () => {
    const app = await ouvrirSoignant()
    const resultat = await app.repository.promotePatient('seance-inexistante_20260101T1000', 'p_1')
    expect(resultat.ok).toBe(false)
  })
})
