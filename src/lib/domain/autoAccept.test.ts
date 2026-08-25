import { describe, expect, it } from 'vitest'
import { findFirstSlot } from './autoAccept'
import type { AvailabilityWindow } from './types'

/**
 * L'acceptation automatique croise deux agendas, pas un seul.
 *
 * Elle ne regardait que celui de l'intervenant : le rendez-vous se posait tranquillement
 * par-dessus l'atelier auquel la personne était inscrite, « Ma semaine » affichait les
 * deux au même moment, et c'est le patient qui devait choisir. Un soignant qui fixe à la
 * main recevait déjà cet agenda ; la machine n'a aucune raison d'être moins prudente.
 *
 * Ces cas sont écrits sur le domaine, et non sur le jeu de démonstration : celui-ci
 * change, et un test qui dépend de ses horaires finit par ne plus rien exercer.
 */
describe('l’acceptation automatique croise l’agenda du patient', () => {
  // Le 24 août 2026 est un lundi.
  const LUNDI = '2026-08-24'
  const plages: AvailabilityWindow[] = [{ weekday: 1, from: '09:00', to: '12:00' }]

  const chercher = (patientBusy: { localDate: string; from: string; to: string }[]) =>
    findFirstSlot({
      windows: plages,
      busy: [],
      patientBusy,
      preference: 'peu-importe',
      from: LUNDI,
      horizonDays: 1,
      durationMin: 30,
    })

  it('ne pose rien sur une activité à laquelle la personne est inscrite', () => {
    const place = chercher([{ localDate: LUNDI, from: '09:00', to: '10:00' }])
    expect(place).not.toBeNull()
    // 09h00 est libre chez l'intervenant, mais pas chez le patient.
    expect(place!.time).toBe('10:00')
  })

  it('prend bien la première heure quand le patient est libre', () => {
    expect(chercher([])!.time).toBe('09:00')
  })

  it('ne propose rien du tout quand le patient est pris toute la plage', () => {
    expect(chercher([{ localDate: LUNDI, from: '09:00', to: '12:00' }])).toBeNull()
  })

  it('ignore ce qui occupe le patient un autre jour', () => {
    expect(chercher([{ localDate: '2026-08-25', from: '09:00', to: '12:00' }])!.time).toBe('09:00')
  })
})
