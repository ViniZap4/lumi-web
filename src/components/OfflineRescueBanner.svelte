<script lang="ts">
  // Unsent text taken off the disk by a server-initiated wipe
  // (session.ended, vault.revoked). Held in memory only: download it or
  // discard it. Closing the tab discards it too.
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../lib/offline.svelte.ts';

  const REASON: Record<string, string> = {
    session_ended: 'A sessão foi encerrada pelo servidor',
    revoked: 'O acesso a um livro foi revogado',
    signed_out: 'Você saiu da conta',
  };
</script>

{#each offline.rescues as r (r.id)}
  <div class="rescue" role="alert" data-testid="offline-rescue">
    <span>
      {REASON[r.reason] ?? 'Os dados offline foram apagados'}. {r.items.length}
      {r.items.length === 1 ? 'nota tinha alterações que não chegaram' : 'notas tinham alterações que não chegaram'} ao servidor;
      as cópias deste navegador foram apagadas e o texto está só nesta aba.
    </span>
    <span class="actions">
      <button type="button" class="link-button" onclick={() => downloadText(exportFilename(r.items), bundleMarkdown(r.items))}>Baixar</button>
      <button type="button" class="link-button" onclick={() => offline.dismissRescue(r.id)}>Descartar</button>
    </span>
  </div>
{/each}

<style>
  .rescue {
    position: fixed;
    left: 50%;
    bottom: 1rem;
    transform: translateX(-50%);
    max-width: min(40rem, 92vw);
    z-index: 300;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0.8rem;
    font-size: 0.82rem;
    background: var(--color-background);
    color: var(--color-text);
    border: 1px solid var(--color-warning, var(--color-error));
    border-radius: 6px;
  }
  .actions { display: inline-flex; gap: 0.25rem; white-space: nowrap; }
  .link-button {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
</style>
