<script lang="ts">
  // Tabbed settings modal for the active book: Members, Invites, Roles,
  // Sharing and Federation. State and actions live in
  // vault-settings/settings.svelte.ts; each tab is a component. This
  // file owns the dialog, the tab strip and the keyboard.
  //
  // Capability gating: affordances the current user cannot use are
  // hidden. The server is the source of truth either way (it rejects
  // without the capability), so this is purely UX.
  import { onMount, onDestroy, tick } from 'svelte';
  import { captureFocus, focusables, isTextTarget, newChord, rovingKey, trapTab } from '../lib/list-keys.ts';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { vaultMembers } from '../lib/vaultmembers.svelte.ts';
  import { federation } from '../lib/federation.svelte.ts';
  import { VaultSettingsController } from './vault-settings/settings.svelte.ts';
  import { isInviteActive } from './vault-settings/format.ts';
  import MembersTab from './vault-settings/MembersTab.svelte';
  import InvitesTab from './vault-settings/InvitesTab.svelte';
  import RolesTab from './vault-settings/RolesTab.svelte';
  import SharingTab from './vault-settings/SharingTab.svelte';
  import FederationTab from './vault-settings/FederationTab.svelte';
  import SettingsConfirms from './vault-settings/SettingsConfirms.svelte';

  interface Props { onclose: () => void; }
  const { onclose }: Props = $props();

  type Tab = 'members' | 'invites' | 'roles' | 'sharing' | 'federation';
  let tab = $state<Tab>('members');

  const s = new VaultSettingsController();
  s.install();

  const tabLabel = (t: Tab): string => {
    switch (t) {
      case 'members': return `Members (${vaultMembers.members.length})`;
      case 'invites': return `Invites (${vaultMembers.invites.filter(isInviteActive).length})`;
      case 'roles': return `Roles (${vaultMembers.roles.length})`;
      case 'sharing': return 'Sharing';
      case 'federation': return `Federation (${federation.federations.length})`;
    }
  };

  // Hydrate when the modal mounts.
  onMount(() => {
    void vaultMembers.openVault(vaults.selectedID);
    void federation.openVault(vaults.selectedID);
    window.addEventListener('keydown', handleKey);
    void tick().then(() => panelEl?.querySelector<HTMLElement>('.tab.active')?.focus());
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    restoreFocus();
    // Don't clear() here — other consumers may still render off this
    // store. Refreshes are explicit.
  });

  // ---- keyboard ---------------------------------------------------------
  // Esc / q (outside text fields) closes the topmost layer (a confirm,
  // an inline form, then the modal). ←/→ or [ ] or 1–5 switch tabs;
  // j/k/gg/G walk the rows of the current tab, Enter/l enters a row
  // (focuses its first control); Tab cycles inside the dialog.
  const TABS: Tab[] = ['members', 'invites', 'roles', 'sharing', 'federation'];
  let panelEl = $state<HTMLElement | null>(null);
  const restoreFocus = captureFocus();
  const chord = newChord();

  async function selectTab(t: Tab): Promise<void> {
    tab = t;
    await tick();
    panelEl?.querySelector<HTMLElement>(`#vs-tab-${t}`)?.focus();
  }

  function onPanelKey(e: KeyboardEvent): void {
    e.stopPropagation();
    const root = e.currentTarget as HTMLElement;
    if (trapTab(e, root)) return;
    const text = isTextTarget(e.target);
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Escape' || (e.key === 'q' && plain && !text)) {
      handleKey(new KeyboardEvent('keydown', { key: 'Escape' }));
      e.preventDefault();
      return;
    }
    if (root !== panelEl || text || !plain) return;
    const onTab = (e.target as HTMLElement | null)?.getAttribute?.('role') === 'tab';
    const i = TABS.indexOf(tab);
    if (e.key === ']' || (onTab && e.key === 'ArrowRight') || (onTab && e.key === 'l')) {
      e.preventDefault();
      void selectTab(TABS[(i + 1) % TABS.length]);
      return;
    }
    if (e.key === '[' || (onTab && e.key === 'ArrowLeft') || (onTab && e.key === 'h')) {
      e.preventDefault();
      void selectTab(TABS[(i - 1 + TABS.length) % TABS.length]);
      return;
    }
    if (/^[1-5]$/.test(e.key)) {
      e.preventDefault();
      void selectTab(TABS[Number(e.key) - 1]);
      return;
    }
    const row = (e.target as HTMLElement | null)?.closest?.('li.row') as HTMLElement | null;
    if (row && row === e.target && (e.key === 'Enter' || e.key === 'l')) {
      e.preventDefault();
      focusables(row)[0]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'l') return; // native button activation
    rovingKey(e, panelEl?.querySelector<HTMLElement>('[role="tabpanel"]') ?? null, 'li.row', null, { chord, halfPage: 5 });
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (!s.dismiss()) onclose();
  }
</script>

<div
  class="overlay"
  role="presentation"
  onclick={onclose}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="vs-title"
    tabindex="-1"
    bind:this={panelEl}
    data-testid="vault-settings"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onPanelKey}
  >
    <header class="panel-head">
      <div class="title">
        <h2 id="vs-title">{vaults.selected?.name ?? 'Vault'}</h2>
        <span class="slug">{vaults.selected?.slug ?? ''}</span>
      </div>
      <button class="close" type="button" aria-label="Close" onclick={onclose}>×</button>
    </header>

    <div class="tabs" role="tablist" aria-label="Vault settings sections">
      {#each TABS as t (t)}
        <button
          type="button"
          class="tab"
          class:active={tab === t}
          role="tab"
          id="vs-tab-{t}"
          aria-controls="vs-panel-{t}"
          aria-selected={tab === t}
          tabindex={tab === t ? 0 : -1}
          onclick={() => (tab = t)}
        >{tabLabel(t)}</button>
      {/each}
    </div>

    {#if vaultMembers.loading}
      <div class="placeholder">Loading…</div>
    {:else if vaultMembers.lastError}
      <div class="error">{vaultMembers.lastError}</div>
    {/if}

    {#if tab === 'members'}
      <MembersTab {s} />
    {:else if tab === 'invites'}
      <InvitesTab {s} />
    {:else if tab === 'roles'}
      <RolesTab {s} />
    {:else if tab === 'sharing'}
      <SharingTab {s} />
    {:else if tab === 'federation'}
      <FederationTab {s} />
    {/if}

    <SettingsConfirms {s} onkey={onPanelKey} />
  </div>
</div>

<style>
  /* The modal's own overlay and panel. */
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-overlay-bg) 55%, rgba(0, 0, 0, 0.45));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
    padding: 1rem;
  }
  .panel {
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    animation: ui-rise 140ms var(--ease);
    width: min(640px, 100%);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    outline: none;
  }

  /* Everything inside it, including the tab components and the nested
     confirm dialogs, scoped to this overlay. */
  .overlay :global {
    .overlay {
      position: fixed;
      inset: 0;
      background: color-mix(in srgb, var(--color-overlay-bg) 55%, rgba(0, 0, 0, 0.45));
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
      border: 1px solid var(--hairline);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-pop);
      animation: ui-rise 140ms var(--ease);
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
    .tab:hover { color: var(--color-text); }
    .tab.active {
      color: var(--color-text);
      border-bottom-color: var(--color-primary);
    }
    .tab:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
    .row:focus { outline: none; }
    .row:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; background: var(--tint-active); }

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
      border: 1px solid var(--hairline);
      border-radius: var(--radius);
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
    .badge.state-used { color: var(--color-text-dim, var(--color-muted)); }
    .badge.state-severed { color: var(--color-warning, var(--color-secondary)); border-color: currentColor; }
    .badge.fed-home { color: var(--color-primary); border-color: currentColor; }
    .badge.fed-follower { color: var(--color-secondary); border-color: currentColor; }

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
    .form-row.two {
      grid-template-columns: 2fr 1fr;
    }
    .fed-section {
      margin-top: 1.1rem;
    }
    .token-once {
      margin-bottom: 0.7rem;
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
    .fed-mode, .fed-publish { border: 1px solid var(--hairline); border-radius: var(--radius); padding: 8px 12px; display: grid; gap: 6px; margin: 0; }
    .fed-mode legend, .fed-publish legend { font-size: var(--text-xs); color: var(--color-text-dim); padding: 0 4px; }
    label.inline { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .consent-text { margin: 4px 0 0; padding: 8px 10px; border-radius: var(--radius); background: color-mix(in srgb, var(--color-warning) 12%, transparent); font-size: var(--text-xs); line-height: 1.5; }
  }
</style>
