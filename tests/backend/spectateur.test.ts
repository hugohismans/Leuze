import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIONS, Timestamp, db } from '../../functions/src/lib/firestore'
import { busyOn, myRegistrationsFor, registerTx, rosterFor, unregisterTx } from '../../functions/src/lib/registration'

/**
 * Venir regarder, éprouvé sur l'émulateur avec le code réel des Cloud Functions.
 *
 * Le domaine dit ce qui doit arriver ; c'est ici qu'on vérifie que la transaction
 * l'écrit vraiment — un compteur, une ligne unique, une place rendue au bon moment.
 * C'est le seul endroit où une surréservation se verrait avant la production.
 */

const OCCURRENCE = 'atelier-terre_20260901T1400'
const VOISINE = 'jonglerie_20260901T1430'
const MAZUREL = 'le-mazurel'

const demain = () => new Date(Date.now() + 86_400_000)

async function seedOccurrence(
  id: string,
  overrides: Record<string, unknown> = {},
  decalageMinutes = 0,
): Promise<void> {
  const start = new Date(demain().getTime() + decalageMinutes * 60_000)
  await db()
    .collection(COLLECTIONS.occurrences)
    .doc(id)
    .set({
      activityId: id.split('_')[0],
      seriesId: `serie-${id.split('_')[0]}`,
      title: id.startsWith('atelier') ? 'Atelier terre' : 'Jonglerie',
      description: 'Une heure ensemble.',
      categoryId: 'creatif',
      locationId: 'atelier',
      localDate: '2026-09-01',
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(new Date(start.getTime() + 5_400_000)),
      audienceKeys: ['all'],
      capacity: 2,
      registrationRequired: true,
      waitlistEnabled: true,
      status: 'scheduled',
      overridden: false,
      confirmedCount: 0,
      waitlistCount: 0,
      ...overrides,
    })
}

async function clear(): Promise<void> {
  for (const name of [COLLECTIONS.occurrences, COLLECTIONS.registrations, COLLECTIONS.appointments]) {
    const snapshot = await db().collection(name).get()
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()))
    expect((await db().collection(name).count().get()).data().count).toBe(0)
  }
}

const compteurs = async (id = OCCURRENCE) => {
  const data = (await db().collection(COLLECTIONS.occurrences).doc(id).get()).data() as {
    confirmedCount: number
    waitlistCount: number
    spectatorCount?: number
  }
  return {
    confirmed: data.confirmedCount,
    waitlist: data.waitlistCount,
    spectateurs: data.spectatorCount ?? 0,
  }
}

/** Les lignes actives au nom d'une personne sur une séance. Deux serait un défaut. */
const lignesDe = async (patientUid: string, occurrenceId = OCCURRENCE) => {
  const snapshot = await db()
    .collection(COLLECTIONS.registrations)
    .where('occurrenceId', '==', occurrenceId)
    .where('patientUid', '==', patientUid)
    .get()
  return snapshot.docs.map((d) => d.data()).filter((d) => d['status'] !== 'cancelled')
}

beforeEach(async () => {
  await clear()
})

describe('un spectateur ne prend la place de personne', () => {
  it('n’entre pas dans le nombre d’inscrits, et se compte à part', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 2 })
    const resultat = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    expect(resultat.ok && resultat.status).toBe('spectator')
    expect(await compteurs()).toEqual({ confirmed: 0, waitlist: 0, spectateurs: 1 })
  })

  it('entre sur une séance complète que l’inscription refuse', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 1, waitlistEnabled: false })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })

    const refus = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_2',
      by: 'patient',
      serviceId: MAZUREL,
    })
    expect(refus.ok).toBe(false)

    const regard = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_2',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })
    expect(regard.ok).toBe(true)
    // La place de p_1 n'a pas bougé : c'est toute la promesse faite à l'hôpital.
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 0, spectateurs: 1 })
  })

  it('n’est pas limité en nombre, là où les places le sont', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 1 })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    for (const uid of ['s_1', 's_2', 's_3', 's_4', 's_5']) {
      await registerTx(db(), {
        occurrenceId: OCCURRENCE,
        patientUid: uid,
        by: 'patient',
        serviceId: MAZUREL,
        as: 'spectator',
      })
    }
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 0, spectateurs: 5 })
  })

  it('ne promeut personne en partant : il ne tenait aucune place', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 1 })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_3',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 1, spectateurs: 1 })

    await unregisterTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_3' })
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 1, spectateurs: 0 })
  })
})

describe('changer d’avis, dans la transaction', () => {
  it('ne laisse jamais deux lignes actives au nom d’une personne', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 4 })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    expect(await lignesDe('p_1')).toHaveLength(1)
    expect(await compteurs()).toEqual({ confirmed: 0, waitlist: 0, spectateurs: 1 })
  })

  it('rend la place au premier de la file, dans le même geste', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 1 })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    const attente = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_2',
      by: 'patient',
      serviceId: MAZUREL,
    })
    expect(attente.ok && attente.status).toBe('waitlist')

    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    // La place libérée ne reste pas vide : sans cela, la file cesse d'être une file.
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 0, spectateurs: 1 })
    const promue = (await lignesDe('p_2'))[0]
    expect(promue?.['status']).toBe('confirmed')
  })

  it('ne perd pas la présence déjà notée par l’animateur', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 4 })
    const inscrit = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
    })
    expect(inscrit.ok).toBe(true)
    if (!inscrit.ok) return

    // L'animateur a coché « présent » ; ce champ ne vit pas dans le type du domaine.
    await db()
      .collection(COLLECTIONS.registrations)
      .doc(inscrit.registrationId)
      .set({ attendance: 'present' }, { merge: true })

    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    const apres = (await db().collection(COLLECTIONS.registrations).doc(inscrit.registrationId).get()).data()
    expect(apres?.['status']).toBe('spectator')
    // Une écriture pleine l'aurait effacé, et la feuille d'appel aurait perdu quelqu'un.
    expect(apres?.['attendance']).toBe('present')
  })

  it('ne déloge pas un spectateur quand la séance est complète et la file fermée', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 1, waitlistEnabled: false })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_2',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    const refus = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_2',
      by: 'patient',
      serviceId: MAZUREL,
    })
    expect(refus.ok).toBe(false)
    // Refusé, il reste ce qu'il était : essayer de changer d'avis ne coûte rien.
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 0, spectateurs: 1 })
  })
})

describe('le cycle de la réunion, côté serveur', () => {
  it('inscrit, puis fait spectateur, puis retire — sans jamais doubler la ligne', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 4 })

    const premier = await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'staff' })
    expect(premier.ok && premier.status).toBe('confirmed')
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 0, spectateurs: 0 })

    const second = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'staff',
      as: 'spectator',
    })
    expect(second.ok && second.status).toBe('spectator')
    expect(await lignesDe('p_1')).toHaveLength(1)
    expect(await compteurs()).toEqual({ confirmed: 0, waitlist: 0, spectateurs: 1 })

    await unregisterTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'staff' })
    expect(await lignesDe('p_1')).toHaveLength(0)
    expect(await compteurs()).toEqual({ confirmed: 0, waitlist: 0, spectateurs: 0 })
  })

  it('laisse le soignant noter un spectateur sur une séance complète', async () => {
    // Le nombre de places ne le concerne pas : c'est toute la raison d'être du geste.
    await seedOccurrence(OCCURRENCE, { capacity: 1, waitlistEnabled: false })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'staff' })

    const regard = await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_2',
      by: 'staff',
      as: 'spectator',
    })
    expect(regard.ok).toBe(true)
    expect(await compteurs()).toEqual({ confirmed: 1, waitlist: 0, spectateurs: 1 })
  })
})

describe('un spectateur est quelque part', () => {
  it('occupe la personne, et le dit comme un regard', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 4 })
    await seedOccurrence(VOISINE, { capacity: 4 }, 30)
    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    const occupe = await busyOn(db(), 'p_1', '2026-09-01', VOISINE)
    const atelier = occupe.find((e) => e.occurrenceId === OCCURRENCE)
    expect(atelier).toBeDefined()
    // Sans ce drapeau, l'écran dirait « Vous êtes déjà inscrit » à quelqu'un qui ne l'est pas.
    expect(atelier?.spectator).toBe(true)
  })
})

describe('ce que le patient et l’animateur relisent', () => {
  it('rend le regard tel quel, sans le confondre avec une attente', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 4 })
    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_1',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    const miennes = await myRegistrationsFor(db(), 'p_1')
    expect(miennes).toEqual([{ occurrenceId: OCCURRENCE, status: 'spectator', position: null }])
  })

  it('range les spectateurs en dernier sur la feuille, sans position', async () => {
    await seedOccurrence(OCCURRENCE, { capacity: 1 })
    await db().collection(COLLECTIONS.patients).doc('p_1').set({ firstName: 'Alix', serviceId: MAZUREL })
    await db().collection(COLLECTIONS.patients).doc('p_2').set({ firstName: 'Bo', serviceId: MAZUREL })
    await db().collection(COLLECTIONS.patients).doc('p_3').set({ firstName: 'Cam', serviceId: MAZUREL })

    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_1', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), { occurrenceId: OCCURRENCE, patientUid: 'p_2', by: 'patient', serviceId: MAZUREL })
    await registerTx(db(), {
      occurrenceId: OCCURRENCE,
      patientUid: 'p_3',
      by: 'patient',
      serviceId: MAZUREL,
      as: 'spectator',
    })

    const lignes = await rosterFor(db(), OCCURRENCE)
    expect(lignes.map((l) => `${l.firstName}:${l.status}`)).toEqual([
      'Alix:confirmed',
      'Bo:waitlist',
      'Cam:spectator',
    ])
    expect(lignes[2]?.position).toBeNull()
  })
})
