import { describe, expect, it } from 'vitest'
import {
  appointmentAccessNotice,
  canScheduleAs,
  concernsViewer,
  pendingForViewer,
  seesEveryAppointment,
  visibleAppointments,
} from './appointmentAccess'

const lemaire = { role: 'staff' as const, practitionerId: 'docteur-lemaire' }
const claire = { role: 'staff' as const, practitionerId: 'claire' }
const sansLien = { role: 'staff' as const, practitionerId: null }
const patronne = { role: 'admin' as const, practitionerId: 'marc' }

const agenda = [
  { id: 'a', status: 'scheduled' as const, practitionerId: 'docteur-lemaire' },
  { id: 'b', status: 'scheduled' as const, practitionerId: 'claire' },
  { id: 'c', status: 'requested' as const },
  { id: 'd', status: 'cancelled' as const, practitionerId: 'docteur-lemaire' },
]

describe('ce qu’un intervenant voit de l’agenda', () => {
  it('ses rendez-vous, y compris ceux qu’il a annulés', () => {
    expect(visibleAppointments(lemaire, agenda).map((a) => a.id)).toEqual(['a', 'd'])
  })

  it('jamais ceux d’un collègue', () => {
    expect(concernsViewer(lemaire, agenda[1]!)).toBe(false)
    expect(visibleAppointments(claire, agenda).map((a) => a.id)).toEqual(['b'])
  })

  it('jamais une demande en attente : elle ne nomme encore personne', () => {
    expect(concernsViewer(lemaire, agenda[2]!)).toBe(false)
  })

  it('rien du tout quand le compte n’est relié à personne', () => {
    expect(visibleAppointments(sansLien, agenda)).toEqual([])
    expect(appointmentAccessNotice(sansLien)).toMatch(/relié à aucune personne/)
  })

  it('rien du tout pour qui n’est pas du personnel', () => {
    expect(visibleAppointments({ role: null }, agenda)).toEqual([])
  })
})

describe('ce que l’administrateur voit', () => {
  it('tout, demandes en attente comprises', () => {
    expect(seesEveryAppointment(patronne)).toBe(true)
    expect(visibleAppointments(patronne, agenda)).toHaveLength(4)
  })

  it('et on ne lui explique rien : il n’y a rien à expliquer', () => {
    expect(appointmentAccessNotice(patronne)).toBeNull()
  })
})

describe('au nom de qui on fixe un rendez-vous', () => {
  it('un intervenant, pour lui seul', () => {
    expect(canScheduleAs(lemaire, 'docteur-lemaire')).toBe(true)
    expect(canScheduleAs(lemaire, 'claire')).toBe(false)
    // Sans intervenant nommé, le rendez-vous n'appartiendrait à personne.
    expect(canScheduleAs(lemaire, null)).toBe(false)
  })

  it('l’administrateur, pour n’importe qui — c’est lui qui répartit', () => {
    expect(canScheduleAs(patronne, 'claire')).toBe(true)
    expect(canScheduleAs(patronne, null)).toBe(true)
  })

  it('personne, quand le compte n’est relié à aucun intervenant', () => {
    expect(canScheduleAs(sansLien, 'claire')).toBe(false)
    expect(canScheduleAs(sansLien, null)).toBe(false)
  })
})

describe('le compteur de demandes en attente', () => {
  const intervenants = [
    { id: 'docteur-lemaire', kindId: 'psychiatre' },
    { id: 'claire', kindId: 'kine' },
    { id: 'marc' },
  ]
  const file = [
    { id: 'a', status: 'requested' as const, kindId: 'psychiatre' },
    { id: 'b', status: 'requested' as const, kindId: 'psychiatre' },
    { id: 'c', status: 'requested' as const, kindId: 'kine' },
    { id: 'd', status: 'scheduled' as const, kindId: 'psychiatre', practitionerId: 'docteur-lemaire' },
    { id: 'e', status: 'cancelled' as const, kindId: 'psychiatre' },
  ]

  it('ne compte que ce qui attend encore', () => {
    expect(pendingForViewer(patronne, file, intervenants)).toBe(3)
  })

  it('ne montre à un intervenant que les demandes de son motif', () => {
    expect(pendingForViewer(lemaire, file, intervenants)).toBe(2)
    expect(pendingForViewer(claire, file, intervenants)).toBe(1)
  })

  it('ne compte rien pour un compte sans intervenant, ni pour un intervenant sans motif', () => {
    expect(pendingForViewer(sansLien, file, intervenants)).toBe(0)
    expect(pendingForViewer({ role: 'staff', practitionerId: 'marc' }, file, intervenants)).toBe(0)
  })

  it('ne compte rien quand la file est vide — le compteur doit disparaître', () => {
    expect(pendingForViewer(patronne, [], intervenants)).toBe(0)
  })
})
