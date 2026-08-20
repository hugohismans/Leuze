<script lang="ts">
  import { capacityOf, patientCapacityLabel } from '../domain/capacity'
  import type { Occurrence } from '../domain/types'

  let { occurrence, short = false }: { occurrence: Occurrence; short?: boolean } = $props()

  const state = $derived(capacityOf(occurrence))
  // En colonne étroite (vue semaine), un libellé court reste lisible sans déborder.
  const shortLabels: Record<string, string> = {
    cancelled: 'Annulée',
    'no-registration': 'Entrée libre',
    unlimited: 'Places libres',
    available: 'Places libres',
    'last-places': 'Presque complet',
    full: 'Complet',
  }
  const label = $derived(short ? shortLabels[state.kind]! : patientCapacityLabel(occurrence))
  // L'icône double l'information : la couleur ne la porte jamais seule.
  const icon = $derived(
    state.kind === 'cancelled' ? '✕' : state.kind === 'full' ? '⏳' : state.kind === 'last-places' ? '!' : '✓',
  )
  const tone = $derived(
    state.kind === 'cancelled' || state.kind === 'full' ? 'stop' : state.kind === 'last-places' ? 'warn' : 'ok',
  )
</script>

<span
  class="badge max-w-full"
  style="background: var(--color-{tone}-bg); color: var(--color-{tone}-fg);"
>
  <span aria-hidden="true">{icon}</span>
  <span class="min-w-0 break-words">{label}</span>
</span>
