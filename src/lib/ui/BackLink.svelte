<script lang="ts">
  import { navigate } from '../router.svelte'

  let { label = 'Retour au calendrier', to = '/' }: { label?: string; to?: string } = $props()
</script>

<!-- Le bouton « Retour » est toujours présent et toujours au même endroit. -->
<div class="mx-auto max-w-5xl px-4 pt-4">
  <button type="button" class="btn btn-secondary" onclick={() => navigate(to)}>
    <span aria-hidden="true">←</span>
    <span>{label}</span>
  </button>
</div>
