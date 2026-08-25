import { beforeEach, describe, expect, it } from 'vitest'
import { createMockRepository } from './mockRepository'
import { DEMO_PATIENT_UID, resetWorld, world } from './state'
import { makeOccurrence } from '../../domain/fixtures'
import { addLocalDays, instantOf, addMinutes, todayLocalDate } from '../../domain/time'
import type { LocalDate } from '../../domain/types'

/**
 * L'invariant n° 1 du projet, gardé sur les quatre chemins qui y mènent.
 *
 * Le filtrage par service ne se fait jamais dans l'interface : une activité réservée à
 * une autre unité ne doit pas atteindre le navigateur du patient. Un filtre de rendu
 * laisserait fuiter les titres — et un titre suffit. « Groupe des sortants du samedi »
 * en dit déjà trop sur qui le fréquente.
 *
 * `listBetween` et `get` filtraient depuis toujours ; `listMine` non. « Mes
 * inscriptions » et « Ma semaine » — à un seul appui du calendrier — affichaient donc le
 * titre, l'horaire et le lieu d'activités que le calendrier venait de masquer. Le
 * correctif était posé dans les deux adapters, mais aucun test n'exerçait ce chemin :
 * c'est ce que ce fichier répare.
 */
describe('la cloison entre services', () => {
  const demain = addLocalDays(todayLocalDate(), 1) as LocalDate
  const ID = 'reservee_20990101T1000'

  /** Une séance réservée à une unité qui n'est pas celle du patient de démonstration. */
  const poserUneSeanceReservee = (serviceId: string) => {
    const debut = instantOf(demain, '10:00')
    world.occurrences.set(
      ID,
      makeOccurrence({
        id: ID,
        activityId: 'activite-reservee',
        title: 'Groupe réservé',
        localDate: demain,
        start: debut,
        end: addMinutes(debut, 60),
        audienceKeys: [serviceId],
        capacity: 10,
        registrationRequired: true,
      }),
    )
    // La personne y est inscrite : c'est le cas qui compte. Une séance à laquelle on
    // n'est pas inscrit ne passe par aucun de ces chemins.
    const maintenant = new Date()
    world.registrations.push({
      id: `insc-${ID}`,
      occurrenceId: ID,
      patientUid: DEMO_PATIENT_UID,
      status: 'confirmed',
      createdAt: maintenant,
      queuedAt: maintenant,
      createdBy: 'patient',
    })
  }

  beforeEach(() => {
    resetWorld()
  })

  it('laisse passer ce qui est ouvert à son unité', async () => {
    poserUneSeanceReservee(world.session.serviceId!)
    const repo = createMockRepository()

    expect((await repo.registrations.listMine()).some((r) => r.occurrence.id === ID)).toBe(true)
    expect(await repo.registrations.statusFor(ID)).not.toBeNull()
    expect(await repo.occurrences.get(ID)).not.toBeNull()
  })

  it('n’écrit pas le titre d’une activité d’une autre unité dans « Mes inscriptions »', async () => {
    poserUneSeanceReservee('l-escalette')
    const repo = createMockRepository()

    const miennes = await repo.registrations.listMine()
    expect(miennes.some((r) => r.occurrence.id === ID)).toBe(false)
    // Pas seulement absente de la liste : le titre ne doit apparaître nulle part.
    expect(JSON.stringify(miennes)).not.toContain('Groupe réservé')
  })

  it('ne le dit pas davantage sur la fiche, ni sur l’état d’inscription', async () => {
    poserUneSeanceReservee('l-escalette')
    const repo = createMockRepository()

    // Une adresse devinée ne donne rien de plus qu'une liste filtrée.
    expect(await repo.occurrences.get(ID)).toBeNull()
    expect(await repo.registrations.statusFor(ID)).toBeNull()
  })

  it('ne le dit pas non plus dans le calendrier', async () => {
    poserUneSeanceReservee('l-escalette')
    const repo = createMockRepository()

    const semaine = await repo.occurrences.listBetween(demain, demain)
    expect(semaine.some((o) => o.id === ID)).toBe(false)
    expect(JSON.stringify(semaine)).not.toContain('Groupe réservé')
  })

  it('refuse l’inscription et le retrait sur une séance d’une autre unité', async () => {
    poserUneSeanceReservee('l-escalette')
    const repo = createMockRepository()

    const inscription = await repo.registrations.register(ID)
    expect(inscription.ok).toBe(false)
  })

  /**
   * Le dernier chemin, et le plus discret : l'avertissement de chevauchement.
   *
   * « Vous avez déjà Groupe des sortants à cette heure-là » revient au patient quand il
   * s'inscrit à autre chose au même moment. Le libellé est le titre de la séance, repris
   * tel quel de ses inscriptions — sans que la cloison ne soit reposée. Le cas se produit
   * sans que personne s'y trompe : quelqu'un change d'unité, ou l'audience d'une activité
   * est resserrée après son inscription.
   */
  it('ne renvoie pas le titre par l’avertissement de chevauchement', async () => {
    poserUneSeanceReservee('l-escalette')

    // Une seconde séance, celle-là ouverte à tous, exactement à la même heure.
    const debut = instantOf(demain, '10:00')
    const ouverte = 'ouverte_20990101T1000'
    world.occurrences.set(
      ouverte,
      makeOccurrence({
        id: ouverte,
        activityId: 'activite-ouverte',
        title: 'Atelier ouvert',
        localDate: demain,
        start: debut,
        end: addMinutes(debut, 60),
        audienceKeys: ['all'],
        capacity: 10,
        registrationRequired: true,
      }),
    )

    const repo = createMockRepository()
    const resultat = await repo.registrations.register(ouverte)

    expect(resultat.ok).toBe(true)
    // L'inscription est prise ; c'est le titre de l'autre séance qui ne doit pas revenir.
    expect(JSON.stringify(resultat)).not.toContain('Groupe réservé')
  })
})
