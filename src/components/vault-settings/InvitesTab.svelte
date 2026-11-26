<script lang="ts">
  // Invites: active and past invite links, and the create form.
  import { vaultMembers } from '../../lib/vaultmembers.svelte.ts';
  import { fmtDate, isInviteActive, inviteStateLabel } from './format.ts';
  import type { VaultSettingsController } from './settings.svelte.ts';

  const { s }: { s: VaultSettingsController } = $props();
</script>

<div class="body" role="tabpanel" id="vs-panel-invites" aria-labelledby="vs-tab-invites">
  {#if !s.canInvite}
    <div class="placeholder">
      You don’t have permission to manage invites for this vault.
    </div>
  {:else}
    <div class="invite-bar">
      <button class="primary" type="button" onclick={s.openCreateForm}>+ New invite</button>
      {#if s.lastCreatedURL}
        <div class="created-row">
          <input class="select" readonly value={s.lastCreatedURL} />
          <button class="link" type="button" onclick={() => s.copyURL(s.lastCreatedURL!)}>
            {Date.now() - s.copiedAt < 2000 ? 'Copied!' : 'Copy'}
          </button>
        </div>
      {/if}
    </div>

    {#if s.createOpen}
      <form class="create-form" onsubmit={s.submitInvite}>
        <div class="form-row">
          <label>
            Role
            <select class="select" bind:value={s.inviteRoleID} disabled={s.inviteSubmitting}>
              {#each vaultMembers.roles as r (r.id)}
                <option value={r.id}>{r.name}</option>
              {/each}
            </select>
          </label>
          <label>
            Max uses
            <input
              class="input"
              type="number"
              min="1"
              max="1000"
              bind:value={s.inviteMaxUses}
              disabled={s.inviteSubmitting}
            />
          </label>
          <label>
            Expires at
            <input
              class="input"
              type="datetime-local"
              bind:value={s.inviteExpiresAt}
              disabled={s.inviteSubmitting}
            />
          </label>
        </div>
        <label>
          Email hint (optional)
          <input
            class="input"
            type="text"
            placeholder="alice@example.com"
            bind:value={s.inviteEmailHint}
            disabled={s.inviteSubmitting}
          />
        </label>
        {#if s.inviteError}<div class="error">{s.inviteError}</div>{/if}
        <div class="form-actions">
          <button class="primary" type="submit" disabled={s.inviteSubmitting || !s.inviteRoleID}>
            {s.inviteSubmitting ? '…' : 'Create invite'}
          </button>
          <button class="link" type="button" onclick={s.closeCreateForm} disabled={s.inviteSubmitting}>
            Cancel
          </button>
        </div>
      </form>
    {/if}

    {#if s.rowError}<div class="error">{s.rowError}</div>{/if}

    {#if vaultMembers.invites.length === 0}
      <div class="placeholder">No invites yet.</div>
    {:else}
      <ul class="rows">
        {#each vaultMembers.invites as inv (inv.token)}
          <li tabindex="-1" class="row" class:inactive={!isInviteActive(inv)}>
            <div class="row-main">
              <div class="name">
                <span class="badge state-{inviteStateLabel(inv)}">{inviteStateLabel(inv)}</span>
                {inv.email_hint || '(no email hint)'}
              </div>
              <div class="meta">
                {inv.use_count}/{inv.max_uses} uses · expires {fmtDate(inv.expires_at)} · created {fmtDate(inv.created_at)}
              </div>
            </div>
            <div class="row-actions">
              {#if isInviteActive(inv)}
                <button class="link danger" type="button" onclick={() => s.onRevoke(inv)}>Revoke</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
