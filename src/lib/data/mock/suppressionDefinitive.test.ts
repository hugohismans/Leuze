import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, world } from './state'
import { deletionConsequences } from '../../domain/catalog'
import { mockCatalog } from './catalog'
import { todayLocalDate } from '../../domain/time'

/**
 * Supprimer pour de bon, à ne pas confondre avec annuler.
 *
 * Annuler laisse la séance visible, barrée, avec son motif : la personne inscrite
 * comprend pourquoi elle ne vient pas. Supprimer efface tout — c'est pour ce qui n'aurait
 * jamais dû être créé, et il ne reste alors rien à expliquer.
 */
describe('supprimer une activité pour de bon', () => {
  beforeEach(() => {
    resetWorld()
  })

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('soignant@exemple.test', 'peu-importe')
    return app
  }

  /** Une activité qui a réuni du monde : c'est le cas qui était impossible jusqu'ici. */
  const avecDesInscrits = () => {
    const inscription = world.registrations.find((r) => r.status !== 'cancelled')!
    const seance = world.occurrences.get(inscription.occurrenceId)!
    return seance.activityId
  }

  it('sans insister, elle est seulement retirée du programme', async () => {
    const app = await ouvrir()
    const activityId = avecDesInscrits()

    const plan = await app.repository.deleteActivity(activityId)

    expect(plan.action).toBe('deactivated')
    expect(plan.usage!.registrations).toBeGreaterThan(0)
    expect((await app.repository.getActivity(activityId))?.isActive).toBe(false)
    // Rien n'a été effacé : c'est précisément ce que « retiré » veut dire.
    expect([...world.occurrences.values()].some((o) => o.activityId === activityId)).toBe(true)
  })

  it('en insistant, tout part : séances et inscriptions comprises', async () => {
    const app = await ouvrir()
    const activityId = avecDesInscrits()
    const seances = new Set(
      [...world.occurrences.values()].filter((o) => o.activityId === activityId).map((o) => o.id),
    )
    expect(world.registrations.some((r) => seances.has(r.occurrenceId))).toBe(true)

    const plan = await app.repository.deleteActivity(activityId, { force: true })

    expect(plan.action).toBe('deleted')
    expect(plan.message).toMatch(/effacée?s?/)
    expect(await app.repository.getActivity(activityId)).toBeNull()
    expect([...world.occurrences.values()].some((o) => o.activityId === activityId)).toBe(false)
    expect(world.registrations.some((r) => seances.has(r.occurrenceId))).toBe(false)
  })

  it('une séance seule s’efface, les autres semaines restent', async () => {
    const app = await ouvrir()
    const inscription = world.registrations.find((r) => r.status !== 'cancelled')!
    const seance = world.occurrences.get(inscription.occurrenceId)!
    const soeurs = [...world.occurrences.values()].filter(
      (o) => o.activityId === seance.activityId && o.id !== seance.id,
    ).length

    const resultat = await app.repository.deleteOccurrence(seance.id)

    expect(resultat.ok).toBe(true)
    expect(world.occurrences.has(seance.id)).toBe(false)
    expect(world.registrations.some((r) => r.occurrenceId === seance.id)).toBe(false)
    // L'activité elle-même n'est pas touchée.
    expect(await app.repository.getActivity(seance.activityId)).not.toBeNull()
    expect(
      [...world.occurrences.values()].filter((o) => o.activityId === seance.activityId).length,
    ).toBe(soeurs)
  })

  it('compte les présences notées : c’est la perte la moins visible', async () => {
    const app = await ouvrir()
    const inscription = world.registrations.find((r) => r.status === 'confirmed')!
    const seance = world.occurrences.get(inscription.occurrenceId)!
    await app.repository.markAttendance(seance.id, inscription.patientUid, 'present')

    const plan = await app.repository.deleteActivity(seance.activityId)

    expect(plan.usage!.attendances).toBe(1)
    expect(plan.usage!.pastSessions).toBeGreaterThanOrEqual(0)
    expect(deletionConsequences(plan.usage!).some((l) => l.includes('1 présence notée'))).toBe(true)
    expect(deletionConsequences(plan.usage!).some((l) => l.includes('qui est venu'))).toBe(true)
  })

  it('efface aussi les présences quand on supprime pour de bon', async () => {
    const app = await ouvrir()
    const inscription = world.registrations.find((r) => r.status === 'confirmed')!
    const seance = world.occurrences.get(inscription.occurrenceId)!
    await app.repository.markAttendance(seance.id, inscription.patientUid, 'present')
    expect(world.attendance.size).toBeGreaterThan(0)

    await app.repository.deleteActivity(seance.activityId, { force: true })

    expect(world.attendance.has(`${seance.id}|${inscription.patientUid}`)).toBe(false)
  })

  it('refuse à qui n’anime pas l’activité : une suppression n’a pas de retour', async () => {
    const app = await ouvrir()
    const activityId = avecDesInscrits()
    await app.superAdmin.impersonate('staff-docteur-lemaire')

    await expect(app.repository.deleteActivity(activityId, { force: true })).rejects.toThrow(
      /administrateur/,
    )
    expect(await app.repository.getActivity(activityId)).not.toBeNull()
  })
})

describe('une séance supprimée définitivement', () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
  })

  it('ne revient pas au premier enregistrement suivant de l’activité', async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')

    const seance = [...world.occurrences.values()].find((o) => o.localDate >= todayLocalDate())
    expect(seance).toBeDefined()
    const id = seance!.id

    const suppression = await app.repository.deleteOccurrence(id)
    expect(suppression.ok).toBe(true)
    expect(world.occurrences.has(id)).toBe(false)

    // On modifie l'activité — un changement de lieu suffit — et l'on régénère.
    const activite = (await app.repository.listActivities()).find((a) => a.id === seance!.activityId)
    expect(activite).toBeDefined()
    await app.repository.saveActivity({ ...activite!, locationId: 'le-salon' })

    // La séance ne doit pas être revenue : on la supprime parce qu'elle ne doit pas
    // avoir lieu, et changer le lieu de l'activité ne la ramène pas au programme.
    expect(world.occurrences.has(id)).toBe(false)
  })
})
