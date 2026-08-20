<script lang="ts">
  import { audienceLabelForPatient } from '../domain/audience'
  import type { Occurrence } from '../domain/types'

  let { occurrence }: { occurrence: Occurrence } = $props()

  // On ne montre jamais au patient la liste des autres services concernés.
  const label = $derived(audienceLabelForPatient(occurrence))
</script>

{#if label !== null}
  <span class="badge" style="background: var(--color-brand-100); color: var(--color-brand-900);">
    <span aria-hidden="true">👥</span>
    <span class="min-w-0">{label}</span>
  </span>
{/if}
