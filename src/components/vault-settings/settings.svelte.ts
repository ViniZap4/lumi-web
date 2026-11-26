// The book settings modal's state and actions (members, invites,
// roles, sharing, federation). VaultSettingsModal renders the tabs and
// owns the keyboard; the tab components read and act through this.
//
// Capability gating is UX only: the server enforces every capability.

import { auth } from '../../lib/auth.svelte.ts';
import { vaults } from '../../lib/vaults.svelte.ts';
import { vaultMembers, type CreateInviteInput, type CreateRoleInput, type UpdateRoleInput } from '../../lib/vaultmembers.svelte.ts';
import { federation, validateMemberKey } from '../../lib/federation.svelte.ts';
import { publishScope } from '../../lib/publish.ts';
import { ApiError, type Federation, type FederationInvite, type FederatedMember, type Invite, type RemoteMember, type RemoteRole } from '../../lib/types.ts';
import { CAPABILITY_CATALOGUE, hasCapability } from '../../lib/capabilities.ts';
import { defaultExpiresAtInputValue, memberErrorText, transferErrorText, copyErrorText, fedErrorText } from './format.ts';

export class VaultSettingsController {
  // ---- capability gates (UX only — server still enforces) ----
  //
  // Use the wildcard-aware hasCapability so an Admin (role granted `*`)
  // sees every affordance. Previous slice used raw .includes() with
  // misspelled namespace strings — neither one worked for admins.
  readonly myCaps = $derived.by(() => vaultMembers.capabilitiesOf(auth.user?.id));
  readonly canManageMembers = $derived.by(() => hasCapability(this.myCaps, 'members.manage'));
  readonly canInvite = $derived.by(() => hasCapability(this.myCaps, 'members.invite'));
  readonly canManageRoles = $derived.by(() => hasCapability(this.myCaps, 'roles.manage'));
  readonly canExport = $derived.by(() => hasCapability(this.myCaps, 'vault.export'));
  readonly canFederate = $derived.by(() => hasCapability(this.myCaps, 'vault.federate'));
  readonly canManageVault = $derived.by(() => hasCapability(this.myCaps, 'vault.manage'));

  // ---- ownership (v3 Phase O) ----
  //
  // The owner badge + guards compare member user_ids to the vault DTO's
  // owner_user_id; the transfer section only renders for the owner.
  readonly ownerID = $derived.by(() => vaults.selectedOwnerID);
  readonly iAmOwner = $derived.by(() => vaults.isOwner(auth.user?.id));
  readonly transferCandidates = $derived.by(() => 
    vaultMembers.members.filter((m) => m.user_id !== this.ownerID),
  );

  // ---- per-row error feedback ----
  rowError = $state<string | null>(null);
  pendingRemove = $state<RemoteMember | null>(null);
  pendingDeleteRole = $state<RemoteRole | null>(null);

  // ---- transfer-ownership state ----
  transferTargetID = $state<string>('');
  pendingTransfer = $state<RemoteMember | null>(null);
  transferSubmitting = $state(false);
  transferError = $state<string | null>(null);

  // ---- send-a-copy state ----
  copyUsername = $state('');
  copySubmitting = $state(false);
  copyError = $state<string | null>(null);
  copySent = $state<{ name: string; slug: string; recipient: string } | null>(null);

  // ---- role-editor state (used by Roles tab) ----
  roleEditorOpen = $state(false);
  editingRoleID = $state<string | null>(null); // null = creating
  roleEditorName = $state('');
  roleEditorCaps = $state<Set<string>>(new Set());
  roleEditorSubmitting = $state(false);
  roleEditorError = $state<string | null>(null);

  // Group catalogue entries for the editor UI.
  readonly capabilityGroups = (() => {
    const groups: Record<string, typeof CAPABILITY_CATALOGUE> = {};
    for (const c of CAPABILITY_CATALOGUE) {
      (groups[c.group] ||= []).push(c);
    }
    return Object.entries(groups);
  })();

  // ---- federation state (v3 F-phases) ----
  fedRowError = $state<string | null>(null);
  pendingRevokeFederation = $state<Federation | null>(null);
  fedRevokeSubmitting = $state(false);
  pendingRemoveFedMember = $state<FederatedMember | null>(null);

  // Federation-invite create form. Both fields optional: hint pins the
  // invite to one server URL, blank expiry defers to the server.
  fedInviteOpen = $state(false);
  fedInviteServerHint = $state('');
  fedInviteExpiresAt = $state('');
  fedInviteSubmitting = $state(false);
  fedInviteError = $state<string | null>(null);
  // M2/M3: a one-way mirror, optionally allowed to publish publicly.
  fedInviteMode = $state<'replica' | 'mirror'>('replica');
  fedPublish = $state(false);
  fedPublishScope = $state<'flagged' | 'all' | 'folder'>('flagged');
  fedPublishFolder = $state('');
  fedPublishIndex = $state(false);
  fedPublishConsent = $state(false);
  // The raw token — held in memory only, shown ONCE after creation.
  lastFedInviteToken = $state<string | null>(null);
  fedTokenCopiedAt = $state(0);

  // Federated-member add form.
  fedMemberKey = $state('');
  fedMemberRoleID = $state('');
  fedMemberSubmitting = $state(false);
  fedMemberError = $state<string | null>(null);

  // ---- create-invite form state ----
  createOpen = $state(false);
  inviteRoleID = $state<string>('');
  inviteMaxUses = $state<number>(1);
  inviteExpiresAt = $state<string>(defaultExpiresAtInputValue());
  inviteEmailHint = $state('');
  inviteSubmitting = $state(false);
  inviteError = $state<string | null>(null);
  lastCreatedURL = $state<string | null>(null);
  copiedAt = $state<number>(0);

  install(): void {
    // Pre-select the first role for the invite forms once roles load.
    $effect(() => {
      if (!this.inviteRoleID && vaultMembers.roles.length > 0) {
        this.inviteRoleID = vaultMembers.roles[0].id;
      }
    });
    $effect(() => {
      if (!this.fedMemberRoleID && vaultMembers.roles.length > 0) {
        this.fedMemberRoleID = vaultMembers.roles[0].id;
      }
    });

  }

  /** Esc: close the topmost layer (a confirm, then an inline form).
   *  false when nothing was open (the modal itself closes). */
  dismiss(): boolean {
    if (this.pendingRemove) return void (this.pendingRemove = null), true;
    if (this.pendingTransfer) return void (this.pendingTransfer = null), true;
    if (this.pendingDeleteRole) return void (this.pendingDeleteRole = null), true;
    if (this.pendingRevokeFederation) return void (this.pendingRevokeFederation = null), true;
    if (this.pendingRemoveFedMember) return void (this.pendingRemoveFedMember = null), true;
    if (this.roleEditorOpen) return this.closeRoleEditor(), true;
    if (this.createOpen) return void (this.createOpen = false), true;
    if (this.fedInviteOpen) return void (this.fedInviteOpen = false), true;
    return false;
  }

  onChangeRole = async (m: RemoteMember, e: Event): Promise<void> => {
    const select = e.target as HTMLSelectElement;
    const newRoleID = select.value;
    if (newRoleID === m.role_id) return;
    this.rowError = null;
    try {
      await vaultMembers.changeRole(m.user_id, newRoleID);
    } catch (e) {
      // Reset the <select> so it matches the rolled-back model.
      select.value = m.role_id;
      this.rowError = memberErrorText(e);
    }
  };

  confirmRemove = async (): Promise<void> => {
    if (!this.pendingRemove) return;
    this.rowError = null;
    try {
      await vaultMembers.removeMember(this.pendingRemove.user_id);
      this.pendingRemove = null;
    } catch (e) {
      this.rowError = memberErrorText(e);
    }
  };

  openTransferConfirm = (): void => {
    this.transferError = null;
    const target = this.transferCandidates.find((m) => m.user_id === this.transferTargetID);
    if (!target) {
      this.transferError = 'Pick a member to transfer ownership to.';
      return;
    }
    this.pendingTransfer = target;
  };

  confirmTransfer = async (): Promise<void> => {
    if (!this.pendingTransfer || !vaults.selectedID || this.transferSubmitting) return;
    this.transferSubmitting = true;
    this.transferError = null;
    try {
      await vaults.transferOwnership(vaults.selectedID, this.pendingTransfer.user_id);
      // The new owner gains an untouchable Admin-equivalent grant, so
      // the member list's roles/caps may have changed server-side.
      await vaultMembers.refresh();
      this.pendingTransfer = null;
      this.transferTargetID = '';
    } catch (e) {
      this.pendingTransfer = null;
      this.transferError = transferErrorText(e);
    } finally {
      this.transferSubmitting = false;
    }
  };

  submitCopy = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (this.copySubmitting || !vaults.selectedID) return;
    const recipient = this.copyUsername.trim();
    if (!recipient) {
      this.copyError = 'Enter the recipient’s username.';
      return;
    }
    this.copySubmitting = true;
    this.copyError = null;
    this.copySent = null;
    try {
      const fork = await vaults.sendCopy(vaults.selectedID, recipient);
      this.copySent = { name: fork.name, slug: fork.slug, recipient };
      this.copyUsername = '';
    } catch (e) {
      this.copyError = copyErrorText(e, recipient);
    } finally {
      this.copySubmitting = false;
    }
  };

  openCreateForm = (): void => {
    this.createOpen = true;
    this.inviteError = null;
    this.lastCreatedURL = null;
  };

  closeCreateForm = (): void => {
    this.createOpen = false;
    this.inviteError = null;
    this.inviteEmailHint = '';
    this.inviteMaxUses = 1;
    this.inviteExpiresAt = defaultExpiresAtInputValue();
    // Don't drop lastCreatedURL — the user may still want to copy it.
  };

  submitInvite = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (this.inviteSubmitting) return;
    if (!this.inviteRoleID) return;
    const expIso = new Date(this.inviteExpiresAt).toISOString();
    if (Number.isNaN(new Date(this.inviteExpiresAt).getTime())) {
      this.inviteError = 'Expiry date is invalid.';
      return;
    }
    this.inviteSubmitting = true;
    this.inviteError = null;
    try {
      const input: CreateInviteInput = {
        role_id: this.inviteRoleID,
        max_uses: this.inviteMaxUses,
        expires_at: expIso,
        email_hint: this.inviteEmailHint.trim() || undefined,
      };
      const created = await vaultMembers.createInvite(input);
      this.lastCreatedURL = created.url;
      this.closeCreateForm();
    } catch (e) {
      this.inviteError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      this.inviteSubmitting = false;
    }
  };

  copyURL = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      this.copiedAt = Date.now();
    } catch {
      // Clipboard may be unavailable (insecure context, etc.). Fall
      // back to a transient selection prompt? Skip for now.
    }
  };

  onRevoke = async (invite: Invite): Promise<void> => {
    this.rowError = null;
    try {
      await vaultMembers.revokeInvite(invite.token);
    } catch (e) {
      this.rowError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    }
  };

  openFedInviteForm = (): void => {
    this.fedInviteOpen = true;
    this.fedInviteError = null;
    this.lastFedInviteToken = null;
  };

  closeFedInviteForm = (): void => {
    this.fedInviteOpen = false;
    this.fedInviteError = null;
    this.fedInviteServerHint = '';
    this.fedInviteExpiresAt = '';
    this.fedInviteMode = 'replica';
    this.fedPublish = false;
    this.fedPublishScope = 'flagged';
    this.fedPublishFolder = '';
    this.fedPublishIndex = false;
    this.fedPublishConsent = false;
    // Don't drop lastFedInviteToken — the operator may still need to
    // copy it; it's gone for good once the modal closes.
  };

  submitFedInvite = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (this.fedInviteSubmitting) return;
    let expIso: string | undefined;
    if (this.fedInviteExpiresAt) {
      const t = new Date(this.fedInviteExpiresAt).getTime();
      if (Number.isNaN(t)) {
        this.fedInviteError = 'Expiry date is invalid.';
        return;
      }
      expIso = new Date(this.fedInviteExpiresAt).toISOString();
    }
    const publishing = this.fedInviteMode === 'mirror' && this.fedPublish;
    const scope = publishing ? publishScope(this.fedPublishScope, this.fedPublishFolder) : null;
    if (publishing && scope == null) {
      this.fedInviteError = 'Informe a pasta a publicar.';
      return;
    }
    if (publishing && !this.fedPublishConsent) {
      this.fedInviteError = 'Confirme que entende que as notas ficarão públicas.';
      return;
    }
    this.fedInviteSubmitting = true;
    this.fedInviteError = null;
    try {
      const created = await federation.createInvite({
        server_url_hint: this.fedInviteServerHint.trim() || undefined,
        expires_at: expIso,
        ...(this.fedInviteMode === 'mirror' ? { mode: 'mirror' as const } : {}),
        ...(publishing && scope ? { publish: { allowed: true, scope, index: this.fedPublishIndex } } : {}),
      });
      this.lastFedInviteToken = created.token;
      this.closeFedInviteForm();
    } catch (e) {
      this.fedInviteError = fedErrorText(e);
    } finally {
      this.fedInviteSubmitting = false;
    }
  };

  copyFedToken = async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token);
      this.fedTokenCopiedAt = Date.now();
    } catch {
      // Clipboard may be unavailable (insecure context, etc.).
    }
  };

  onRevokeFedInvite = async (inv: FederationInvite): Promise<void> => {
    this.fedRowError = null;
    try {
      await federation.revokeInvite(inv.token);
    } catch (e) {
      this.fedRowError = fedErrorText(e);
    }
  };

  confirmRevokeFederation = async (): Promise<void> => {
    if (!this.pendingRevokeFederation || this.fedRevokeSubmitting) return;
    this.fedRevokeSubmitting = true;
    this.fedRowError = null;
    try {
      await federation.revokeFederation(this.pendingRevokeFederation.id);
      this.pendingRevokeFederation = null;
    } catch (e) {
      this.pendingRevokeFederation = null;
      this.fedRowError = fedErrorText(e);
    } finally {
      this.fedRevokeSubmitting = false;
    }
  };

  submitFedMember = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (this.fedMemberSubmitting || !this.fedMemberRoleID) return;
    const key = this.fedMemberKey.trim();
    // Client-side pre-check so a malformed key doesn't need a
    // round-trip; the server revalidates (400 validation) anyway.
    const problem = validateMemberKey(key);
    if (problem) {
      this.fedMemberError = problem;
      return;
    }
    this.fedMemberSubmitting = true;
    this.fedMemberError = null;
    try {
      await federation.addMember(key, this.fedMemberRoleID);
      this.fedMemberKey = '';
    } catch (e) {
      this.fedMemberError = fedErrorText(e);
    } finally {
      this.fedMemberSubmitting = false;
    }
  };

  onChangeFedMemberRole = async (m: FederatedMember, e: Event): Promise<void> => {
    const select = e.target as HTMLSelectElement;
    const newRoleID = select.value;
    if (newRoleID === m.role_id) return;
    this.fedRowError = null;
    const newRole = vaultMembers.roles.find((r) => r.id === newRoleID);
    try {
      await federation.changeMemberRole(m.member_key, newRoleID, newRole?.name);
    } catch (e) {
      select.value = m.role_id; // match the rolled-back model
      this.fedRowError = fedErrorText(e);
    }
  };

  confirmRemoveFedMember = async (): Promise<void> => {
    if (!this.pendingRemoveFedMember) return;
    this.fedRowError = null;
    try {
      await federation.removeMember(this.pendingRemoveFedMember.member_key);
      this.pendingRemoveFedMember = null;
    } catch (e) {
      this.fedRowError = fedErrorText(e);
    }
  };

  openCreateRole = (): void => {
    this.editingRoleID = null;
    this.roleEditorName = '';
    this.roleEditorCaps = new Set();
    this.roleEditorError = null;
    this.roleEditorOpen = true;
  };

  openEditRole = (r: RemoteRole): void => {
    this.editingRoleID = r.id;
    this.roleEditorName = r.name;
    this.roleEditorCaps = new Set(r.capabilities);
    this.roleEditorError = null;
    this.roleEditorOpen = true;
  };

  closeRoleEditor = (): void => {
    this.roleEditorOpen = false;
    this.roleEditorError = null;
  };

  toggleCap = (id: string): void => {
    // Re-assigning the Set is what makes Svelte 5's $state notice the
    // change — mutating in-place doesn't re-trigger reactivity for
    // built-in collection types.
    const next = new Set(this.roleEditorCaps);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.roleEditorCaps = next;
  };

  submitRoleEditor = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (this.roleEditorSubmitting) return;
    const name = this.roleEditorName.trim();
    if (!name) {
      this.roleEditorError = 'Role name is required.';
      return;
    }
    const caps = Array.from(this.roleEditorCaps).sort();
    this.roleEditorSubmitting = true;
    this.roleEditorError = null;
    try {
      if (this.editingRoleID == null) {
        const input: CreateRoleInput = { name, capabilities: caps };
        await vaultMembers.createRole(input);
      } else {
        const input: UpdateRoleInput = { name, capabilities: caps };
        await vaultMembers.updateRole(this.editingRoleID, input);
      }
      this.closeRoleEditor();
    } catch (e) {
      this.roleEditorError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      this.roleEditorSubmitting = false;
    }
  };

  confirmDeleteRole = async (): Promise<void> => {
    if (!this.pendingDeleteRole) return;
    this.rowError = null;
    try {
      await vaultMembers.deleteRole(this.pendingDeleteRole.id);
      this.pendingDeleteRole = null;
    } catch (e) {
      this.rowError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    }
  };
}
