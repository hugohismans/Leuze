/**
 * Le terrain des tests de l'adapter de démonstration.
 *
 * Le monde de démonstration est semé **relativement à la date du jour** : des activités
 * de la semaine, des inscriptions déjà prises, des rendez-vous. C'est ce qu'il faut pour
 * une démonstration, et c'est un piège pour un test.
 *
 * Un test qui prend « la première séance à venir » ne prend pas la même d'un jour à
 * l'autre. Tôt ou tard il tombe sur une séance à laquelle le semis a déjà inscrit
 * quelqu'un, ou qui chevauche un rendez-vous semé — et il échoue pour une raison qui
 * n'a rien à voir avec ce qu'il vérifie. C'est arrivé deux fois, à des semaines
 * d'intervalle, et à chaque fois la même demi-journée perdue à chercher un défaut qui
 * n'existait pas.
 *
 * D'où ces deux fonctions, ici plutôt que recopiées dans chaque fichier. Elles l'étaient
 * dans deux d'entre eux ; les deux autres ne les avaient pas, et ce sont ceux-là qui ont
 * cassé. Une règle qu'on recopie est une règle qu'on oublie.
 */
import { todayLocalDate } from '../../domain/time'
import { world } from './state'

/**
 * Efface ce que le semis a posé : inscriptions, rendez-vous, compteurs.
 *
 * Les compteurs comptent : `capacityOf` lit le nombre écrit sur la séance, et non les
 * inscriptions. Vider les unes sans remettre les autres à zéro laisse une séance qui se
 * croit pleine sans que personne n'y soit.
 */
export function terrainDegage(): void {
  world.registrations = []
  world.appointments = []
  for (const [id, occurrence] of world.occurrences) {
    world.occurrences.set(id, {
      ...occurrence,
      confirmedCount: 0,
      waitlistCount: 0,
      spectatorCount: 0,
    })
  }
}

/** Une séance à venir, ouverte à tous — donc au patient de démonstration. */
export function seanceAVenir() {
  const aujourdHui = todayLocalDate()
  return [...world.occurrences.values()]
    .filter((o) => o.localDate > aujourdHui && o.status !== 'cancelled')
    .filter((o) => o.audienceKeys.includes('all'))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]!
}
