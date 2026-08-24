import { describe, expect, it } from 'vitest'
import { agendaWeek, bookableSlots } from './agenda'
import type { LocalDate } from './types'

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
