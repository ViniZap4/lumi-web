// Capability catalogue and wildcard-aware matcher.
//
// Mirrors `server/internal/domain/capability.go`. Keep this file in
// sync — the server's CapabilitySet uses three forms:
//   - exact strings (e.g. "note.edit")
//   - prefix wildcards (e.g. "note.*", "members.*")
//   - the catch-all "*"
//
// hasCapability() matches the server's Has() semantics exactly so a
// client-side pre-gate can never disagree with the server's enforcement.

export interface CapabilityDef {
  /** Wire identifier — must match the server's domain.Capability constants. */
  id: string;
  /** Human-friendly label used in role-editor checkboxes. */
  label: string;
  /** Coarse grouping for the role editor (Notes / Members / Roles / Vault / Audit). */
  group: string;
}

/**
 * Catalogue of concrete capabilities a custom role can grant. Aggregate
 * wildcards (`*`, `note.*`, `members.*`, `roles.*`, `vault.*`) are
 * intentionally omitted — they're for seed roles only. A custom role
 * that needs broad access should explicitly select every concrete
 * capability instead.
 */
export const CAPABILITY_CATALOGUE: CapabilityDef[] = [
  { id: 'note.read',     label: 'Read notes',     group: 'Notes' },
  { id: 'note.create',   label: 'Create notes',   group: 'Notes' },
  { id: 'note.edit',     label: 'Edit notes',     group: 'Notes' },
  { id: 'note.delete',   label: 'Delete notes',   group: 'Notes' },
  { id: 'note.move',     label: 'Move notes',     group: 'Notes' },
  { id: 'members.invite', label: 'Invite members', group: 'Members' },
  { id: 'members.manage', label: 'Manage members', group: 'Members' },
  { id: 'roles.manage',   label: 'Manage roles',   group: 'Roles' },
  { id: 'vault.manage',   label: 'Manage vault',   group: 'Vault' },
  { id: 'vault.export',   label: 'Export vault',   group: 'Vault' },
  { id: 'audit.read',     label: 'Read audit log', group: 'Audit' },
];

/**
 * Reports whether `set` grants `needed`. Mirrors the server's
 * CapabilitySet.Has() exactly:
 *   - "*" matches any capability
 *   - "note.*" matches "note.read" / "note.edit" etc., NOT "note" alone
 *   - exact strings match themselves only
 *
 * `needed` must NOT contain wildcards.
 */
export function hasCapability(set: readonly string[], needed: string): boolean {
  for (const granted of set) {
    if (granted === '*' || granted === needed) return true;
    if (granted.endsWith('.*')) {
      const prefix = granted.slice(0, -1); // "note.*" → "note."
      if (needed.startsWith(prefix) && needed.length > prefix.length) {
        return true;
      }
    }
  }
  return false;
}
