import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import { conflictsFor, registerTx } from '../../functions/src/lib/registration'

/**
 * Ce qui arrête une inscription prise en réunion, éprouvé sur l'émulateur.
 *
 * Un rendez-vous arrête ; une autre activité, non. La distinction n'est pas de confort :
 * un programme chargé fait se recouvrir des activités en permanence, et l'application
 * posait une question à chaque prénom cliqué. Le contrôle doit donc refuser exactement
 * ce qu'il faut, et rien de plus — sans quoi la réunion n'avance plus.
 */

const JOUR = '2026-09-01'
const SEANCE = `atelier-cuisine_20260901T1400`
const VOISINE = `jeux-de-societe_20260901T1430`
const PATIENT = 'p_chevauchement'

const debut = (heure: string) => new Date(`${JOUR}T${heure}:00+02:00`)

async function seedOccurrence(id: string, titre: string, de: string, a: string): Promise<void> {
  await db()
    .collection(COLLECTIONS.occurrences)
    .doc(id)
    .set({
      activityId: id.split('_')[0],
      seriesId: 'serie',
      title: titre,
      description: '',
      categoryId: 'creatif',
      locationId: 'cuisine',
      localDate: JOUR,
      start: Timestamp.fromDate(debut(de)),
      end: Timestamp.fromDate(debut(a)),
      audienceKeys: ['all'],
      capacity: null,
      registrationRequired: true,
      waitlistEnabled: false,
      status: 'scheduled',
      overridden: false,
      confirmedCount: 0,
      waitlistCount: 0,
    })
}

async function seedRendezVous(de: string, a: string, withWhom: string | null): Promise<void> {
  await db()
    .collection(COLLECTIONS.appointments)
    .doc('rdv-chevauchement')
    .set({
      patientUid: PATIENT,
      kindId: 'psychiatre',
      preference: 'peu-importe',
      status: 'scheduled',
      createdAt: Timestamp.now(),
      localDate: JOUR,
      start: Timestamp.fromDate(debut(de)),
      end: Timestamp.fromDate(debut(a)),
      ...(withWhom === null ? {} : { withWhom }),
    })
}

async function clear(): Promise<void> {
  for (const name of [COLLECTIONS.occurrences, COLLECTIONS.registrations, COLLECTIONS.appointments]) {
    const snapshot = await db().collection(name).get()
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()))
  }
}

beforeEach(async () => {
  await clear()
  await seedOccurrence(SEANCE, 'Atelier cuisine', '14:00', '15:30')
})

describe('ce qui arrête une inscription prise par un soignant', () => {
  it('trouve le rendez-vous qui tombe au même moment, et le nomme', async () => {
    await seedRendezVous('14:15', '14:45', 'Docteur Lemaire')
    const conflits = await conflictsFor(db(), PATIENT, SEANCE)
    expect(conflits).toHaveLength(1)
    expect(conflits[0]?.kind).toBe('appointment')
    expect(conflits[0]?.label).toBe('Rendez-vous avec Docteur Lemaire')
  })

  it('nomme le rendez-vous par son motif quand personne n’y est encore attaché', async () => {
    await db()
      .collection(COLLECTIONS.appointmentKinds)
      .doc('psychiatre')
      .set({ name: 'le psychiatre', icon: '🩺', isActive: true })
    await seedRendezVous('14:15', '14:45', null)
    const conflits = await conflictsFor(db(), PATIENT, SEANCE)
    expect(conflits[0]?.label).toBe('Rendez-vous avec le psychiatre')
  })

  it('ignore un rendez-vous qui s’enchaîne bord à bord', async () => {
    await seedRendezVous('15:30', '16:00', 'Docteur Lemaire')
    expect(await conflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('ignore un rendez-vous annulé', async () => {
    await seedRendezVous('14:15', '14:45', 'Docteur Lemaire')
    await db().collection(COLLECTIONS.appointments).doc('rdv-chevauchement').update({ status: 'cancelled' })
    expect(await conflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('arrête aussi le soignant sur une autre activité prise au même moment', async () => {
    /*
      Décision de l'hôpital, revenue sur le choix d'origine.

      On laissait passer deux activités qui se recouvrent : cela se voit sur la feuille,
      et poser la question à chaque prénom faisait traîner la réunion. Mais inscrire
      quelqu'un à deux activités simultanées est une erreur, pas un arrangement — et c'est
      justement en réunion qu'elle se commet, en passant la liste vite. Le patient qui
      s'inscrit seul en est empêché depuis longtemps.

      Le soignant n'est pas empêché pour autant : il est averti, il confirme, cela passe.
    */
    await seedOccurrence(VOISINE, 'Jeux de société', '14:30', '16:00')
    await registerTx(db(), { occurrenceId: VOISINE, patientUid: PATIENT, by: 'staff' })
    const conflits = await conflictsFor(db(), PATIENT, SEANCE)
    expect(conflits).toHaveLength(1)
    expect(conflits[0]?.label).toBe('Jeux de société')
    expect(conflits[0]?.kind).toBe('activity')
  })

  it('ne trouve rien quand la journée est libre', async () => {
    expect(await conflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })
})

describe('ce que le patient voit annoncé quand il s’inscrit seul', () => {
  /*
    Ici, contrairement au soignant, les autres activités comptent : elles n'empêchent
    rien, mais on les dit. Ces cas couvrent la version qui mène ses lectures de front —
    la séance, les inscriptions et les rendez-vous partent ensemble, et le motif d'un
    rendez-vous n'est lu que s'il en manque un.
  */
  it('nomme l’autre activité qui tombe au même moment', async () => {
    await seedOccurrence(VOISINE, 'Jeux de société', '14:30', '16:00')
    await registerTx(db(), { occurrenceId: VOISINE, patientUid: PATIENT, by: 'staff' })

    const conflits = await conflictsFor(db(), PATIENT, SEANCE)
    expect(conflits.map((c) => [c.kind, c.label])).toEqual([['activity', 'Jeux de société']])
  })

  it('ne se signale pas lui-même', async () => {
    await registerTx(db(), { occurrenceId: SEANCE, patientUid: PATIENT, by: 'staff' })
    expect(await conflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('ignore une séance annulée à laquelle on reste inscrit', async () => {
    await seedOccurrence(VOISINE, 'Jeux de société', '14:30', '16:00')
    await registerTx(db(), { occurrenceId: VOISINE, patientUid: PATIENT, by: 'staff' })
    await db().collection(COLLECTIONS.occurrences).doc(VOISINE).update({ status: 'cancelled' })
    expect(await conflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('rend l’activité et le rendez-vous ensemble, chacun nommé', async () => {
    await seedOccurrence(VOISINE, 'Jeux de société', '14:30', '16:00')
    await registerTx(db(), { occurrenceId: VOISINE, patientUid: PATIENT, by: 'staff' })
    await seedRendezVous('14:15', '14:45', 'Docteur Lemaire')

    const conflits = await conflictsFor(db(), PATIENT, SEANCE)
    expect(conflits.map((c) => c.kind).sort()).toEqual(['activity', 'appointment'])
    expect(conflits.find((c) => c.kind === 'appointment')?.label).toBe('Rendez-vous avec Docteur Lemaire')
  })

  it('va chercher le motif seulement quand le rendez-vous n’a personne d’attitré', async () => {
    await db()
      .collection(COLLECTIONS.appointmentKinds)
      .doc('psychiatre')
      .set({ name: 'le psychiatre', icon: '🩺', isActive: true })
    await seedRendezVous('14:15', '14:45', null)
    const conflits = await conflictsFor(db(), PATIENT, SEANCE)
    expect(conflits[0]?.label).toBe('Rendez-vous avec le psychiatre')
  })
})
