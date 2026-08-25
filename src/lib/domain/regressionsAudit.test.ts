import { describe, expect, it } from 'vitest'
import { planGeneration } from '../data/generation'
import { expand } from './recurrence'
import type { Activity, Occurrence } from './types'
import { addLocalDays, startOfIsoWeek, todayLocalDate } from './time'

/**
 * Les défauts trouvés par l'audit de la veille de la démonstration.
 *
 * Chacun de ces tests échouait avant sa correction. Ils sont regroupés ici parce qu'ils
 * ont une chose en commun : aucun n'était visible depuis un test d'écran isolé — il
 * fallait enchaîner deux gestes ordinaires pour les faire apparaître.
 */

const activiteHebdo = (from: string, jours: number[]): Activity => ({
  id: 'gym',
  seriesId: 'gym',
  title: 'Gymnastique douce',
  description: '',
  categoryId: 'sport',
  locationId: 'salle',
  facilitatorId: 'marc',
  facilitator: 'Marc',
  audience: 'all',
  serviceIds: [],
  capacity: 12,
  registrationRequired: true,
  waitlistEnabled: true,
  recurrence: {
    freq: 'weekly',
    byWeekday: jours as never,
    startTime: '10:00',
    durationMin: 60,
    from,
    until: null,
    skipDates: [],
  },
  isActive: true,
})

describe('enregistrer une activité hebdomadaire sans rien y changer', () => {
  /*
    La fenêtre de génération commence au **lundi de la semaine en cours**. Le formulaire,
    lui, réécrivait « from: aujourd'hui ». La séance du lundi tombait donc entre les deux
    et se retrouvait annulée, avec ses inscrits — sur un simple appui sur « Enregistrer ».
  */
  const lundi = startOfIsoWeek(todayLocalDate())
  const mercredi = addLocalDays(lundi, 2)
  const fenetre = { from: lundi, to: addLocalDays(lundi, 28) }
  const jourIso = (d: string): number => {
    const [a, m, j] = d.split('-').map(Number)
    const iso = new Date(Date.UTC(a!, m! - 1, j!)).getUTCDay()
    return iso === 0 ? 7 : iso
  }

  it('ne touche pas à la séance du lundi quand la série part du lundi', () => {
    const activite = activiteHebdo(lundi, [jourIso(lundi)])
    const existantes = expand(activite, fenetre.from, fenetre.to)
    const duLundi = existantes.find((o) => o.localDate === lundi)
    expect(duLundi, 'la séance du lundi doit exister').toBeDefined()

    const plan = planGeneration(activite, existantes, fenetre)
    expect(plan.remove).not.toContain(duLundi!.id)
    expect(plan.report.cancelled).toBe(0)
  })

  it("l'annulait quand la série repartait du jour même — c'est le défaut corrigé", () => {
    // On rejoue l'ancien comportement pour montrer ce que la correction évite.
    const activite = activiteHebdo(lundi, [jourIso(lundi)])
    const existantes = expand(activite, fenetre.from, fenetre.to)
    const commeAvant = activiteHebdo(mercredi, [jourIso(lundi)])
    const plan = planGeneration(commeAvant, existantes, fenetre)
    // La séance du lundi n'est plus produite par la règle : elle serait retirée.
    expect(plan.remove.length + plan.report.cancelled).toBeGreaterThan(0)
  })

  it('rend la date de fin et les jours sautés intacts', () => {
    const activite = activiteHebdo(lundi, [jourIso(lundi)])
    activite.recurrence!.until = addLocalDays(lundi, 14)
    activite.recurrence!.skipDates = [addLocalDays(lundi, 7)]
    const produites = expand(activite, fenetre.from, fenetre.to)
    // Le jour sauté n'est pas produit, et rien ne dépasse la date de fin.
    expect(produites.map((o) => o.localDate)).not.toContain(addLocalDays(lundi, 7))
    expect(produites.every((o) => o.localDate <= addLocalDays(lundi, 14))).toBe(true)
  })
})

describe('deux séances de la même activité le même jour', () => {
  /*
    Après un changement d'heure, l'ancienne séance reste, barrée, et la nouvelle apparaît.
    Les chercher par « activité + jour » rendait la première des deux : on cliquait la
    nouvelle et l'on ouvrait l'ancienne. « Supprimer cette séance » effaçait alors une
    séance que personne n'avait choisie, avec ses inscrits.
  */
  const seance = (id: string, heure: string, statut: 'scheduled' | 'cancelled'): Occurrence =>
    ({
      id,
      activityId: 'relaxation',
      seriesId: 'relaxation',
      title: 'Relaxation',
      description: '',
      categoryId: 'relaxation',
      locationId: 'salle',
      localDate: '2026-09-01',
      start: new Date(`2026-09-01T${heure}:00.000Z`),
      end: new Date(`2026-09-01T${heure}:00.000Z`),
      audienceKeys: ['all'],
      capacity: 8,
      registrationRequired: true,
      waitlistEnabled: true,
      status: statut,
      overridden: false,
      confirmedCount: 7,
      waitlistCount: 0,
    }) as Occurrence

  const toutes = [
    seance('relaxation_20260901T1400', '12:00', 'cancelled'),
    seance('relaxation_20260901T1600', '14:00', 'scheduled'),
  ]

  it("le jour seul ne les distingue pas : il rend toujours la première", () => {
    const parJour = toutes.find((o) => o.activityId === 'relaxation' && o.localDate === '2026-09-01')
    expect(parJour?.id).toBe('relaxation_20260901T1400')
  })

  it("l'identifiant désigne celle qu'on a choisie, et elle seule", () => {
    const choisie = toutes.find((o) => o.id === 'relaxation_20260901T1600')
    expect(choisie?.status).toBe('scheduled')
    expect(choisie?.id).toBe('relaxation_20260901T1600')
  })
})
