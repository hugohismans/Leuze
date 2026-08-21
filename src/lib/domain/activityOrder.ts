/**
 * L'ordre de la liste des activités.
 *
 * Elle était classée par titre. C'est l'ordre d'un dictionnaire, pas celui d'un service :
 * on cherche « ce qui vient » bien plus souvent que « ce qui commence par A ». Le
 * programme se refaisant chaque semaine, la question posée à cet écran est presque
 * toujours « qu'est-ce qui est prévu, et dans quel ordre ».
 *
 * Ce qui vient d'abord, donc, du plus proche au plus lointain ; ce qui est passé ensuite,
 * du plus récent au plus ancien — une activité terminée hier intéresse encore, celle du
 * mois dernier beaucoup moins. Une activité sans date du tout ferme la marche : elle
 * n'est nulle part dans le temps, elle ne peut être qu'à la fin.
 *
 * Une activité hebdomadaire revient chaque semaine : sa « prochaine fois » est la
 * première date qui tombe encore dans sa règle, à partir d'aujourd'hui.
 */
import { addLocalDays, isoWeekdayOf } from './time'
import type { Activity, LocalDate } from './types'

/**
 * La prochaine date à laquelle cette activité a lieu, à partir du jour donné — ou sa
 * dernière date passée si elle n'a plus lieu. `null` quand elle n'a aucune date.
 */
export function nextDate(activity: Activity, today: LocalDate): LocalDate | null {
  const regle = activity.recurrence
  if (regle === null) return activity.singleStart?.date ?? null
  if (regle.byWeekday.length === 0) return null

  /*
    Sept jours suffiraient à retrouver n'importe quel jour de la semaine — mais pas à
    dépasser des congés : une série arrêtée trois semaines n'a sa prochaine date qu'après.
    On regarde donc deux mois, la durée de la fenêtre de génération. Au-delà, une activité
    n'a plus de « prochaine fois » utile à afficher, et elle ferme la marche.
  */
  const depart = regle.from > today ? regle.from : today
  for (let i = 0; i < 63; i += 1) {
    const jour = addLocalDays(depart, i)
    if (regle.until !== null && jour > regle.until) return null
    if (regle.skipDates.includes(jour)) continue
    if (regle.byWeekday.includes(isoWeekdayOf(jour))) return jour
  }
  return null
}

/** Ce qui sert au tri : à venir d'abord, puis le passé du plus récent au plus ancien. */
function rang(activity: Activity, today: LocalDate): { groupe: number; cle: string } {
  const date = nextDate(activity, today)
  if (date === null) return { groupe: 2, cle: '' }
  // Une date à venir se trie telle quelle ; une date passée se trie à l'envers, ce qu'on
  // obtient en gardant le groupe séparé et en inversant la comparaison plus bas.
  return date >= today ? { groupe: 0, cle: date } : { groupe: 1, cle: date }
}

/**
 * Trie les activités dans l'ordre du temps. À date égale, le titre départage — sans quoi
 * deux activités du même jour changeraient de place d'un affichage à l'autre.
 */
export function byChronology(activities: Activity[], today: LocalDate): Activity[] {
  return [...activities].sort((a, b) => {
    const ra = rang(a, today)
    const rb = rang(b, today)
    if (ra.groupe !== rb.groupe) return ra.groupe - rb.groupe
    if (ra.cle !== rb.cle) {
      // Le passé se lit du plus récent au plus ancien : la comparaison s'y inverse.
      return ra.groupe === 1 ? rb.cle.localeCompare(ra.cle) : ra.cle.localeCompare(rb.cle)
    }
    return a.title.localeCompare(b.title, 'fr')
  })
}
