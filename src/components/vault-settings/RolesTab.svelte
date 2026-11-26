<script lang="ts">
  // Roles: built-in and custom roles, and the role editor.
  import { vaultMembers } from '../../lib/vaultmembers.svelte.ts';
  import { capsSummary } from './format.ts';
  import type { VaultSettingsController } from './settings.svelte.ts';

  const { s }: { s: VaultSettingsController } = $props();
</script>

<div class="body" role="tabpanel" id="vs-panel-roles" aria-labelledby="vs-tab-roles">
  {#if s.canManageRoles}
    <div class="invite-bar">
      <button class="primary" type="button" onclick={s.openCreateRole}>+ New role</button>
    </div>
  {/if}

  {#if s.roleEditorOpen}
    <form class="create-form" onsubmit={s.submitRoleEditor}>
      <label>
        Role name
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="input"
          type="text"
          bind:value={s.roleEditorName}
          disabled={s.roleEditorSubmitting}
          autofocus
          required
        />
      </label>
      <fieldset class="caps">
        <legend>Capabilities</legend>
        {#each s.capabilityGroups as [group, caps] (group)}
          <div class="cap-group">
            <div class="cap-group-title">{group}</div>
            {#each caps as cap (cap.id)}
              <label class="cap-row">
                <input
                  type="checkbox"
                  checked={s.roleEditorCaps.has(cap.id)}
                  onchange={() => s.toggleCap(cap.id)}
                  disabled={s.roleEditorSubmitting}
                />
                <span class="cap-label">{cap.label}</span>
                <span class="cap-id">{cap.id}</span>
              </label>
            {/each}
          </div>
        {/each}
      </fieldset>
      {#if s.roleEditorError}<div class="error">{s.roleEditorError}</div>{/if}
      <div class="form-actions">
        <button class="primary" type="submit" disabled={s.roleEditorSubmitting || !s.roleEditorName.trim()}>
          {#if s.roleEditorSubmitting}
            …
          {:else if s.editingRoleID == null}
            Create role
          {:else}
            Save changes
          {/if}
        </button>
        <button class="link" type="button" onclick={s.closeRoleEditor} disabled={s.roleEditorSubmitting}>
          Cancel
        </button>
      </div>
    </form>
  {/if}

  {#if s.rowError}<div class="error">{s.rowError}</div>{/if}

  {#if vaultMembers.roles.length === 0}
    <div class="placeholder">No roles defined yet.</div>
  {:else}
    <ul class="rows">
      {#each vaultMembers.roles as r (r.id)}
        <li tabindex="-1" class="row">
          <div class="row-main">
            <div class="name">
              {r.name}
              {#if r.is_seed}<span class="badge">built-in</span>{/if}
            </div>
            <div class="meta">{capsSummary(r.capabilities)}</div>
          </div>
          <div class="row-actions">
            {#if s.canManageRoles && !r.is_seed}
              <button class="link" type="button" onclick={() => s.openEditRole(r)}>Edit</button>
              <button class="link danger" type="button" onclick={() => (s.pendingDeleteRole = r)}>Delete</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !s.canManageRoles}
    <p class="hint" style="margin-top: 0.7rem; text-align: center;">
      You don’t have permission to create or edit roles.
    </p>
  {/if}
</div>
