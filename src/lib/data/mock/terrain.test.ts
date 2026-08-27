/**
 * Le terrain fait ce qu'il annonce — et personne ne l'oublie.
 *
 * Deux fichiers de tests prenaient « la première séance à venir » sans avoir effacé ce
 * que le semis de démonstration avait posé. Tant que la date du jour tombait bien, ils
 * passaient ; le jour où la première séance à venir s'est trouvée être une de celles où
 * le semis inscrit déjà quelqu'un, sept cas ont échoué d'un coup — pour une raison
 * étrangère à ce qu'ils vérifient, et sur un dépôt où la publication lance les tests.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorld, world } from './state'
import { seanceAVenir, terrainDegage } from './terrain'
import { todayLocalDate } from './../../domain/time'

const ICI = dirname(fileURLToPath(import.meta.url))

describe('terrainDegage', () => {
  beforeEach(() => {
    resetWorld()
  })

  it('efface les inscriptions et les rendez-vous semés', () => {
    resetWorld()
    // Le semis en pose : sans cela, ce test ne vérifierait rien.
    expect(world.registrations.length + world.appointments.length).toBeGreaterThan(0)
    terrainDegage()
    expect(world.registrations).toEqual([])
    expect(world.appointments).toEqual([])
  })

  it('remet les compteurs à zéro, et pas seulement les lignes', () => {
    /*
      « capacityOf » lit le nombre écrit sur la séance, pas les inscriptions. Vider les
      unes sans remettre les autres laisserait une séance qui se croit pleine sans que
      personne n'y soit — et le refus qui va avec, incompréhensible.
    */
    terrainDegage()
    for (const occurrence of world.occurrences.values()) {
      expect(occurrence.confirmedCount).toBe(0)
      expect(occurrence.waitlistCount).toBe(0)
      expect(occurrence.spectatorCount ?? 0).toBe(0)
    }
  })
})

describe('seanceAVenir', () => {
  it('rend une séance réellement à venir, et ouverte à tous', () => {
    resetWorld()
    const seance = seanceAVenir()
    expect(seance).toBeDefined()
    expect(seance.localDate > todayLocalDate()).toBe(true)
    expect(seance.audienceKeys).toContain('all')
    expect(seance.status).not.toBe('cancelled')
  })
})

describe('la règle, dans tous les fichiers qui la suivent', () => {
  it('qui prend une séance du semis dégage le terrain', () => {
    /*
      Une règle qu'on recopie est une règle qu'on oublie : elle l'a été deux fois. Ce
      contrôle lit les fichiers voisins, parce qu'aucun test de comportement ne peut dire
      « il en manque un » — celui qui manque se comporte normalement tant que la date
      tombe bien.
    */
    const oublis: string[] = []
    for (const nom of readdirSync(ICI).filter((f) => f.endsWith('.test.ts') && f !== 'terrain.test.ts')) {
      const source = readFileSync(resolve(ICI, nom), 'utf8')
      if (source.includes('seanceAVenir(') && !source.includes('terrainDegage()')) {
        oublis.push(nom)
      }
    }
    expect(oublis, 'ces fichiers prennent une séance semée sans dégager le terrain').toEqual([])
  })
})
