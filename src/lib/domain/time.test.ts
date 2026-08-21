import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  formatDayLabel,
  formatDuration,
  formatTime,
  formatTimeRange,
  instantOf,
  isoWeekdayOf,
  localDateOf,
  localTimeOf,
  monthGrid,
  startOfIsoWeek,
  weekDays,
} from './time'

describe('temps', () => {
  it('traite lundi comme premier jour de la semaine', () => {
    expect(isoWeekdayOf('2025-08-18')).toBe(1) // lundi
    expect(isoWeekdayOf('2025-08-24')).toBe(7) // dimanche
    expect(startOfIsoWeek('2025-08-24')).toBe('2025-08-18')
    expect(weekDays('2025-08-20')[0]).toBe('2025-08-18')
    expect(weekDays('2025-08-20')[6]).toBe('2025-08-24')
  })

  it('ajoute des jours sans se laisser piéger par le changement d’heure', () => {
    // Nuit du 25 au 26 octobre 2025 : passage à l'heure d'hiver en Belgique.
    expect(addLocalDays('2025-10-25', 1)).toBe('2025-10-26')
    expect(addLocalDays('2025-10-26', 1)).toBe('2025-10-27')
    expect(addLocalDays('2025-03-29', 1)).toBe('2025-03-30')
  })

  it('conserve l’heure murale de part et d’autre du changement d’heure', () => {
    const avant = instantOf('2025-10-21', '14:00') // heure d'été (UTC+2)
    const apres = instantOf('2025-10-28', '14:00') // heure d'hiver (UTC+1)
    expect(formatTime(avant)).toBe('14h00')
    expect(formatTime(apres)).toBe('14h00')
    // Les instants UTC diffèrent bien d'une heure : c'est la preuve que le fuseau est appliqué.
    expect(apres.getTime() - avant.getTime()).toBe(7 * 86_400_000 + 3_600_000)
  })

  it('retrouve le jour local d’un instant', () => {
    // 23h30 à Bruxelles le 20 août = 21h30 UTC le même jour.
    expect(localDateOf(new Date('2025-08-20T21:30:00Z'))).toBe('2025-08-20')
    // 00h30 à Bruxelles le 21 août = 22h30 UTC la veille : le jour local est bien le 21.
    expect(localDateOf(new Date('2025-08-20T22:30:00Z'))).toBe('2025-08-21')
  })

  it('formate en français simple, sans abréviation', () => {
    expect(formatDayLabel('2025-08-19')).toBe('Mardi 19 août')
    expect(formatTimeRange(instantOf('2025-08-19', '14:00'), instantOf('2025-08-19', '15:30'))).toBe(
      '14h00 → 15h30',
    )
    expect(formatDuration(90)).toBe('1 h 30')
    expect(formatDuration(60)).toBe('1 heure')
    expect(formatDuration(45)).toBe('45 minutes')
  })

  it('construit une grille de mois en semaines complètes', () => {
    const grid = monthGrid('2025-08-10')
    expect(grid[0]?.[0]).toBe('2025-07-28') // le mois commence un vendredi
    expect(grid.at(-1)?.at(-1)).toBe('2025-08-31')
    for (const week of grid) expect(week).toHaveLength(7)
  })
})

describe('l’heure locale d’un instant', () => {
  it('se lit à Bruxelles, pas à Greenwich', () => {
    // 12h00 UTC en août, c'est 14h00 à Bruxelles.
    expect(localTimeOf(new Date('2026-08-25T12:00:00Z'))).toBe('14:00')
  })

  it('suit le passage à l’heure d’hiver', () => {
    // Même instant UTC en janvier : une heure de décalage seulement.
    expect(localTimeOf(new Date('2026-01-20T12:00:00Z'))).toBe('13:00')
  })

  it('fait l’aller-retour avec `instantOf`', () => {
    expect(localTimeOf(instantOf('2026-08-25', '09:30'))).toBe('09:30')
  })
})
