import { describe, expect, it } from 'vitest'
import { agendaWeek, dedupeBusy } from './agenda'
import type { BusyEntry } from './conflicts'

const entree = (
  debut: string,
  fin: string,
  label: string,
  kind: BusyEntry['kind'] = 'activity',
): BusyEntry => ({ start: new Date(debut), end: new Date(fin), label, kind })

describe('dedupeBusy', () => {
  /*
    Le cas qui a figé l'écran des rendez-vous en production : l'intervenant anime le
    jardinage, la personne reçue y est inscrite. La séance arrivait deux fois, et l'écran
    en faisait deux lignes de clef identique — Svelte arrêtait le rendu, et il restait
    « Un instant… » pour toujours.
  */
  it("ne garde qu'une fois la séance présente dans les deux agendas", () => {
    const seance = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Jardinage')
    expect(dedupeBusy([seance, { ...seance }])).toHaveLength(1)
  })

  it('garde deux activités différentes à la même heure', () => {
    const a = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Jardinage')
    const b = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Atelier cuisine')
    expect(dedupeBusy([a, b])).toHaveLength(2)
  })

  it('garde une même activité à deux heures différentes', () => {
    const matin = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Jardinage')
    const soir = entree('2026-08-24T14:00:00Z', '2026-08-24T15:00:00Z', 'Jardinage')
    expect(dedupeBusy([matin, soir])).toHaveLength(2)
  })

  it('distingue un rendez-vous et une activité de mêmes bornes', () => {
    const activite = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Occupé', 'activity')
    const rendezVous = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Occupé', 'appointment')
    expect(dedupeBusy([activite, rendezVous])).toHaveLength(2)
  })

  it('laisse une liste vide tranquille', () => {
    expect(dedupeBusy([])).toEqual([])
  })
})

describe('agendaWeek dédoublonne ce qui est pris', () => {
  it("n'affiche qu'une ligne quand la séance vient des deux agendas", () => {
    const seance = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Jardinage')
    const semaine = agendaWeek(
      ['2026-08-24'],
      [{ weekday: 1, from: '08:00', to: '18:00' }],
      [seance, { ...seance }],
      30,
    )
    expect(semaine[0]!.taken).toHaveLength(1)
  })

  /* Les clefs d'affichage doivent rester distinctes : c'est ce qui a cassé le rendu. */
  it('produit des occupations toutes distinctes', () => {
    const seance = entree('2026-08-24T08:30:00Z', '2026-08-24T10:00:00Z', 'Jardinage')
    const autre = entree('2026-08-24T10:30:00Z', '2026-08-24T11:00:00Z', 'Jardinage')
    const semaine = agendaWeek(
      ['2026-08-24'],
      [{ weekday: 1, from: '08:00', to: '18:00' }],
      [seance, { ...seance }, autre],
      30,
    )
    const clefs = semaine[0]!.taken.map((t) => `${t.label}|${t.start.toISOString()}`)
    expect(new Set(clefs).size).toBe(clefs.length)
  })
})

describe('un même rendez-vous vu des deux agendas', () => {
  /*
    Le rendez-vous arrive sous deux noms : « Rendez-vous » depuis l'agenda de
    l'intervenant, « Rendez-vous avec Docteur Lemaire » depuis celui du patient. Les deux
    agendas croisés ici sont ceux de deux personnes qui se voient : aux mêmes bornes,
    c'est nécessairement le même.
  */
  it('ne compte qu’une fois, et garde le nom le plus explicite', () => {
    const cote = entree('2026-08-27T09:00:00Z', '2026-08-27T09:30:00Z', 'Rendez-vous', 'appointment')
    const autre = entree(
      '2026-08-27T09:00:00Z',
      '2026-08-27T09:30:00Z',
      'Rendez-vous avec Docteur Lemaire',
      'appointment',
    )
    const garde = dedupeBusy([cote, autre])
    expect(garde).toHaveLength(1)
    expect(garde[0]!.label).toBe('Rendez-vous avec Docteur Lemaire')
  })

  it('laisse deux rendez-vous à des heures différentes', () => {
    const matin = entree('2026-08-27T09:00:00Z', '2026-08-27T09:30:00Z', 'Rendez-vous', 'appointment')
    const soir = entree('2026-08-27T14:00:00Z', '2026-08-27T14:30:00Z', 'Rendez-vous', 'appointment')
    expect(dedupeBusy([matin, soir])).toHaveLength(2)
  })
})

/**
 * Deux rendez-vous réellement distincts, aux mêmes bornes.
 *
 * La fusion avait d'abord retiré le libellé de la comparaison pour tous les rendez-vous.
 * C'était trop large : un double emploi — deux rendez-vous à la même heure dans l'agenda
 * de l'un ou de l'autre — se fondait alors en une seule ligne, alors que c'est
 * exactement ce que cet écran existe pour montrer.
 */
describe('deux rendez-vous distincts à la même heure', () => {
  const A = '2026-08-27T09:00:00Z'
  const B = '2026-08-27T09:30:00Z'

  it('restent deux lignes quand les noms ne se ressemblent pas', () => {
    const claire = entree(A, B, 'Rendez-vous avec Claire', 'appointment')
    const lemaire = entree(A, B, 'Rendez-vous avec Docteur Lemaire', 'appointment')
    expect(dedupeBusy([claire, lemaire])).toHaveLength(2)
  })

  it('se fondent quand l’un prolonge l’autre : c’est le même, vu des deux côtés', () => {
    const sansNom = entree(A, B, 'Rendez-vous', 'appointment')
    const avecNom = entree(A, B, 'Rendez-vous avec Claire', 'appointment')
    const garde = dedupeBusy([sansNom, avecNom])
    expect(garde).toHaveLength(1)
    expect(garde[0]!.label).toBe('Rendez-vous avec Claire')
  })

  it('ne prolonge rien pour une activité : deux ateliers restent deux', () => {
    // « Atelier » et « Atelier cuisine » sont deux activités, pas une vue de deux côtés.
    const court = entree(A, B, 'Atelier', 'activity')
    const long = entree(A, B, 'Atelier cuisine', 'activity')
    expect(dedupeBusy([court, long])).toHaveLength(2)
  })

  it('ne se laisse pas prendre par un préfixe qui n’en est pas un', () => {
    // « Rendez-vous » ne prolonge pas « Rendez-vousiers » : c'est le mot suivant qui
    // doit commencer, pas la chaîne qui doit se poursuivre.
    const a = entree(A, B, 'Rendez-vous', 'appointment')
    const b = entree(A, B, 'Rendez-vousiers', 'appointment')
    expect(dedupeBusy([a, b])).toHaveLength(2)
  })
})
