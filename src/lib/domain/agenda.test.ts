import { describe, expect, it } from 'vitest'
import {
  agendaWeek,
  firstBookableDay,
  freeSlotsOn,
  noAvailabilityDeclared,
  onLeaveThroughout,
  onLeaveThroughoutMessage,
  suggestSlot,
  suggestionMessage,
} from './agenda'
import { instantOf } from './time'
import { formatLocalTime } from './availability'
import type { AvailabilityWindow } from './types'
import type { BusyEntry } from './conflicts'

// 2026-08-24 est un lundi ; 25 mardi, 26 mercredi, 27 jeudi.
const LUNDI = '2026-08-24'
const MARDI = '2026-08-25'
const JEUDI = '2026-08-27'

const mardiMatin: AvailabilityWindow[] = [{ weekday: 2, from: '09:00', to: '12:00' }]
const mardiEtJeudi: AvailabilityWindow[] = [
  { weekday: 2, from: '09:00', to: '12:00' },
  { weekday: 4, from: '14:00', to: '17:00' },
]

const pris = (jour: string, de: string, a: string, label = 'Occupé'): BusyEntry => ({
  start: instantOf(jour, de),
  end: instantOf(jour, a),
  label,
  kind: 'appointment',
})

describe('ce qui reste libre dans une journée', () => {
  it('est la plage entière quand rien n’est pris', () => {
    expect(freeSlotsOn(mardiMatin, [], MARDI, 30)).toEqual([{ from: '09:00', to: '12:00' }])
  })

  it('se coupe autour de ce qui est déjà pris', () => {
    const occupe = [pris(MARDI, '10:00', '10:30')]
    expect(freeSlotsOn(mardiMatin, occupe, MARDI, 30)).toEqual([
      { from: '09:00', to: '10:00' },
      { from: '10:30', to: '12:00' },
    ])
  })

  it('ignore les trous trop courts pour la durée demandée', () => {
    // Il reste 09h00–09h20 et 09h50–12h00 : le premier ne sert à rien pour 30 minutes.
    const occupe = [pris(MARDI, '09:20', '09:50')]
    expect(freeSlotsOn(mardiMatin, occupe, MARDI, 30)).toEqual([{ from: '09:50', to: '12:00' }])
  })

  it('fond deux créneaux pris qui se chevauchent', () => {
    const occupe = [pris(MARDI, '10:00', '11:00'), pris(MARDI, '10:30', '11:30')]
    expect(freeSlotsOn(mardiMatin, occupe, MARDI, 30)).toEqual([
      { from: '09:00', to: '10:00' },
      { from: '11:30', to: '12:00' },
    ])
  })

  it('ne rend rien un jour sans plage', () => {
    expect(freeSlotsOn(mardiMatin, [], LUNDI, 30)).toEqual([])
  })

  it('ne rend rien quand la journée est pleine', () => {
    expect(freeSlotsOn(mardiMatin, [pris(MARDI, '09:00', '12:00')], MARDI, 30)).toEqual([])
  })

  it('ignore ce qui est pris un autre jour', () => {
    expect(freeSlotsOn(mardiMatin, [pris(JEUDI, '09:00', '12:00')], MARDI, 30)).toEqual([
      { from: '09:00', to: '12:00' },
    ])
  })
})

describe('la semaine telle qu’on la lit pour poser un rendez-vous', () => {
  it('donne pour chaque jour la plage annoncée, ce qui est pris et ce qui reste', () => {
    const semaine = agendaWeek([LUNDI, MARDI], mardiMatin, [pris(MARDI, '10:00', '10:30', 'Camille')], 30)
    expect(semaine[0]).toEqual({ localDate: LUNDI, windows: [], taken: [], free: [], onLeave: false })
    expect(semaine[1]?.windows).toEqual([{ weekday: 2, from: '09:00', to: '12:00' }])
    expect(semaine[1]?.taken.map((t) => t.label)).toEqual(['Camille'])
    expect(semaine[1]?.free).toEqual([
      { from: '09:00', to: '10:00' },
      { from: '10:30', to: '12:00' },
    ])
  })
})

describe('le créneau proposé', () => {
  const chercher = (options: Partial<Parameters<typeof suggestSlot>[0]> = {}) =>
    suggestSlot({
      windows: mardiEtJeudi,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: LUNDI,
      horizonDays: 21,
      durationMin: 30,
      ...options,
    })

  it('tombe à l’ouverture de la première plage libre', () => {
    expect(chercher()).toEqual({ localDate: MARDI, time: '09:00', matchesPreference: true })
  })

  it('évite ce que l’intervenant a déjà', () => {
    expect(chercher({ practitionerBusy: [pris(MARDI, '09:00', '10:00')] })?.time).toBe('10:00')
  })

  it('évite aussi ce que le patient a déjà — c’est tout l’objet', () => {
    const occupe: BusyEntry[] = [
      { ...pris(MARDI, '09:00', '11:00', 'Atelier cuisine'), kind: 'activity' },
    ]
    expect(chercher({ patientBusy: occupe })?.time).toBe('11:00')
  })

  it('respecte le moment souhaité quand c’est possible', () => {
    expect(chercher({ preference: 'apres-midi' })).toEqual({
      localDate: JEUDI,
      time: '14:00',
      matchesPreference: true,
    })
  })

  it('préfère une place plus tôt à un moment souhaité très lointain', () => {
    /*
      Le mardi matin est pris. Le moment souhaité — le matin — ne revient que le mardi
      suivant, dans huit jours ; le jeudi après-midi est libre dans trois. On propose le
      jeudi, en disant que le matin n'était pas possible : c'est ce qu'un soignant
      proposerait de vive voix.
    */
    const occupe = [pris(MARDI, '09:00', '12:00')]
    expect(chercher({ preference: 'matin', practitionerBusy: occupe })).toEqual({
      localDate: JEUDI,
      time: '14:00',
      matchesPreference: false,
    })
  })

  it('n’existe pas sans plage déclarée', () => {
    expect(chercher({ windows: [] })).toBeNull()
  })

  it('n’existe pas quand tout est pris dans l’horizon regardé', () => {
    const semainePleine = [pris(MARDI, '09:00', '12:00'), pris(JEUDI, '14:00', '17:00')]
    expect(chercher({ practitionerBusy: semainePleine, horizonDays: 6 })).toBeNull()
  })
})

describe('ce que l’écran dit du créneau proposé', () => {
  it('l’annonce simplement quand il convient', () => {
    const message = suggestionMessage(
      { localDate: MARDI, time: '09:00', matchesPreference: true },
      'matin',
      'Mardi 25 août, de 09h00 à 09h30',
    )
    expect(message).toBe('Créneau proposé : Mardi 25 août, de 09h00 à 09h30.')
  })

  it('dit d’abord ce qui n’a pas pu être respecté', () => {
    const message = suggestionMessage(
      { localDate: JEUDI, time: '14:00', matchesPreference: false },
      'matin',
      'Jeudi 27 août, de 14h00 à 14h30',
    )
    expect(message).toContain('Rien de libre le matin dans la semaine qui vient')
    expect(message).toContain('Jeudi 27 août')
  })

  it('ne laisse pas sans réponse quand il n’y a rien', () => {
    const message = suggestionMessage(null, 'peu-importe', '')
    expect(message).toContain('Aucun créneau')
    expect(message).toContain('Vous pouvez tout de même fixer le rendez-vous')
  })
})

/**
 * « Jamais aujourd'hui » — la règle qui manquait du côté de l'agenda croisé.
 *
 * L'acceptation automatique l'appliquait déjà ; la proposition faite à la bulle, non.
 * Elle a donc proposé un rendez-vous le jour même à neuf heures trente, alors qu'il en
 * était quatorze : rien dans ce module ne connaît l'heure qu'il est, et rien ne devrait
 * avoir à la connaître.
 */
describe('le premier jour où l’on propose', () => {
  it('est le lendemain, jamais le jour même', () => {
    expect(firstBookableDay('2026-08-24')).toBe('2026-08-25')
  })

  it('franchit les fins de mois', () => {
    expect(firstBookableDay('2026-08-31')).toBe('2026-09-01')
    expect(firstBookableDay('2026-12-31')).toBe('2027-01-01')
  })

  it('ne propose plus rien aujourd’hui, même si la plage y est libre', () => {
    // Une plage le lundi, et l'on cherche depuis un lundi : la proposition doit sauter
    // au lundi suivant plutôt que d'offrir une heure déjà passée.
    const lundi = '2026-08-24'
    const proposition = suggestSlot({
      windows: [{ weekday: 1, from: '09:00', to: '12:00' }],
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: firstBookableDay(lundi),
      horizonDays: 21,
      durationMin: 30,
    })
    expect(proposition?.localDate).toBe('2026-08-31')
  })
})

/**
 * Le congé se pose par-dessus la semaine type.
 *
 * « Je reçois le mardi de 9 h à 12 h » ne sait pas dire « sauf la semaine du 15 ».
 * Sans cette exception datée, l'application proposait des rendez-vous en pleine absence,
 * et c'est le patient qui l'apprenait devant une porte fermée.
 */
describe('un jour de congé', () => {
  const CONGE = [{ from: MARDI, to: MARDI }]

  it('n’annonce plus aucune plage et ne laisse rien de libre', () => {
    const semaine = agendaWeek([MARDI], mardiMatin, [], 30, CONGE)
    expect(semaine[0]?.onLeave).toBe(true)
    expect(semaine[0]?.windows).toEqual([])
    expect(semaine[0]?.free).toEqual([])
  })

  it('montre quand même ce qui y est déjà pris', () => {
    // C'est justement ce qu'il faut voir avant de déclarer une absence.
    const semaine = agendaWeek([MARDI], mardiMatin, [pris(MARDI, '10:00', '10:30', 'Camille')], 30, CONGE)
    expect(semaine[0]?.taken.map((t) => t.label)).toEqual(['Camille'])
  })

  it('ne change rien aux autres jours', () => {
    const semaine = agendaWeek([MARDI, JEUDI], mardiEtJeudi, [], 30, CONGE)
    expect(semaine[1]?.onLeave).toBe(false)
    expect(semaine[1]?.free.length).toBeGreaterThan(0)
  })

  it('ne reçoit aucune proposition', () => {
    const sans = suggestSlot({
      windows: mardiEtJeudi,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: MARDI,
      horizonDays: 3,
      durationMin: 30,
    })
    expect(sans?.localDate).toBe(MARDI)

    const avec = suggestSlot({
      windows: mardiEtJeudi,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: MARDI,
      horizonDays: 3,
      durationMin: 30,
      leaves: CONGE,
    })
    expect(avec?.localDate).toBe(JEUDI)
  })

  it('sans congé déclaré, la recherche est exactement celle d’avant', () => {
    const reference = suggestSlot({
      windows: mardiEtJeudi,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: MARDI,
      horizonDays: 3,
      durationMin: 30,
    })
    const avecListeVide = suggestSlot({
      windows: mardiEtJeudi,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: MARDI,
      horizonDays: 3,
      durationMin: 30,
      leaves: [],
    })
    expect(avecListeVide).toEqual(reference)
  })
})

describe('les dimanches de changement d’heure', () => {
  /*
    Le dernier dimanche de mars dure vingt-trois heures, celui d'octobre vingt-cinq. Les
    minutes d'occupation se calculaient en soustrayant minuit puis en divisant : tout ce
    qui était déjà pris se décalait d'une heure ces deux jours-là, et l'agenda proposait
    un créneau occupé.
  */
  const plages: AvailabilityWindow[] = [{ weekday: 7, from: '09:00', to: '17:00' }]

  it('place au bon endroit ce qui est pris, le dimanche du passage à l’heure d’hiver', () => {
    // 25 octobre 2026 : 03h00 revient à 02h00. Un rendez-vous de 14h00 à 15h00.
    const pris = {
      start: instantOf('2026-10-25', '14:00'),
      end: instantOf('2026-10-25', '15:00'),
      label: 'Rendez-vous',
      kind: 'appointment' as const,
    }
    const libres = freeSlotsOn(plages, [pris], '2026-10-25', 60)
    // 14h00 ne doit plus être proposé, et 13h00 doit l'être.
    expect(libres.some((t) => t.from <= '14:00' && '15:00' <= t.to)).toBe(false)
    expect(libres.some((t) => t.from <= '13:00' && '14:00' <= t.to)).toBe(true)
  })

  it('fait de même le dimanche du passage à l’heure d’été', () => {
    // 29 mars 2026 : 02h00 saute à 03h00.
    const pris = {
      start: instantOf('2026-03-29', '14:00'),
      end: instantOf('2026-03-29', '15:00'),
      label: 'Rendez-vous',
      kind: 'appointment' as const,
    }
    const libres = freeSlotsOn(plages, [pris], '2026-03-29', 60)
    expect(libres.some((t) => t.from <= '14:00' && '15:00' <= t.to)).toBe(false)
    expect(libres.some((t) => t.from <= '15:00' && '16:00' <= t.to)).toBe(true)
  })
})

/**
 * Trois façons de n'avoir aucun créneau, et elles ne se disent pas de la même manière.
 *
 * Un agenda plein, un agenda jamais rempli, et une personne en congé : l'écran les
 * confondait. « Aucun créneau ne convient aux deux dans les trois semaines qui
 * viennent » laisse chercher un trou, sous vingt et une lignes « 🌴 En congé » qui
 * disaient déjà qu'il n'y en aurait pas.
 */
describe('un agenda vide, et pourquoi', () => {
  const jour = (windows: unknown[], onLeave = false) => ({ windows, onLeave })

  it('ne confond pas « rien déclaré » avec « en congé »', () => {
    // Trois jours ouvrables sans plage, quatre en congé : rien n'a jamais été déclaré.
    const melange = [jour([]), jour([]), jour([]), jour([], true)]
    expect(noAvailabilityDeclared(melange)).toBe(true)
    expect(onLeaveThroughout(melange)).toBe(false)
  })

  it('se tait sur « rien déclaré » quand tout l’horizon est en congé', () => {
    const tout = [jour([], true), jour([], true), jour([], true)]
    expect(noAvailabilityDeclared(tout)).toBe(false)
    expect(onLeaveThroughout(tout)).toBe(true)
  })

  it('ne dit ni l’un ni l’autre quand des plages existent', () => {
    const ouvert = [jour([{ from: '09:00', to: '12:00' }]), jour([], true)]
    expect(noAvailabilityDeclared(ouvert)).toBe(false)
    expect(onLeaveThroughout(ouvert)).toBe(false)
  })

  it('nomme la personne et dit quoi faire', () => {
    const avis = onLeaveThroughoutMessage('Docteur Lemaire')
    expect(avis).toContain('Docteur Lemaire')
    expect(avis).toContain('en congé')
    expect(avis).toContain('Vous pouvez tout de même fixer')
  })
})

/**
 * La garde du soir, du réglage jusqu'au créneau proposé.
 *
 * « 22h00 → 00h00 » avait été rendue enregistrable et affichable, et le test le
 * certifiait — mais il s'arrêtait là. L'agenda, lui, lisait encore la borne de fin comme
 * zéro minute : la fiche annonçait « Reçoit de 22h00 à 00h00 » et l'écran répondait
 * « Plus rien de libre ce jour-là », l'un sous l'autre. Une correction à moitié faite
 * est pire qu'une absente : elle a l'air finie.
 *
 * Ce test part de la plage et va jusqu'au créneau. C'est le seul endroit d'où l'on voit
 * que la chaîne entière tient.
 */
describe('une plage qui finit à minuit, jusqu’au bout', () => {
  // 2026-08-28 est un vendredi.
  const VENDREDI = '2026-08-28'
  const gardeDuSoir: AvailabilityWindow[] = [{ weekday: 5, from: '22:00', to: '00:00' }]

  it('produit de vrais trous libres, et non « plus rien de libre »', () => {
    const libres = freeSlotsOn(gardeDuSoir, [], VENDREDI, 30)
    expect(libres).not.toEqual([])
    expect(libres[0]?.from).toBe('22:00')
    // La borne de fin vaut la fin du jour. « 24:00 » est l'écriture interne ; l'écran,
    // lui, lit « minuit ».
    expect(libres[0]?.to).toBe('24:00')
    expect(formatLocalTime(libres[0]!.to)).toBe('minuit')
  })

  it('propose un créneau qui tient dans la soirée', () => {
    const propose = suggestSlot({
      windows: gardeDuSoir,
      practitionerBusy: [],
      patientBusy: [],
      preference: 'peu-importe',
      from: VENDREDI,
      horizonDays: 1,
      durationMin: 30,
    })
    expect(propose).not.toBeNull()
    expect(propose!.localDate).toBe(VENDREDI)
    expect(propose!.time >= '22:00').toBe(true)
  })

  it('n’annonce pas « aucune plage déclarée » pour quelqu’un qui en a une', () => {
    const semaine = agendaWeek([VENDREDI], gardeDuSoir, [], 30)
    expect(noAvailabilityDeclared(semaine)).toBe(false)
    expect(semaine[0]?.free).not.toEqual([])
  })
})
