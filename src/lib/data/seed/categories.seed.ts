import type { Category } from '../../domain/types'

/**
 * L'icône n'est pas décorative : elle double systématiquement la couleur,
 * qui ne doit jamais porter seule une information (exigence §8 du brief).
 */
export const categoriesSeed: Category[] = [
  { id: 'sport', name: 'Sport', icon: '🏃', colorToken: 'sport' },
  { id: 'creatif', name: 'Créatif', icon: '🎨', colorToken: 'creatif' },
  { id: 'culturel', name: 'Culturel', icon: '📚', colorToken: 'culturel' },
  { id: 'relaxation', name: 'Relaxation', icon: '🧘', colorToken: 'relaxation' },
  { id: 'parole', name: 'Groupe de parole', icon: '💬', colorToken: 'parole' },
  { id: 'cuisine', name: 'Cuisine', icon: '🍲', colorToken: 'cuisine' },
  { id: 'musique', name: 'Musique', icon: '🎵', colorToken: 'musique' },
  { id: 'nature', name: 'Nature', icon: '🌿', colorToken: 'nature' },
]
