<script lang="ts">
  // The confirm dialogs layered over the settings modal.
  import type { VaultSettingsController } from './settings.svelte.ts';

  const { s, onkey }: { s: VaultSettingsController; onkey: (e: KeyboardEvent) => void } = $props();
</script>

{#if s.pendingDeleteRole}
<div
  class="overlay nested"
  role="presentation"
  onclick={() => (s.pendingDeleteRole = null)}
  onkeydown={(e) => { if (e.key === 'Escape') s.pendingDeleteRole = null; }}
>
  <div
    class="panel small"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onkey}
  >
    <h2>Delete role “{s.pendingDeleteRole.name}”?</h2>
    <p class="hint">
      Members assigned to this role will need to be reassigned
      first; the server refuses the delete otherwise. Built-in
      roles can’t be deleted at all.
    </p>
    <div class="form-actions">
      <button class="primary danger" type="button" onclick={s.confirmDeleteRole}>Delete</button>
      <button class="link" type="button" onclick={() => (s.pendingDeleteRole = null)}>Cancel</button>
    </div>
  </div>
</div>
{/if}

{#if s.pendingTransfer}
<div
  class="overlay nested"
  role="presentation"
  onclick={() => (s.pendingTransfer = null)}
  onkeydown={(e) => { if (e.key === 'Escape') s.pendingTransfer = null; }}
>
  <div
    class="panel small"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onkey}
  >
    <h2>Transfer ownership to {s.pendingTransfer.display_name || s.pendingTransfer.username}?</h2>
    <p class="hint">
      @{s.pendingTransfer.username} becomes the vault’s protected
      owner — they can’t be removed or demoted, and only they can
      transfer ownership after this. You keep your current role.
    </p>
    <div class="form-actions">
      <button
        class="primary danger"
        type="button"
        disabled={s.transferSubmitting}
        onclick={s.confirmTransfer}
      >{s.transferSubmitting ? '…' : 'Transfer ownership'}</button>
      <button
        class="link"
        type="button"
        disabled={s.transferSubmitting}
        onclick={() => (s.pendingTransfer = null)}
      >Cancel</button>
    </div>
  </div>
</div>
{/if}

{#if s.pendingRevokeFederation}
<div
  class="overlay nested"
  role="presentation"
  onclick={() => (s.pendingRevokeFederation = null)}
  onkeydown={(e) => { if (e.key === 'Escape') s.pendingRevokeFederation = null; }}
>
  <div
    class="panel small"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onkey}
  >
    <h2>Revoke federation with {s.pendingRevokeFederation.peer_url}?</h2>
    <p class="hint">
      Syncing stops, and this vault will no longer send updates to
      that server. Be aware: <strong>the other server keeps the
      copy of the vault it already has</strong> — it was trusted
      with plaintext, and revoking the link can’t reach into
      another operator’s infrastructure to delete it.
    </p>
    <div class="form-actions">
      <button
        class="primary danger"
        type="button"
        disabled={s.fedRevokeSubmitting}
        onclick={s.confirmRevokeFederation}
      >{s.fedRevokeSubmitting ? '…' : 'Revoke federation'}</button>
      <button
        class="link"
        type="button"
        disabled={s.fedRevokeSubmitting}
        onclick={() => (s.pendingRevokeFederation = null)}
      >Cancel</button>
    </div>
  </div>
</div>
{/if}

{#if s.pendingRemoveFedMember}
<div
  class="overlay nested"
  role="presentation"
  onclick={() => (s.pendingRemoveFedMember = null)}
  onkeydown={(e) => { if (e.key === 'Escape') s.pendingRemoveFedMember = null; }}
>
  <div
    class="panel small"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onkey}
  >
    <h2>Remove {s.pendingRemoveFedMember.member_key}?</h2>
    <p class="hint">
      The revocation is authored here and propagated to follower
      servers; they’ll lose access once their server applies it.
    </p>
    <div class="form-actions">
      <button class="primary danger" type="button" onclick={s.confirmRemoveFedMember}>Remove</button>
      <button class="link" type="button" onclick={() => (s.pendingRemoveFedMember = null)}>Cancel</button>
    </div>
  </div>
</div>
{/if}

{#if s.pendingRemove}
<div
  class="overlay nested"
  role="presentation"
  onclick={() => (s.pendingRemove = null)}
  onkeydown={(e) => { if (e.key === 'Escape') s.pendingRemove = null; }}
>
  <div
    class="panel small"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onkey}
  >
    <h2>Remove {s.pendingRemove.display_name || s.pendingRemove.username}?</h2>
    <p class="hint">
      They’ll lose access to this vault immediately. Their notes
      remain (they were never the only owner of CRDT updates).
    </p>
    <div class="form-actions">
      <button class="primary danger" type="button" onclick={s.confirmRemove}>Remove</button>
      <button class="link" type="button" onclick={() => (s.pendingRemove = null)}>Cancel</button>
    </div>
  </div>
</div>
{/if}
