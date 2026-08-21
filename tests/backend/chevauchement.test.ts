import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import { appointmentConflictsFor, registerTx } from '../../functions/src/lib/registration'

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
    const conflits = await appointmentConflictsFor(db(), PATIENT, SEANCE)
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
    const conflits = await appointmentConflictsFor(db(), PATIENT, SEANCE)
    expect(conflits[0]?.label).toBe('Rendez-vous avec le psychiatre')
  })

  it('ignore un rendez-vous qui s’enchaîne bord à bord', async () => {
    await seedRendezVous('15:30', '16:00', 'Docteur Lemaire')
    expect(await appointmentConflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('ignore un rendez-vous annulé', async () => {
    await seedRendezVous('14:15', '14:45', 'Docteur Lemaire')
    await db().collection(COLLECTIONS.appointments).doc('rdv-chevauchement').update({ status: 'cancelled' })
    expect(await appointmentConflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('ignore une autre activité prise au même moment', async () => {
    /*
      Le cas courant, et celui qui bloquait la réunion : deux activités qui se recouvrent.
      On inscrit sans rien demander — ce qui se chevauche se voit sur la feuille.
    */
    await seedOccurrence(VOISINE, 'Jeux de société', '14:30', '16:00')
    await registerTx(db(), { occurrenceId: VOISINE, patientUid: PATIENT, by: 'staff' })
    expect(await appointmentConflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })

  it('ne trouve rien quand la journée est libre', async () => {
    expect(await appointmentConflictsFor(db(), PATIENT, SEANCE)).toEqual([])
  })
})
