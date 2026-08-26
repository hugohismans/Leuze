import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import {
  busyOn,
  conflictsFor,
  hasActiveRegistration,
  myRegistrationsFor,
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

/**
 * Lire le jour, plutôt que tout l'historique.
 *
 * Chaque inscription porte désormais le jour de sa séance. Le serveur peut donc demander
 * « qu'a cette personne ce mardi ? » au lieu de lire toutes ses inscriptions depuis son
 * admission — une centaine de documents facturés pour en garder trois, à chaque ouverture
 * de l'application et à chaque prénom cliqué en réunion.
 *
 * Le seul risque est d'en rater. Ces tests comparent donc les deux chemins : ils doivent
 * dire exactement la même chose, et le chemin rapide doit se taire tant qu'une seule
 * inscription n'a pas sa date.
 */
describe('lire au jour le jour', () => {
  it('écrit le jour de la séance sur l’inscription', async () => {
    await seance()
    const pose = await registerTx(db(), { occurrenceId: SEANCE, patientUid: EVA, by: 'staff' })
    expect(pose.ok).toBe(true)
    if (!pose.ok) return
    const ecrite = (await db().collection(COLLECTIONS.registrations).doc(pose.registrationId).get()).data()
    expect(ecrite?.['localDate']).toBe('2026-09-01')
  })

  it('trouve la même chose par les deux chemins', async () => {
    await seance()
    await rendezVous('2026-09-01T09:30:00+02:00', '2026-09-01T10:00:00+02:00')
    // Une autre séance le même jour, à laquelle Eva est inscrite.
    await db().collection(COLLECTIONS.occurrences).doc('autre_20260901T0930').set({
      ...(await db().collection(COLLECTIONS.occurrences).doc(SEANCE).get()).data(),
      title: 'Jonglerie',
      start: Timestamp.fromDate(new Date('2026-09-01T09:30:00+02:00')),
      end: Timestamp.fromDate(new Date('2026-09-01T10:30:00+02:00')),
    })
    await registerTx(db(), { occurrenceId: 'autre_20260901T0930', patientUid: EVA, by: 'staff' })

    const lent = await busyOn(db(), EVA, '2026-09-01', SEANCE, undefined, false)
    const rapide = await busyOn(db(), EVA, '2026-09-01', SEANCE, undefined, true)
    expect(rapide.map((e) => e.label).sort()).toEqual(lent.map((e) => e.label).sort())
    expect(rapide).toHaveLength(2)
  })

  it('ne perd rien de vue quand une inscription n’a pas encore sa date', async () => {
    /*
      La garantie qui compte. Une inscription écrite avant que le champ existe ne porte
      pas de date : la requête filtrée l'écarte en silence. C'est pour cela que le serveur
      ne passe au chemin rapide qu'une fois la reprise faite — et ce test montre ce qui
      arriverait sinon.
    */
    await seance()
    const pose = await registerTx(db(), { occurrenceId: SEANCE, patientUid: EVA, by: 'staff' })
    expect(pose.ok).toBe(true)
    if (!pose.ok) return
    // On efface la date, comme sur une inscription d'avant : on réécrit le document
    // sans elle, plutôt que par un effacement de champ — le test doit rester lisible.
    const reference = db().collection(COLLECTIONS.registrations).doc(pose.registrationId)
    const { localDate: _sansDate, ...avant } = (await reference.get()).data() as Record<string, unknown>
    await reference.set(avant)

    const lent = await busyOn(db(), EVA, '2026-09-01', 'ailleurs_20260901T1400', undefined, false)
    const rapide = await busyOn(db(), EVA, '2026-09-01', 'ailleurs_20260901T1400', undefined, true)
    expect(lent).toHaveLength(1)
    // Le chemin rapide la manque : c'est exactement ce que le drapeau empêche.
    expect(rapide).toHaveLength(0)
  })

  it('ne rend que ce qui vient, sans remonter le passé', async () => {
    await seance()
    await registerTx(db(), { occurrenceId: SEANCE, patientUid: EVA, by: 'staff' })
    // Une séance de l'an dernier, à laquelle elle était inscrite.
    await db().collection(COLLECTIONS.occurrences).doc('vieille_20250901T0900').set({
      ...(await db().collection(COLLECTIONS.occurrences).doc(SEANCE).get()).data(),
      localDate: '2025-09-01',
    })
    await registerTx(db(), { occurrenceId: 'vieille_20250901T0900', patientUid: EVA, by: 'staff' })

    const tout = await myRegistrationsFor(db(), EVA, false)
    const aVenir = await myRegistrationsFor(db(), EVA, true, '2026-08-31')
    expect(tout).toHaveLength(2)
    expect(aVenir.map((l) => l.occurrenceId)).toEqual([SEANCE])
  })
})
