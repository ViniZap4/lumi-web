<script lang="ts">
  // Tabbed settings modal for the active vault. Two sections today:
  // Members (list, role change, remove) and Invites (list, create,
  // revoke). Roles are read-only here — the dropdown surfaces them
  // for member-role changes and invite creation, but custom-role
  // CRUD is a later polish slice.
  //
  // Capability gating: we read the current user's row from the
  // members list and pre-hide affordances they can't use. The server
  // is the source of truth either way (it will reject without the
  // capability), so this is purely UX.

  import { onMount, onDestroy } from 'svelte';
  import { auth } from '../lib/auth.svelte.ts';
  import { vaults } from '../lib/vaults.svelte.ts';
  import {
    vaultMembers,
    type CreateInviteInput,
    type CreateRoleInput,
    type UpdateRoleInput,
  } from '../lib/vaultmembers.svelte.ts';
  import { ApiError, type Invite, type RemoteMember, type RemoteRole } from '../lib/types.ts';
  import { CAPABILITY_CATALOGUE, hasCapability } from '../lib/capabilities.ts';

  interface Props { onclose: () => void; }
  const { onclose }: Props = $props();

  type Tab = 'members' | 'invites' | 'roles' | 'sharing';
  let tab = $state<Tab>('members');

  // ---- capability gates (UX only — server still enforces) ----
  //
  // Use the wildcard-aware hasCapability so an Admin (role granted `*`)
  // sees every affordance. Previous slice used raw .includes() with
  // misspelled namespace strings — neither one worked for admins.
  let myCaps = $derived(vaultMembers.capabilitiesOf(auth.user?.id));
  let canManageMembers = $derived(hasCapability(myCaps, 'members.manage'));
  let canInvite = $derived(hasCapability(myCaps, 'members.invite'));
  let canManageRoles = $derived(hasCapability(myCaps, 'roles.manage'));
  let canExport = $derived(hasCapability(myCaps, 'vault.export'));

  // ---- ownership (v3 Phase O) ----
  //
  // The owner badge + guards compare member user_ids to the vault DTO's
  // owner_user_id; the transfer section only renders for the owner.
  let ownerID = $derived(vaults.selectedOwnerID);
  let iAmOwner = $derived(vaults.isOwner(auth.user?.id));
  let transferCandidates = $derived(
    vaultMembers.members.filter((m) => m.user_id !== ownerID),
  );

  // ---- per-row error feedback ----
  let rowError = $state<string | null>(null);
  let pendingRemove = $state<RemoteMember | null>(null);
  let pendingDeleteRole = $state<RemoteRole | null>(null);

  // ---- transfer-ownership state ----
  let transferTargetID = $state<string>('');
  let pendingTransfer = $state<RemoteMember | null>(null);
  let transferSubmitting = $state(false);
  let transferError = $state<string | null>(null);

  // ---- send-a-copy state ----
  let copyUsername = $state('');
  let copySubmitting = $state(false);
  let copyError = $state<string | null>(null);
  let copySent = $state<{ name: string; slug: string; recipient: string } | null>(null);

  // ---- role-editor state (used by Roles tab) ----
  let roleEditorOpen = $state(false);
  let editingRoleID = $state<string | null>(null); // null = creating
  let roleEditorName = $state('');
  let roleEditorCaps = $state<Set<string>>(new Set());
  let roleEditorSubmitting = $state(false);
  let roleEditorError = $state<string | null>(null);

  // Group catalogue entries for the editor UI.
  const capabilityGroups = (() => {
    const groups: Record<string, typeof CAPABILITY_CATALOGUE> = {};
    for (const c of CAPABILITY_CATALOGUE) {
      (groups[c.group] ||= []).push(c);
    }
    return Object.entries(groups);
  })();

  // ---- create-invite form state ----
  let createOpen = $state(false);
  let inviteRoleID = $state<string>('');
  let inviteMaxUses = $state<number>(1);
  let inviteExpiresAt = $state<string>(defaultExpiresAtInputValue());
  let inviteEmailHint = $state('');
  let inviteSubmitting = $state(false);
  let inviteError = $state<string | null>(null);
  let lastCreatedURL = $state<string | null>(null);
  let copiedAt = $state<number>(0);

  function defaultExpiresAtInputValue(): string {
    // 7 days from now, formatted for <input type="datetime-local">
    // which expects local time without a Z suffix.
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Pre-select the first role for the invite form once roles load.
  $effect(() => {
    if (!inviteRoleID && vaultMembers.roles.length > 0) {
      inviteRoleID = vaultMembers.roles[0].id;
    }
  });

  // Hydrate when the modal mounts.
  onMount(() => {
    void vaultMembers.openVault(vaults.selectedID);
    window.addEventListener('keydown', handleKey);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    // Don't clear() here — other consumers may still render off this
    // store. Refreshes are explicit.
  });

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pendingRemove) {
        pendingRemove = null;
        return;
      }
      if (pendingTransfer) {
        pendingTransfer = null;
        return;
      }
      if (pendingDeleteRole) {
        pendingDeleteRole = null;
        return;
      }
      if (roleEditorOpen) {
        closeRoleEditor();
        return;
      }
      if (createOpen) {
        createOpen = false;
        return;
      }
      onclose();
    }
  }

  // ---- member actions ----

  // Friendly text for member-mutation failures. The server can now
  // return 409 owner_protected when a remove / role-change targets the
  // vault owner (v3 Phase O) — surface that clearly instead of the
  // raw code.
  function memberErrorText(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.code === 'owner_protected') {
        return 'The vault owner can’t be removed or demoted below Admin. Transfer ownership first.';
      }
      return e.detail ?? e.code;
    }
    return (e as Error).message;
  }

  async function onChangeRole(m: RemoteMember, e: Event): Promise<void> {
    const select = e.target as HTMLSelectElement;
    const newRoleID = select.value;
    if (newRoleID === m.role_id) return;
    rowError = null;
    try {
      await vaultMembers.changeRole(m.user_id, newRoleID);
    } catch (e) {
      // Reset the <select> so it matches the rolled-back model.
      select.value = m.role_id;
      rowError = memberErrorText(e);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!pendingRemove) return;
    rowError = null;
    try {
      await vaultMembers.removeMember(pendingRemove.user_id);
      pendingRemove = null;
    } catch (e) {
      rowError = memberErrorText(e);
    }
  }

  // ---- transfer-ownership actions (v3 Phase O) ----

  function transferErrorText(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 403) return 'Only the vault owner can transfer ownership.';
      switch (e.code) {
        case 'user_id_required':
          return 'Pick a member to transfer ownership to.';
        case 'validation':
          return 'That user isn’t a member of this vault.';
        default:
          return e.detail ?? e.code;
      }
    }
    return (e as Error).message;
  }

  function openTransferConfirm(): void {
    transferError = null;
    const target = transferCandidates.find((m) => m.user_id === transferTargetID);
    if (!target) {
      transferError = 'Pick a member to transfer ownership to.';
      return;
    }
    pendingTransfer = target;
  }

  async function confirmTransfer(): Promise<void> {
    if (!pendingTransfer || !vaults.selectedID || transferSubmitting) return;
    transferSubmitting = true;
    transferError = null;
    try {
      await vaults.transferOwnership(vaults.selectedID, pendingTransfer.user_id);
      // The new owner gains an untouchable Admin-equivalent grant, so
      // the member list's roles/caps may have changed server-side.
      await vaultMembers.refresh();
      pendingTransfer = null;
      transferTargetID = '';
    } catch (e) {
      pendingTransfer = null;
      transferError = transferErrorText(e);
    } finally {
      transferSubmitting = false;
    }
  }

  // ---- send-a-copy actions (v3 Phase O) ----

  function copyErrorText(e: unknown, recipient: string): string {
    if (e instanceof ApiError) {
      switch (e.code) {
        case 'recipient_not_found':
          return `No user named “@${recipient}” on this server.`;
        case 'recipient_username_required':
          return 'Enter the recipient’s username.';
        case 'capability_missing':
          return 'You don’t have permission to export this vault.';
        default:
          return e.detail ?? e.code;
      }
    }
    return (e as Error).message;
  }

  async function submitCopy(e: Event): Promise<void> {
    e.preventDefault();
    if (copySubmitting || !vaults.selectedID) return;
    const recipient = copyUsername.trim();
    if (!recipient) {
      copyError = 'Enter the recipient’s username.';
      return;
    }
    copySubmitting = true;
    copyError = null;
    copySent = null;
    try {
      const fork = await vaults.sendCopy(vaults.selectedID, recipient);
      copySent = { name: fork.name, slug: fork.slug, recipient };
      copyUsername = '';
    } catch (e) {
      copyError = copyErrorText(e, recipient);
    } finally {
      copySubmitting = false;
    }
  }

  // ---- invite actions ----

  function openCreateForm(): void {
    createOpen = true;
    inviteError = null;
    lastCreatedURL = null;
  }

  function closeCreateForm(): void {
    createOpen = false;
    inviteError = null;
    inviteEmailHint = '';
    inviteMaxUses = 1;
    inviteExpiresAt = defaultExpiresAtInputValue();
    // Don't drop lastCreatedURL — the user may still want to copy it.
  }

  async function submitInvite(e: Event): Promise<void> {
    e.preventDefault();
    if (inviteSubmitting) return;
    if (!inviteRoleID) return;
    const expIso = new Date(inviteExpiresAt).toISOString();
    if (Number.isNaN(new Date(inviteExpiresAt).getTime())) {
      inviteError = 'Expiry date is invalid.';
      return;
    }
    inviteSubmitting = true;
    inviteError = null;
    try {
      const input: CreateInviteInput = {
        role_id: inviteRoleID,
        max_uses: inviteMaxUses,
        expires_at: expIso,
        email_hint: inviteEmailHint.trim() || undefined,
      };
      const created = await vaultMembers.createInvite(input);
      lastCreatedURL = created.url;
      closeCreateForm();
    } catch (e) {
      inviteError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      inviteSubmitting = false;
    }
  }

  async function copyURL(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      copiedAt = Date.now();
    } catch {
      // Clipboard may be unavailable (insecure context, etc.). Fall
      // back to a transient selection prompt? Skip for now.
    }
  }

  async function onRevoke(invite: Invite): Promise<void> {
    rowError = null;
    try {
      await vaultMembers.revokeInvite(invite.token);
    } catch (e) {
      rowError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    }
  }

  // ---- formatting helpers ----

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    return s.replace('T', ' ').slice(0, 16);
  }

  function isInviteActive(i: Invite): boolean {
    if (i.revoked_at) return false;
    if (i.use_count >= i.max_uses) return false;
    return new Date(i.expires_at).getTime() > Date.now();
  }

  function inviteStateLabel(i: Invite): string {
    if (i.revoked_at) return 'revoked';
    if (i.use_count >= i.max_uses) return 'exhausted';
    if (new Date(i.expires_at).getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  // ---- role editor ----

  function openCreateRole(): void {
    editingRoleID = null;
    roleEditorName = '';
    roleEditorCaps = new Set();
    roleEditorError = null;
    roleEditorOpen = true;
  }

  function openEditRole(r: RemoteRole): void {
    editingRoleID = r.id;
    roleEditorName = r.name;
    roleEditorCaps = new Set(r.capabilities);
    roleEditorError = null;
    roleEditorOpen = true;
  }

  function closeRoleEditor(): void {
    roleEditorOpen = false;
    roleEditorError = null;
  }

  function toggleCap(id: string): void {
    // Re-assigning the Set is what makes Svelte 5's $state notice the
    // change — mutating in-place doesn't re-trigger reactivity for
    // built-in collection types.
    const next = new Set(roleEditorCaps);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    roleEditorCaps = next;
  }

  async function submitRoleEditor(e: Event): Promise<void> {
    e.preventDefault();
    if (roleEditorSubmitting) return;
    const name = roleEditorName.trim();
    if (!name) {
      roleEditorError = 'Role name is required.';
      return;
    }
    const caps = Array.from(roleEditorCaps).sort();
    roleEditorSubmitting = true;
    roleEditorError = null;
    try {
      if (editingRoleID == null) {
        const input: CreateRoleInput = { name, capabilities: caps };
        await vaultMembers.createRole(input);
      } else {
        const input: UpdateRoleInput = { name, capabilities: caps };
        await vaultMembers.updateRole(editingRoleID, input);
      }
      closeRoleEditor();
    } catch (e) {
      roleEditorError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      roleEditorSubmitting = false;
    }
  }

  async function confirmDeleteRole(): Promise<void> {
    if (!pendingDeleteRole) return;
    rowError = null;
    try {
      await vaultMembers.deleteRole(pendingDeleteRole.id);
      pendingDeleteRole = null;
    } catch (e) {
      rowError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    }
  }

  function capsSummary(caps: string[]): string {
    if (caps.length === 0) return 'no permissions';
    if (caps.includes('*')) return 'every permission';
    if (caps.length === 1) return caps[0];
    return `${caps.length} permissions`;
  }
</script>

<div
  class="overlay"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Vault settings"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <header class="panel-head">
      <div class="title">
        <h2>{vaults.selected?.name ?? 'Vault'}</h2>
        <span class="slug">{vaults.selected?.slug ?? ''}</span>
      </div>
      <button class="close" type="button" aria-label="Close" onclick={onclose}>×</button>
    </header>

    <div class="tabs" role="tablist">
      <button
        type="button"
        class="tab"
        class:active={tab === 'members'}
        role="tab"
        aria-selected={tab === 'members'}
        onclick={() => (tab = 'members')}
      >Members ({vaultMembers.members.length})</button>
      <button
        type="button"
        class="tab"
        class:active={tab === 'invites'}
        role="tab"
        aria-selected={tab === 'invites'}
        onclick={() => (tab = 'invites')}
      >Invites ({vaultMembers.invites.filter(isInviteActive).length})</button>
      <button
        type="button"
        class="tab"
        class:active={tab === 'roles'}
        role="tab"
        aria-selected={tab === 'roles'}
        onclick={() => (tab = 'roles')}
      >Roles ({vaultMembers.roles.length})</button>
      <button
        type="button"
        class="tab"
        class:active={tab === 'sharing'}
        role="tab"
        aria-selected={tab === 'sharing'}
        onclick={() => (tab = 'sharing')}
      >Sharing</button>
    </div>

    {#if vaultMembers.loading}
      <div class="placeholder">Loading…</div>
    {:else if vaultMembers.lastError}
      <div class="error">{vaultMembers.lastError}</div>
    {/if}

    {#if tab === 'members'}
      <section class="body">
        {#if rowError}<div class="error">{rowError}</div>{/if}
        {#if vaultMembers.members.length === 0 && !vaultMembers.loading}
          <div class="placeholder">No members yet.</div>
        {:else}
          <ul class="rows">
            {#each vaultMembers.members as m (m.user_id)}
              <li class="row" class:self={m.user_id === auth.user?.id}>
                <div class="row-main">
                  <div class="name">
                    {m.display_name || m.username}
                    {#if m.user_id === ownerID}<span class="badge owner">owner</span>{/if}
                    {#if m.user_id === auth.user?.id}<span class="badge">you</span>{/if}
                  </div>
                  <div class="meta">@{m.username} · joined {fmtDate(m.joined_at)}</div>
                </div>
                <div class="row-actions">
                  {#if m.user_id === ownerID}
                    <!-- Owner row: no role-change, no remove. The server
                         would 409 owner_protected anyway; explain instead. -->
                    <span
                      class="role-readonly"
                      title="The vault owner can’t be removed or demoted. Transfer ownership first."
                    >{m.role_name} · protected</span>
                  {:else}
                    {#if canManageMembers && vaultMembers.roles.length > 0}
                      <select
                        class="select"
                        value={m.role_id}
                        onchange={(e) => onChangeRole(m, e)}
                        aria-label="Role"
                      >
                        {#each vaultMembers.roles as r (r.id)}
                          <option value={r.id}>{r.name}</option>
                        {/each}
                      </select>
                    {:else}
                      <span class="role-readonly">{m.role_name}</span>
                    {/if}
                    {#if canManageMembers && m.user_id !== auth.user?.id}
                      <button
                        type="button"
                        class="link danger"
                        onclick={() => (pendingRemove = m)}
                      >Remove</button>
                    {/if}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if iAmOwner}
          <div class="owner-zone">
            <h3>Transfer ownership</h3>
            <p class="hint">
              Hand this vault to another member. They become the
              protected owner; you keep your current role. This can’t
              be undone without the new owner transferring back.
            </p>
            {#if transferCandidates.length === 0}
              <p class="hint">No other members to transfer to — invite someone first.</p>
            {:else}
              <div class="form-actions">
                <select
                  class="select"
                  bind:value={transferTargetID}
                  disabled={transferSubmitting}
                  aria-label="New owner"
                >
                  <option value="" disabled>Pick a member…</option>
                  {#each transferCandidates as m (m.user_id)}
                    <option value={m.user_id}>{m.display_name || m.username} (@{m.username})</option>
                  {/each}
                </select>
                <button
                  class="primary danger"
                  type="button"
                  disabled={transferSubmitting || !transferTargetID}
                  onclick={openTransferConfirm}
                >Transfer…</button>
              </div>
            {/if}
            {#if transferError}<div class="error">{transferError}</div>{/if}
          </div>
        {/if}
      </section>
    {/if}

    {#if tab === 'invites'}
      <section class="body">
        {#if !canInvite}
          <div class="placeholder">
            You don’t have permission to manage invites for this vault.
          </div>
        {:else}
          <div class="invite-bar">
            <button class="primary" type="button" onclick={openCreateForm}>+ New invite</button>
            {#if lastCreatedURL}
              <div class="created-row">
                <input class="select" readonly value={lastCreatedURL} />
                <button class="link" type="button" onclick={() => copyURL(lastCreatedURL!)}>
                  {Date.now() - copiedAt < 2000 ? 'Copied!' : 'Copy'}
                </button>
              </div>
            {/if}
          </div>

          {#if createOpen}
            <form class="create-form" onsubmit={submitInvite}>
              <div class="form-row">
                <label>
                  Role
                  <select class="select" bind:value={inviteRoleID} disabled={inviteSubmitting}>
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
                    bind:value={inviteMaxUses}
                    disabled={inviteSubmitting}
                  />
                </label>
                <label>
                  Expires at
                  <input
                    class="input"
                    type="datetime-local"
                    bind:value={inviteExpiresAt}
                    disabled={inviteSubmitting}
                  />
                </label>
              </div>
              <label>
                Email hint (optional)
                <input
                  class="input"
                  type="text"
                  placeholder="alice@example.com"
                  bind:value={inviteEmailHint}
                  disabled={inviteSubmitting}
                />
              </label>
              {#if inviteError}<div class="error">{inviteError}</div>{/if}
              <div class="form-actions">
                <button class="primary" type="submit" disabled={inviteSubmitting || !inviteRoleID}>
                  {inviteSubmitting ? '…' : 'Create invite'}
                </button>
                <button class="link" type="button" onclick={closeCreateForm} disabled={inviteSubmitting}>
                  Cancel
                </button>
              </div>
            </form>
          {/if}

          {#if rowError}<div class="error">{rowError}</div>{/if}

          {#if vaultMembers.invites.length === 0}
            <div class="placeholder">No invites yet.</div>
          {:else}
            <ul class="rows">
              {#each vaultMembers.invites as inv (inv.token)}
                <li class="row" class:inactive={!isInviteActive(inv)}>
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
                      <button class="link danger" type="button" onclick={() => onRevoke(inv)}>Revoke</button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>
    {/if}

    {#if tab === 'roles'}
      <section class="body">
        {#if canManageRoles}
          <div class="invite-bar">
            <button class="primary" type="button" onclick={openCreateRole}>+ New role</button>
          </div>
        {/if}

        {#if roleEditorOpen}
          <form class="create-form" onsubmit={submitRoleEditor}>
            <label>
              Role name
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="input"
                type="text"
                bind:value={roleEditorName}
                disabled={roleEditorSubmitting}
                autofocus
                required
              />
            </label>
            <fieldset class="caps">
              <legend>Capabilities</legend>
              {#each capabilityGroups as [group, caps] (group)}
                <div class="cap-group">
                  <div class="cap-group-title">{group}</div>
                  {#each caps as cap (cap.id)}
                    <label class="cap-row">
                      <input
                        type="checkbox"
                        checked={roleEditorCaps.has(cap.id)}
                        onchange={() => toggleCap(cap.id)}
                        disabled={roleEditorSubmitting}
                      />
                      <span class="cap-label">{cap.label}</span>
                      <span class="cap-id">{cap.id}</span>
                    </label>
                  {/each}
                </div>
              {/each}
            </fieldset>
            {#if roleEditorError}<div class="error">{roleEditorError}</div>{/if}
            <div class="form-actions">
              <button class="primary" type="submit" disabled={roleEditorSubmitting || !roleEditorName.trim()}>
                {#if roleEditorSubmitting}
                  …
                {:else if editingRoleID == null}
                  Create role
                {:else}
                  Save changes
                {/if}
              </button>
              <button class="link" type="button" onclick={closeRoleEditor} disabled={roleEditorSubmitting}>
                Cancel
              </button>
            </div>
          </form>
        {/if}

        {#if rowError}<div class="error">{rowError}</div>{/if}

        {#if vaultMembers.roles.length === 0}
          <div class="placeholder">No roles defined yet.</div>
        {:else}
          <ul class="rows">
            {#each vaultMembers.roles as r (r.id)}
              <li class="row">
                <div class="row-main">
                  <div class="name">
                    {r.name}
                    {#if r.is_seed}<span class="badge">built-in</span>{/if}
                  </div>
                  <div class="meta">{capsSummary(r.capabilities)}</div>
                </div>
                <div class="row-actions">
                  {#if canManageRoles && !r.is_seed}
                    <button class="link" type="button" onclick={() => openEditRole(r)}>Edit</button>
                    <button class="link danger" type="button" onclick={() => (pendingDeleteRole = r)}>Delete</button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if !canManageRoles}
          <p class="hint" style="margin-top: 0.7rem; text-align: center;">
            You don’t have permission to create or edit roles.
          </p>
        {/if}
      </section>
    {/if}

    {#if tab === 'sharing'}
      <section class="body">
        {#if vaults.selected?.copied_from}
          <p class="hint provenance">
            This vault is a copy of “{vaults.selected.copied_from.slug}”,
            received {fmtDate(vaults.selected.copied_from.copied_at)}.
            It has no live link to the original.
          </p>
        {/if}

        <h3>Send a copy</h3>
        {#if !canExport}
          <div class="placeholder">
            You don’t have permission to export this vault.
          </div>
        {:else}
          <p class="hint">
            Forks the vault’s current state into a brand-new vault owned
            by the recipient. They don’t join this vault, and edits on
            either side diverge permanently.
          </p>
          <form class="create-form" onsubmit={submitCopy}>
            <label>
              Recipient username
              <input
                class="input"
                type="text"
                placeholder="username on this server"
                bind:value={copyUsername}
                disabled={copySubmitting}
              />
            </label>
            {#if copyError}<div class="error">{copyError}</div>{/if}
            <div class="form-actions">
              <button
                class="primary"
                type="submit"
                disabled={copySubmitting || !copyUsername.trim()}
              >{copySubmitting ? '…' : 'Send copy'}</button>
            </div>
          </form>
          {#if copySent}
            <div class="success">
              Copy sent — “{copySent.name}” ({copySent.slug}) now belongs
              to @{copySent.recipient}.
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    {#if pendingDeleteRole}
      <div
        class="overlay nested"
        role="presentation"
        onclick={() => (pendingDeleteRole = null)}
        onkeydown={(e) => { if (e.key === 'Escape') pendingDeleteRole = null; }}
      >
        <div
          class="panel small"
          role="alertdialog"
          aria-modal="true"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <h2>Delete role “{pendingDeleteRole.name}”?</h2>
          <p class="hint">
            Members assigned to this role will need to be reassigned
            first; the server refuses the delete otherwise. Built-in
            roles can’t be deleted at all.
          </p>
          <div class="form-actions">
            <button class="primary danger" type="button" onclick={confirmDeleteRole}>Delete</button>
            <button class="link" type="button" onclick={() => (pendingDeleteRole = null)}>Cancel</button>
          </div>
        </div>
      </div>
    {/if}

    {#if pendingTransfer}
      <div
        class="overlay nested"
        role="presentation"
        onclick={() => (pendingTransfer = null)}
        onkeydown={(e) => { if (e.key === 'Escape') pendingTransfer = null; }}
      >
        <div
          class="panel small"
          role="alertdialog"
          aria-modal="true"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <h2>Transfer ownership to {pendingTransfer.display_name || pendingTransfer.username}?</h2>
          <p class="hint">
            @{pendingTransfer.username} becomes the vault’s protected
            owner — they can’t be removed or demoted, and only they can
            transfer ownership after this. You keep your current role.
          </p>
          <div class="form-actions">
            <button
              class="primary danger"
              type="button"
              disabled={transferSubmitting}
              onclick={confirmTransfer}
            >{transferSubmitting ? '…' : 'Transfer ownership'}</button>
            <button
              class="link"
              type="button"
              disabled={transferSubmitting}
              onclick={() => (pendingTransfer = null)}
            >Cancel</button>
          </div>
        </div>
      </div>
    {/if}

    {#if pendingRemove}
      <div
        class="overlay nested"
        role="presentation"
        onclick={() => (pendingRemove = null)}
        onkeydown={(e) => { if (e.key === 'Escape') pendingRemove = null; }}
      >
        <div
          class="panel small"
          role="alertdialog"
          aria-modal="true"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <h2>Remove {pendingRemove.display_name || pendingRemove.username}?</h2>
          <p class="hint">
            They’ll lose access to this vault immediately. Their notes
            remain (they were never the only owner of CRDT updates).
          </p>
          <div class="form-actions">
            <button class="primary danger" type="button" onclick={confirmRemove}>Remove</button>
            <button class="link" type="button" onclick={() => (pendingRemove = null)}>Cancel</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
    padding: 1rem;
  }
  .overlay.nested {
    z-index: 175;
    background: rgba(0, 0, 0, 0.4);
  }
  .panel {
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 8px;
    width: min(640px, 100%);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .panel.small {
    width: min(360px, 100%);
    padding: 1.1rem;
    gap: 0.6rem;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }
  .panel-head h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .title { display: flex; flex-direction: column; gap: 0.05rem; }
  .slug {
    font-size: 0.75rem;
    color: var(--color-text-dim, var(--color-muted));
  }
  .close {
    background: transparent;
    border: none;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.4rem;
  }
  .close:hover { color: var(--color-text); }

  .tabs {
    display: flex;
    gap: 0.4rem;
    padding: 0.55rem 1.1rem 0;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0.45rem 0.5rem 0.55rem;
    color: var(--color-text-dim, var(--color-muted));
    font-family: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .tab.active {
    color: var(--color-text);
    border-bottom-color: var(--color-primary);
  }

  .body {
    padding: 0.85rem 1.1rem 1.1rem;
    overflow-y: auto;
  }

  .rows {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
  }
  .row.self {
    border-color: var(--color-primary);
  }
  .row.inactive {
    opacity: 0.55;
  }
  .row-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--color-text);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-shrink: 0;
  }

  .badge {
    background: var(--color-selected-bg, var(--color-overlay-bg));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    font-size: 0.7rem;
    color: var(--color-text-dim, var(--color-muted));
    text-transform: lowercase;
  }
  .badge.owner { color: var(--color-primary); border-color: currentColor; }
  .badge.state-active { color: var(--color-info, var(--color-secondary)); border-color: currentColor; }
  .badge.state-revoked { color: var(--color-error); border-color: currentColor; }
  .badge.state-expired { color: var(--color-warning, var(--color-secondary)); border-color: currentColor; }
  .badge.state-exhausted { color: var(--color-text-dim, var(--color-muted)); }

  .select, .input {
    padding: 0.32rem 0.5rem;
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
  }
  .select:focus, .input:focus { border-color: var(--color-secondary); }

  .role-readonly {
    font-size: 0.82rem;
    color: var(--color-text-dim, var(--color-muted));
  }

  .invite-bar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.7rem;
  }
  .created-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex: 1;
    min-width: 240px;
  }
  .created-row .select { flex: 1; }

  .create-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem;
    margin-bottom: 0.8rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1.5fr;
    gap: 0.5rem;
  }
  .form-row label, .create-form > label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
    color: var(--color-text-dim, var(--color-muted));
  }
  .form-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .primary {
    padding: 0.4rem 0.85rem;
    background: var(--color-primary);
    border: none;
    border-radius: 4px;
    color: var(--color-background);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary.danger { background: var(--color-error); }
  .primary:disabled { opacity: 0.5; cursor: progress; }

  .link {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0 0.3rem;
  }
  .link:hover { text-decoration: underline; }
  .link.danger { color: var(--color-error); }
  .link:disabled { opacity: 0.5; cursor: not-allowed; }

  .hint {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.8rem;
    margin: 0;
  }

  .owner-zone {
    margin-top: 1rem;
    padding: 0.7rem;
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .owner-zone h3, .body h3 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .body > h3 { margin: 0.2rem 0 0.5rem; }
  .owner-zone .error { padding: 0; text-align: left; }

  .provenance { margin-bottom: 0.9rem; }

  .success {
    margin-top: 0.2rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--color-info, var(--color-secondary));
    border-radius: 6px;
    color: var(--color-info, var(--color-secondary));
    font-size: 0.85rem;
  }
  .placeholder, .error {
    padding: 1.1rem;
    text-align: center;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.85rem;
  }
  .error { color: var(--color-error); }

  .caps {
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    padding: 0.55rem 0.7rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.6rem 1rem;
  }
  .caps legend {
    font-size: 0.78rem;
    color: var(--color-text-dim, var(--color-muted));
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 0.3rem;
  }
  .cap-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .cap-group-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-dim, var(--color-muted));
    margin-bottom: 0.1rem;
  }
  .cap-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--color-text);
    cursor: pointer;
  }
  .cap-label { white-space: nowrap; }
  .cap-id {
    font-size: 0.7rem;
    color: var(--color-text-dim, var(--color-muted));
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
