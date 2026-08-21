<script lang="ts">
  import { impersonation } from '../impersonation.svelte'
  import { bannerLabel } from '../domain/impersonation'

  /**
   * Le bandeau du détour. Il est volontairement voyant, et il ne se ferme pas : se croire
   * chez soi alors qu'on est à la place d'un patient serait la pire des confusions.
   *
   * Il s'affiche partout — écran patient comme espace soignant — parce qu'on peut
   * justement prendre la place d'un patient et se retrouver hors de l'espace soignant.
   */
  let busy = $state(false)

  async function revenir(): Promise<void> {
    if (busy) return
    busy = true
    await impersonation.stop()
  }
</script>

{#if impersonation.detour !== null}
  <div role="status" class="bandeau">
    <p class="phrase">
      <span aria-hidden="true">👁️</span>
      {bannerLabel(impersonation.detour)}
    </p>
    <button type="button" class="btn btn-secondary" onclick={revenir} disabled={busy}>
      {busy ? 'Un instant…' : 'Revenir à mon compte'}
    </button>
  </div>
{/if}

<style>
  /*
    Jaune franc, texte très foncé : le contraste dépasse 12:1, et la bande ne ressemble à
    aucun autre élément de l'application. On la reconnaît sans la lire.
  */
  .bandeau {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: #fde047;
    border-bottom: 4px solid #a16207;
    color: #1c1917;
  }
  .phrase {
    font-size: 1.125rem;
    font-weight: 700;
  }
  .bandeau :global(.btn) {
    background: #ffffff;
    border-color: #1c1917;
    color: #1c1917;
  }

  /* À l'impression, le détour n'a rien à faire sur la feuille du patient. */
  @media print {
    .bandeau {
      display: none;
    }
  }
</style>
