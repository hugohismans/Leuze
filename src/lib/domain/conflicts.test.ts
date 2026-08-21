import { describe, expect, it } from 'vitest'
import {
  blockingConflict,
  blockingConflicts,
  conflictsWith,
  describeConflict,
  localDateOfOccurrenceId,
  overlaps,
  patientConflictNotice,
  staffConflictWarning,
  type BusyEntry,
} from './conflicts'
import { instantOf } from './time'

const JOUR = '2026-08-25'
const creneau = (de: string, a: string) => ({ start: instantOf(JOUR, de), end: instantOf(JOUR, a) })

const occupe = (de: string, a: string, label: string, kind: 'activity' | 'appointment'): BusyEntry => ({
  ...creneau(de, a),
  label,
  kind,
})

const rendezVous = occupe('10:00', '10:30', 'Rendez-vous avec le psychiatre', 'appointment')
const atelier = occupe('09:30', '11:00', 'Atelier cuisine', 'activity')

describe('deux créneaux qui se touchent', () => {
  it('se chevauchent dès qu’ils partagent une minute', () => {
    expect(overlaps(creneau('10:00', '11:00'), creneau('10:59', '12:00'))).toBe(true)
    expect(overlaps(creneau('10:00', '11:00'), creneau('09:00', '10:01'))).toBe(true)
  })

  it('ne se chevauchent pas quand ils s’enchaînent bord à bord', () => {
    // Une activité qui finit à 10h00 et un rendez-vous qui commence à 10h00 s'enchaînent.
    expect(overlaps(creneau('09:00', '10:00'), creneau('10:00', '11:00'))).toBe(false)
  })

  it('ne se chevauchent pas quand ils sont loin l’un de l’autre', () => {
    expect(overlaps(creneau('09:00', '10:00'), creneau('14:00', '15:00'))).toBe(false)
  })
})

describe('ce qui gêne un créneau', () => {
  it('est rendu dans l’ordre du temps', () => {
    const trouves = conflictsWith(creneau('09:45', '11:15'), [rendezVous, atelier])
    expect(trouves.map((c) => c.label)).toEqual(['Atelier cuisine', 'Rendez-vous avec le psychiatre'])
  })

  it('ignore ce qui a lieu à un autre moment', () => {
    expect(conflictsWith(creneau('14:00', '15:00'), [rendezVous, atelier])).toEqual([])
  })

  it('désigne le rendez-vous comme ce qui bloque, jamais l’activité', () => {
    expect(blockingConflict([atelier])).toBeNull()
    expect(blockingConflict([atelier, rendezVous])?.label).toBe('Rendez-vous avec le psychiatre')
  })
})

describe('ce que lit le patient', () => {
  it('ne dit rien quand rien ne gêne', () => {
    expect(patientConflictNotice([])).toBeNull()
  })

  it('refuse quand un rendez-vous tombe au même moment, et dit quoi faire', () => {
    const avis = patientConflictNotice([rendezVous])
    expect(avis?.blocking).toBe(true)
    expect(avis?.message).toContain('10h00')
    expect(avis?.message).toContain('Parlez-en à un soignant')
  })

  it('prévient sans refuser quand c’est une autre activité', () => {
    const avis = patientConflictNotice([atelier])
    expect(avis?.blocking).toBe(false)
    expect(avis?.message).toContain('Atelier cuisine')
    expect(avis?.message).toContain('Vous pouvez tout de même vous inscrire')
  })

  it('parle du rendez-vous en priorité quand les deux tombent en même temps', () => {
    expect(patientConflictNotice([atelier, rendezVous])?.blocking).toBe(true)
  })
})

describe('ce que lit le soignant', () => {
  it('ne dit rien quand rien ne gêne', () => {
    expect(staffConflictWarning('Camille', [])).toBeNull()
  })

  it('nomme la personne, liste ce qui tombe en même temps, et demande', () => {
    const message = staffConflictWarning('Camille', [atelier, rendezVous])
    expect(message).toContain('Camille')
    expect(message).toContain('Atelier cuisine, de 09h30 à 11h00')
    expect(message).toContain('Rendez-vous avec le psychiatre, de 10h00 à 10h30')
    expect(message).toContain('Voulez-vous l’inscrire quand même ?')
  })

  it('dit « rendez-vous » quand c’en est un : ce n’est pas la même conversation', () => {
    expect(staffConflictWarning('Hugo', [rendezVous])).toContain('a un rendez-vous')
    expect(staffConflictWarning('Hugo', [atelier])).toContain('est déjà pris')
  })
})

describe('le jour lu dans l’identifiant d’une séance', () => {
  it('se retrouve sans lire la base', () => {
    expect(localDateOfOccurrenceId('atelier-cuisine_20260825T1000')).toBe('2026-08-25')
  })

  it('vaut « rien » quand la forme n’est pas celle attendue', () => {
    expect(localDateOfOccurrenceId('quelque-chose')).toBeNull()
    expect(localDateOfOccurrenceId('activite_2026-08-25T10:00')).toBeNull()
  })

  it('supporte un identifiant d’activité qui contient lui-même un souligné', () => {
    expect(localDateOfOccurrenceId('atelier_du_mardi_20260825T1400')).toBe('2026-08-25')
  })
})

describe('la description d’un créneau occupé', () => {
  it('se lit en français, avec des heures en toutes lettres', () => {
    expect(describeConflict(rendezVous)).toBe('Rendez-vous avec le psychiatre, de 10h00 à 10h30')
  })
})

describe('ce qui justifie de s’arrêter et de demander', () => {
  it('ne retient que les rendez-vous', () => {
    expect(blockingConflicts([atelier, rendezVous])).toEqual([rendezVous])
  })

  it('ne retient rien quand il n’y a que des activités', () => {
    /*
      C'est la règle de la réunion : deux activités qui se recouvrent se voient sur la
      feuille et s'arrangent de vive voix. Demander confirmation à chaque prénom, c'était
      une réunion qui n'avance plus — et un « oui » cliqué sans lire.
    */
    expect(blockingConflicts([atelier])).toEqual([])
  })

  it('ne retient rien quand rien ne gêne', () => {
    expect(blockingConflicts([])).toEqual([])
  })
})
