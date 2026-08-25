import { describe, expect, it } from 'vitest'
import {
  agendaWeek,
  bookableSlots,
  freeSlotsOn,
  noAvailabilityDeclared,
  noAvailabilityMessage,
} from './agenda'
import type { LocalDate } from './types'
import { formatLocalTime } from './availability'

const lundi = '2026-08-24' as LocalDate

describe('bookableSlots', () => {
  it('découpe une plage libre à la durée demandée', () => {
    const jours = bookableSlots([{ localDate: lundi, free: [{ from: '09:00', to: '10:00' }] }], 30)
    expect(jours).toEqual([{ localDate: lundi, times: ['09:00', '09:15', '09:30'] }])
  })

  /* Le dernier créneau doit tenir en entier : 09h45 déborderait sur 10h15. */
  it('ne propose pas un créneau qui dépasserait la plage', () => {
    const jours = bookableSlots([{ localDate: lundi, free: [{ from: '09:00', to: '09:40' }] }], 30)
    expect(jours[0]!.times).toEqual(['09:00'])
  })

  it('rend une plage trop courte sans aucun créneau', () => {
    expect(bookableSlots([{ localDate: lundi, free: [{ from: '09:00', to: '09:20' }] }], 30)).toEqual([])
  })

  it('enchaîne plusieurs plages du même jour', () => {
    const jours = bookableSlots(
      [{ localDate: lundi, free: [{ from: '09:00', to: '09:30' }, { from: '14:00', to: '14:30' }] }],
      30,
    )
    expect(jours[0]!.times).toEqual(['09:00', '14:00'])
  })

  it('respecte un pas différent', () => {
    const jours = bookableSlots([{ localDate: lundi, free: [{ from: '09:00', to: '10:00' }] }], 30, 30)
    expect(jours[0]!.times).toEqual(['09:00', '09:30'])
  })

  it('écarte les jours sans aucun créneau', () => {
    const jours = bookableSlots(
      [
        { localDate: lundi, free: [] },
        { localDate: '2026-08-25' as LocalDate, free: [{ from: '09:00', to: '09:30' }] },
      ],
      30,
    )
    expect(jours.map((j) => j.localDate)).toEqual(['2026-08-25'])
  })

  it('refuse une durée ou un pas absurde', () => {
    const semaine = [{ localDate: lundi, free: [{ from: '09:00', to: '12:00' }] }]
    expect(bookableSlots(semaine, 0)).toEqual([])
    expect(bookableSlots(semaine, 30, 0)).toEqual([])
  })

  /*
    Le lien avec le reste : ce que « agendaWeek » déclare libre est exactement ce qui est
    proposé. Sans quoi l'écran offrirait un créneau que le serveur refuserait.
  */
  it("ne propose que des créneaux dans ce qu'agendaWeek déclare libre", () => {
    const semaine = agendaWeek(
      [lundi],
      [{ weekday: 1, from: '09:00', to: '12:00' }],
      [
        {
          start: new Date('2026-08-24T08:00:00Z'), // 10h00 à Bruxelles
          end: new Date('2026-08-24T09:00:00Z'), // 11h00
          label: 'Gymnastique douce',
          kind: 'activity',
        },
      ],
      30,
    )
    const times = bookableSlots(semaine, 30)[0]!.times
    expect(times).toContain('09:00')
    expect(times).toContain('11:00')
    // Rien pendant l'activité, ni à cheval sur elle.
    expect(times).not.toContain('10:00')
    expect(times).not.toContain('09:45')
  })
})

describe('un intervenant qui n’a jamais déclaré de plage', () => {
  const jour = (localDate: string, windows: { from: string; to: string }[]) => ({
    localDate,
    windows,
    taken: [],
    free: [],
  })

  it('se distingue d’un agenda plein', () => {
    expect(noAvailabilityDeclared([jour('2026-08-25', []), jour('2026-08-26', [])])).toBe(true)
    expect(
      noAvailabilityDeclared([jour('2026-08-25', []), jour('2026-08-26', [{ from: '09:00', to: '12:00' }])]),
    ).toBe(false)
  })

  it('ne conclut rien d’une semaine vide : il n’y a rien à conclure', () => {
    expect(noAvailabilityDeclared([])).toBe(false)
  })

  it('dit la vérité, et où déclarer les plages', () => {
    const texte = noAvailabilityMessage('Julien')
    expect(texte).toContain('Julien')
    expect(texte).toContain("n'a déclaré aucune plage")
    expect(texte).toContain('Le personnel')
    // Rien n'est interdit pour autant : une urgence se cale hors des plages.
    expect(texte).toContain("l'heure de votre choix")
  })
})

describe('une garde du soir, qui finit à minuit', () => {
  it('produit de vrais créneaux — pas zéro', () => {
    /*
      La plage était acceptée par l'éditeur, affichée partout, et ne rendait pas un seul
      créneau : la fermeture valait zéro, donc avant l'ouverture. L'écran répondait
      « aucun créneau ne convient aux deux dans les trois semaines qui viennent ».
    */
    // `freeSlotsOn` rend des plages libres ; c'est `bookableSlots` qui les découpe.
    const libres = freeSlotsOn([{ weekday: 1, from: '18:00', to: '00:00' }], [], lundi, 60)
    expect(libres).toEqual([{ from: '18:00', to: '24:00' }])

    const semaine = agendaWeek([lundi], [{ weekday: 1, from: '18:00', to: '00:00' }], [], 60)
    const heures = bookableSlots(semaine, 60)[0]?.times ?? []
    expect(heures.length).toBeGreaterThan(0)
    expect(heures).toContain('18:00')
    // Le dernier créneau d'une heure commence à 23h00 et finit à minuit, pas au-delà.
    expect(heures.at(-1)).toBe('23:00')
  })

  it('ne déborde jamais sur le lendemain', () => {
    const semaine = agendaWeek([lundi], [{ weekday: 1, from: '22:00', to: '00:00' }], [], 60)
    const heures = bookableSlots(semaine, 60)[0]?.times ?? []
    expect(heures.at(-1)).toBe('23:00')
    expect(heures.every((h) => h < '24:00')).toBe(true)
  })

  it('s’écrit « minuit », et jamais « 24h00 »', () => {
    expect(formatLocalTime('24:00')).toBe('minuit')
    expect(formatLocalTime('00:00')).toBe('minuit')
    expect(formatLocalTime('18:00')).toBe('18h00')
  })
})

describe('quelqu’un en congé sur tout l’horizon', () => {
  it('n’est pas confondu avec quelqu’un qui n’a jamais déclaré de plage', () => {
    // Le message envoyait déclarer des plages sur la fiche de quelqu'un qui en avait, et
    // qui était simplement absent — juste au-dessus de sept lignes « En congé ».
    const enConge = [
      { localDate: '2026-08-25', windows: [], onLeave: true, taken: [], free: [] },
      { localDate: '2026-08-26', windows: [], onLeave: true, taken: [], free: [] },
    ]
    expect(noAvailabilityDeclared(enConge)).toBe(false)

    const rienDeclare = [
      { localDate: '2026-08-25', windows: [], onLeave: false, taken: [], free: [] },
      { localDate: '2026-08-26', windows: [], onLeave: true, taken: [], free: [] },
    ]
    expect(noAvailabilityDeclared(rienDeclare)).toBe(true)
  })
})
