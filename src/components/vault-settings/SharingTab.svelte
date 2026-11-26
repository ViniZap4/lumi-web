<script lang="ts">
  // Sharing: provenance of a copied book and "Send a copy".
  import { vaults } from '../../lib/vaults.svelte.ts';
  import { fmtDate } from './format.ts';
  import type { VaultSettingsController } from './settings.svelte.ts';

  const { s }: { s: VaultSettingsController } = $props();
</script>

<div class="body" role="tabpanel" id="vs-panel-sharing" aria-labelledby="vs-tab-sharing">
  {#if vaults.selected?.copied_from}
    <p class="hint provenance">
      This vault is a copy of “{vaults.selected.copied_from.slug}”,
      received {fmtDate(vaults.selected.copied_from.copied_at)}.
      It has no live link to the original.
    </p>
  {/if}

  <h3>Send a copy</h3>
  {#if !s.canExport}
    <div class="placeholder">
      You don’t have permission to export this vault.
    </div>
  {:else}
    <p class="hint">
      Forks the vault’s current state into a brand-new vault owned
      by the recipient. They don’t join this vault, and edits on
      either side diverge permanently.
    </p>
    <form class="create-form" onsubmit={s.submitCopy}>
      <label>
        Recipient username
        <input
          class="input"
          type="text"
          placeholder="username on this server"
          bind:value={s.copyUsername}
          disabled={s.copySubmitting}
        />
      </label>
      {#if s.copyError}<div class="error">{s.copyError}</div>{/if}
      <div class="form-actions">
        <button
          class="primary"
          type="submit"
          disabled={s.copySubmitting || !s.copyUsername.trim()}
        >{s.copySubmitting ? '…' : 'Send copy'}</button>
      </div>
    </form>
    {#if s.copySent}
      <div class="success">
        Copy sent — “{s.copySent.name}” ({s.copySent.slug}) now belongs
        to @{s.copySent.recipient}.
      </div>
    {/if}
  {/if}
</div>
