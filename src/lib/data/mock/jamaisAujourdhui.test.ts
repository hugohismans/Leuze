import { beforeEach, describe, expect, it } from 'vitest'
import { createMockStaffApp } from './index'
import { mockCatalog } from './catalog'
import { resetWorld, DEMO_PATIENT_UID } from './state'
import { addLocalDays, todayLocalDate } from '../../domain/time'

/**
 * L'agenda croisé ne propose jamais le jour même.
 *
 * Ce test naît d'un défaut constaté en service : à quatorze heures, la proposition
 * annonçait « aujourd'hui, de 09h30 à 10h00 ». Rien dans le domaine ne connaît l'heure
 * qu'il est — et rien ne devrait avoir à la connaître : la recherche part de demain,
 * comme le faisait déjà l'acceptation automatique de son côté.
 */
describe("la proposition de créneau", () => {
  beforeEach(() => {
    resetWorld()
    mockCatalog.reset()
  })

  const ouvrir = async () => {
    const app = createMockStaffApp()
    await app.session.signIn('admin@exemple.test', 'peu-importe')
    return app
  }

  it('ne propose pas aujourd’hui, même quand la plage du jour est libre', async () => {
    const aujourdHui = todayLocalDate()
    // Une plage large tous les jours : sans la règle, la proposition tomberait ce matin.
    mockCatalog.savePractitioner({
      id: 'docteur-lemaire',
      name: 'Docteur Lemaire',
      role: 'Psychiatre',
      kindId: 'psychiatre',
      audience: 'all',
      serviceIds: [],
      availability: [1, 2, 3, 4, 5, 6, 7].map((j) => ({
        weekday: j as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        from: '09:00',
        to: '17:00',
      })),
      isActive: true,
    })

    const app = await ouvrir()
    const vue = await app.repository.appointmentPlanning({
      practitionerId: 'docteur-lemaire',
      patientUid: DEMO_PATIENT_UID,
      preference: 'peu-importe',
      durationMin: 30,
    })

    expect(vue.suggestion).not.toBeNull()
    expect(vue.suggestion!.localDate).not.toBe(aujourdHui)
    expect(vue.suggestion!.localDate > aujourdHui).toBe(true)
  })

  it('n’affiche pas non plus aujourd’hui dans la semaine croisée', async () => {
    // Montrer aujourd'hui inviterait à y poser un rendez-vous — ce qu'on veut éviter.
    // « Voir tous les créneaux possibles » découpe cette même semaine : les deux se
    // taisent donc ensemble, sans qu'il y ait deux règles à tenir.
    const app = await ouvrir()
    const vue = await app.repository.appointmentPlanning({
      practitionerId: 'docteur-lemaire',
      patientUid: DEMO_PATIENT_UID,
      preference: 'peu-importe',
      durationMin: 30,
    })
    expect(vue.week.map((j) => j.localDate)).not.toContain(todayLocalDate())
    // Le lendemain, et pas plus loin : on ne perd aucun jour au passage.
    expect(vue.week[0]?.localDate).toBe(addLocalDays(todayLocalDate(), 1))
  })

  it('la semaine reste vue sur trois semaines pleines', async () => {
    const app = await ouvrir()
    const vue = await app.repository.appointmentPlanning({
      practitionerId: 'docteur-lemaire',
      patientUid: DEMO_PATIENT_UID,
      preference: 'peu-importe',
      durationMin: 30,
    })
    expect(vue.week).toHaveLength(21)
  })
})
