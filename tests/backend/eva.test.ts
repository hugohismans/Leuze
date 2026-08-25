import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import {
  conflictsFor,
  hasActiveRegistration,
  registerTx,
  unregisterTx,
} from '../../functions/src/lib/registration'

/**
 * Le cas d'Eva, posé par l'hôpital : rendez-vous le mardi à 9h30, activité de 9h à 10h.
 *
 * C'est le chevauchement **partiel** — celui qu'on rate quand on compare des heures de
 * début plutôt que des intervalles. Le soignant qui inscrit en réunion doit être averti.
 */
const SEANCE = 'atelier_20260901T0900'
const EVA = 'eva'

async function seance(): Promise<void> {
  await db()
    .collection(COLLECTIONS.occurrences)
    .doc(SEANCE)
    .set({
      activityId: 'atelier',
      seriesId: 'serie-atelier',
      title: 'Atelier terre',
      description: '',
      categoryId: 'creatif',
      locationId: 'atelier',
      localDate: '2026-09-01',
      start: Timestamp.fromDate(new Date('2026-09-01T09:00:00+02:00')),
      end: Timestamp.fromDate(new Date('2026-09-01T10:00:00+02:00')),
      audienceKeys: ['all'],
      capacity: 8,
      registrationRequired: true,
      waitlistEnabled: true,
      status: 'scheduled',
      overridden: false,
      confirmedCount: 0,
      waitlistCount: 0,
    })
}

async function rendezVous(debut: string, fin: string, status = 'scheduled'): Promise<void> {
  await db().collection(COLLECTIONS.appointments).doc('rdv-eva').set({
    patientUid: EVA,
    kindId: 'psychiatre',
    preference: 'peu-importe',
    status,
    createdAt: Timestamp.fromDate(new Date()),
    localDate: '2026-09-01',
    start: Timestamp.fromDate(new Date(debut)),
    end: Timestamp.fromDate(new Date(fin)),
    withWhom: 'Docteur Lemaire',
  })
}

beforeEach(async () => {
  for (const c of [COLLECTIONS.occurrences, COLLECTIONS.appointments, COLLECTIONS.registrations]) {
    const s = await db().collection(c).get()
    await Promise.all(s.docs.map((d) => d.ref.delete()))
  }
})

describe('le cas d’Eva', () => {
  it('avertit quand le rendez-vous commence au milieu de l’activité', async () => {
    await seance()
    await rendezVous('2026-09-01T09:30:00+02:00', '2026-09-01T10:00:00+02:00')
    const conflits = await conflictsFor(db(), EVA, SEANCE)
    expect(conflits).toHaveLength(1)
    expect(conflits[0]?.label).toContain('Docteur Lemaire')
  })

  it('avertit aussi quand l’activité commence au milieu du rendez-vous', async () => {
    await seance()
    await rendezVous('2026-09-01T08:30:00+02:00', '2026-09-01T09:15:00+02:00')
    expect(await conflictsFor(db(), EVA, SEANCE)).toHaveLength(1)
  })

  it('avertit quand le rendez-vous est entièrement dedans', async () => {
    await seance()
    await rendezVous('2026-09-01T09:15:00+02:00', '2026-09-01T09:45:00+02:00')
    expect(await conflictsFor(db(), EVA, SEANCE)).toHaveLength(1)
  })

  it('n’avertit pas quand ils s’enchaînent bord à bord', async () => {
    // 10h00 pile : l'un finit, l'autre commence. Ce n'est pas un chevauchement.
    await seance()
    await rendezVous('2026-09-01T10:00:00+02:00', '2026-09-01T10:30:00+02:00')
    expect(await conflictsFor(db(), EVA, SEANCE)).toHaveLength(0)
  })

  it('n’avertit pas pour un rendez-vous annulé', async () => {
    await seance()
    await rendezVous('2026-09-01T09:30:00+02:00', '2026-09-01T10:00:00+02:00', 'cancelled')
    expect(await conflictsFor(db(), EVA, SEANCE)).toHaveLength(0)
  })

  it('n’avertit pas pour une demande pas encore fixée', async () => {
    // Une demande sans date ne bloque rien : il n'y a pas encore d'heure à heurter.
    await seance()
    await rendezVous('2026-09-01T09:30:00+02:00', '2026-09-01T10:00:00+02:00', 'requested')
    expect(await conflictsFor(db(), EVA, SEANCE)).toHaveLength(0)
  })
})

/**
 * Le deuxième appui du cycle de la réunion.
 *
 * Le soignant a déjà dit « oui, inscrivez-la quand même » : il connaît le rendez-vous, il
 * sait qu'il sera déplacé. Lui reposer la question pour un geste qui ne heurte aucun
 * horaire de plus lui apprendrait à cliquer sans lire — y compris sur l'avertissement qui
 * compte.
 */
describe('quand Eva est déjà sur la séance', () => {
  it('ne repose pas la question du rendez-vous', async () => {
    await seance()
    await rendezVous('2026-09-01T09:30:00+02:00', '2026-09-01T10:00:00+02:00')

    // Elle n'y est pas encore : la question se pose.
    expect(await hasActiveRegistration(db(), SEANCE, EVA)).toBe(false)
    expect(await conflictsFor(db(), EVA, SEANCE)).toHaveLength(1)

    // Le soignant a tranché, elle est inscrite.
    await registerTx(db(), { occurrenceId: SEANCE, patientUid: EVA, by: 'staff' })
    expect(await hasActiveRegistration(db(), SEANCE, EVA)).toBe(true)

    // Le passage en spectatrice ne heurte aucun horaire de plus : il doit passer seul.
    const regard = await registerTx(db(), {
      occurrenceId: SEANCE,
      patientUid: EVA,
      by: 'staff',
      as: 'spectator',
    })
    expect(regard.ok).toBe(true)
  })

  it('oublie une inscription annulée : la question revient', async () => {
    await seance()
    await rendezVous('2026-09-01T09:30:00+02:00', '2026-09-01T10:00:00+02:00')
    await registerTx(db(), { occurrenceId: SEANCE, patientUid: EVA, by: 'staff' })
    await unregisterTx(db(), { occurrenceId: SEANCE, patientUid: EVA, by: 'staff' })
    // Sortie, elle n'est plus « déjà là » : la réserve ne doit pas lui survivre.
    expect(await hasActiveRegistration(db(), SEANCE, EVA)).toBe(false)
  })
})
