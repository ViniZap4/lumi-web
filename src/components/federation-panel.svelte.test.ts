// @vitest-environment jsdom
//
// Book settings → Federation: mirror rows (M2: lag, pending deletes,
// erasure warning, integrity) and the mirror invite with publish
// consent (M3): the invite carries mode "mirror" + publish only after
// the owner ticks the consent; indexing is off by default.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

vi.mock('../lib/api.ts', async (orig) => {
  const actual = await orig<typeof import('../lib/api.ts')>();
  return {
    ...actual,
    listVaultMembers: vi.fn(async () => [{ vault_id: 'v1', user_id: 'u1', role_id: 'r1', username: 'ana', display_name: 'Ana', role_name: 'Admin', capabilities: ['*'], joined_at: '' }]),
    listVaultRoles: vi.fn(async () => [{ id: 'r1', vault_id: 'v1', name: 'Admin', capabilities: ['*'], is_seed: true }]),
    listVaultInvites: vi.fn(async () => []),
    listFederations: vi.fn(async () => [
      { id: 'f1', vault_id: 'v1', role: 'home', peer_url: 'https://mirror.example', status: 'active', last_acked_seq: 0, created_at: '2026-11-01T00:00:00Z', mode: 'mirror', mirror_acked_seq: 95, head_seq: 100, lag_seq: 5, pending_deletes: 1, oldest_pending_delete_at: '2026-11-20T00:00:00Z', erasure_lagging: true },
    ]),
    listFederationInvites: vi.fn(async () => []),
    listFederatedMembers: vi.fn(async () => []),
    createFederationInvite: vi.fn(async () => ({ token: 'fed-tok', vault_id: 'v1', created_at: '', used: false, revoked: false })),
  };
});
vi.mock('../lib/auth.svelte.ts', () => ({ auth: { user: { id: 'u1', username: 'ana' } } }));

import VaultSettingsModal from './VaultSettingsModal.svelte';
import * as api from '../lib/api.ts';
import { vaults } from '../lib/vaults.svelte.ts';
import { federation } from '../lib/federation.svelte.ts';
import { vaultMembers } from '../lib/vaultmembers.svelte.ts';

let target: HTMLElement;
let cmp: Record<string, any> | null = null;
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}
const btn = (text: string) => [...target.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
const q = <T extends Element = HTMLInputElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`) as T;
function check(el: HTMLInputElement): void {
  el.click();
  flushSync();
}

beforeEach(async () => {
  vaults.selectedID = 'v1';
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(VaultSettingsModal, { target, props: { onclose: () => {} } });
  await settle();
  btn('Federation').click();
  await settle();
});
afterEach(async () => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  await federation.openVault(null);
  await vaultMembers.openVault(null);
  vaults.selectedID = null;
});

describe('federations panel', () => {
  it('shows a mirror row with lag, pending deletes and the erasure warning (pt-BR)', () => {
    const row = q<HTMLElement>('federation-row');
    expect(row.textContent).toContain('Espelho somente leitura');
    expect(row.textContent).toContain('Atraso do espelho: 5 alterações (confirmou 95 de 100)');
    expect(row.textContent).toContain('Exclusões pendentes: 1');
    expect(q<HTMLElement>('erasure-lagging').textContent).toMatch(/LGPD/);
  });

  it('mirror invite with publish: consent required, index off by default, payload', async () => {
    btn('+ New federation invite').click();
    flushSync();
    check(q('fed-mode-mirror'));
    check(q('fed-publish-allow'));
    expect(q('fed-publish-index').checked).toBe(false);
    expect(q<HTMLElement>('fed-publish-consent-text').textContent).toMatch(/qualquer pessoa na internet/);
    // Without consent: refused, nothing sent.
    target.querySelector<HTMLFormElement>('form.create-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api.createFederationInvite).not.toHaveBeenCalled();
    expect(target.textContent).toContain('Confirme que entende que as notas ficarão públicas.');
    check(q('fed-publish-consent'));
    target.querySelector<HTMLFormElement>('form.create-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api.createFederationInvite).toHaveBeenCalledWith('v1', expect.objectContaining({ mode: 'mirror', publish: { allowed: true, scope: 'flagged', index: false } }));
  });
});
