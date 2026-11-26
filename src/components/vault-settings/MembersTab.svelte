<script lang="ts">
  // Members: the list, role changes, removal and (for the owner) the transfer of ownership.
  import { auth } from '../../lib/auth.svelte.ts';
  import { vaultMembers } from '../../lib/vaultmembers.svelte.ts';
  import { fmtDate } from './format.ts';
  import type { VaultSettingsController } from './settings.svelte.ts';

  const { s }: { s: VaultSettingsController } = $props();
</script>

<div class="body" role="tabpanel" id="vs-panel-members" aria-labelledby="vs-tab-members">
  {#if s.rowError}<div class="error">{s.rowError}</div>{/if}
  {#if vaultMembers.members.length === 0 && !vaultMembers.loading}
    <div class="placeholder">No members yet.</div>
  {:else}
    <ul class="rows">
      {#each vaultMembers.members as m (m.user_id)}
        <li tabindex="-1" class="row" class:self={m.user_id === auth.user?.id}>
          <div class="row-main">
            <div class="name">
              {m.display_name || m.username}
              {#if m.user_id === s.ownerID}<span class="badge owner">owner</span>{/if}
              {#if m.user_id === auth.user?.id}<span class="badge">you</span>{/if}
            </div>
            <div class="meta">@{m.username} · joined {fmtDate(m.joined_at)}</div>
          </div>
          <div class="row-actions">
            {#if m.user_id === s.ownerID}
              <!-- Owner row: no role-change, no remove. The server
                   would 409 owner_protected anyway; explain instead. -->
              <span
                class="role-readonly"
                title="The vault owner can’t be removed or demoted. Transfer ownership first."
              >{m.role_name} · protected</span>
            {:else}
              {#if s.canManageMembers && vaultMembers.roles.length > 0}
                <select
                  class="select"
                  value={m.role_id}
                  onchange={(e) => s.onChangeRole(m, e)}
                  aria-label="Role"
                >
                  {#each vaultMembers.roles as r (r.id)}
                    <option value={r.id}>{r.name}</option>
                  {/each}
                </select>
              {:else}
                <span class="role-readonly">{m.role_name}</span>
              {/if}
              {#if s.canManageMembers && m.user_id !== auth.user?.id}
                <button
                  type="button"
                  class="link danger"
                  onclick={() => (s.pendingRemove = m)}
                >Remove</button>
              {/if}
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if s.iAmOwner}
    <div class="owner-zone">
      <h3>Transfer ownership</h3>
      <p class="hint">
        Hand this vault to another member. They become the
        protected owner; you keep your current role. This can’t
        be undone without the new owner transferring back.
      </p>
      {#if s.transferCandidates.length === 0}
        <p class="hint">No other members to transfer to — invite someone first.</p>
      {:else}
        <div class="form-actions">
          <select
            class="select"
            bind:value={s.transferTargetID}
            disabled={s.transferSubmitting}
            aria-label="New owner"
          >
            <option value="" disabled>Pick a member…</option>
            {#each s.transferCandidates as m (m.user_id)}
              <option value={m.user_id}>{m.display_name || m.username} (@{m.username})</option>
            {/each}
          </select>
          <button
            class="primary danger"
            type="button"
            disabled={s.transferSubmitting || !s.transferTargetID}
            onclick={s.openTransferConfirm}
          >Transfer…</button>
        </div>
      {/if}
      {#if s.transferError}<div class="error">{s.transferError}</div>{/if}
    </div>
  {/if}
</div>
