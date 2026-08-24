import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { resetWorld, DEMO_PATIENT_UID } from './state'
import { PLANNING_HORIZON_DAYS, bookableSlots } from '../../domain/agenda'

/**
 * « Voir tous les créneaux possibles » ne vaut que si la liste tient sa promesse.
 *
 * Deux choses peuvent la faire mentir, et toutes deux l'ont fait : un agenda rendu sur
 * sept jours quand la proposition en cherche vingt et un, et un découpage qui ne
 * retombe pas sur les heures que la proposition retient. Dans les deux cas on propose un
 * créneau introuvable dans la liste — et l'on ne peut plus en choisir un autre.
 */
describe('la liste de tous les créneaux', () => {
  beforeEach(() => {
    resetWorld()
  })

  const planning = async (durationMin: number) => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app.repository.appointmentPlanning({
      practitionerId: 'docteur-lemaire',
      patientUid: DEMO_PATIENT_UID,
      preference: 'peu-importe',
      durationMin,
    })
  }

  it('porte sur le même horizon que la proposition', async () => {
    const vue = await planning(30)
    expect(vue.week).toHaveLength(PLANNING_HORIZON_DAYS)
  })

  it('contient le créneau proposé', async () => {
    for (const duree of [15, 30, 45, 60]) {
      const vue = await planning(duree)
      expect(vue.suggestion).not.toBeNull()
      const jours = bookableSlots(vue.week, duree)
      const jour = jours.find((j) => j.localDate === vue.suggestion!.localDate)
      expect(jour, `durée ${duree} : le jour proposé manque`).toBeDefined()
      expect(jour!.times, `durée ${duree} : l'heure proposée manque`).toContain(vue.suggestion!.time)
    }
  })

  it('ne propose jamais une heure déjà prise', async () => {
    const vue = await planning(30)
    for (const jour of bookableSlots(vue.week, 30)) {
      const duJour = vue.week.find((j) => j.localDate === jour.localDate)!
      for (const heure of jour.times) {
        const dedans = duJour.free.some((trou) => heure >= trou.from && heure < trou.to)
        expect(dedans, `${jour.localDate} ${heure} tombe hors des trous libres`).toBe(true)
      }
    }
  })
})
