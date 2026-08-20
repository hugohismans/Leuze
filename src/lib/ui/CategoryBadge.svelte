<script lang="ts">
  import type { Category } from '../domain/types'

  /**
   * `iconOnly` : en colonne étroite (vue semaine), seule l'icône est affichée.
   * Le nom reste lu par les lecteurs d'écran — l'information n'est jamais
   * portée par la couleur, mais par l'icône et le texte accessible.
   */
  let {
    category,
    size = 'normal',
    iconOnly = false,
  }: { category: Category | null; size?: 'normal' | 'large'; iconOnly?: boolean } = $props()
  const token = $derived(category?.colorToken ?? 'defaut')
</script>

<span
  class="badge"
  class:text-lg={size === 'large'}
  style="background: var(--cat-{token}-bg, var(--cat-defaut-bg)); color: var(--cat-{token}-fg, var(--cat-defaut-fg));"
>
  <span aria-hidden="true">{category?.icon ?? '•'}</span>
  <span class:sr-only={iconOnly}>{category?.name ?? 'Activité'}</span>
</span>
