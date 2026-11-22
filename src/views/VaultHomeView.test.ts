// @vitest-environment jsdom
//
// Component test: open a note → enter edit → provider syncs against a
// simulated server doc → the editor shows the note text exactly once
// (no client-side seeding/duplication), entering edit mode is not
// cancelled by the selection effect, and Esc inside CodeMirror does
// not close the editor.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

vi.mock('y-websocket', async () => {
  const mod = await import('../test/fake-provider.ts');
  return { WebsocketProvider: mod.FakeProvider };
});

vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return {
    ...actual,
    getToken: vi.fn(() => 'tk'),
    listNotes: vi.fn(),
    getNoteContent: vi.fn(),
    applyNoteDiff: vi.fn(),
  };
});

import VaultHomeView from './VaultHomeView.svelte';
import * as api from '../lib/api.ts';
import { vaults } from '../lib/vaults.svelte.ts';
import { notes } from '../lib/notes.svelte.ts';
import { auth } from '../lib/auth.svelte.ts';
import { fakeServer, flushMicrotasks } from '../test/fake-provider.ts';

const BODY = '# Title\n\nhello world';

let target: HTMLElement;
let cmp: Record<string, any> | null = null;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await flushMicrotasks();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

async function waitFor<T>(fn: () => T | null | undefined | false, label: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await settle();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(target.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

async function openNoteAndEdit(): Promise<HTMLElement> {
  cmp = mount(VaultHomeView, { target });
  await settle();
  await notes.select('n1');
  await settle();
  const edit = await waitFor(() => findButton('Edit'), 'Edit button');
  edit.click();
  return waitFor(() => target.querySelector<HTMLElement>('.cm-content'), 'CodeMirror content');
}

beforeEach(async () => {
  fakeServer.reset();
  // The server's doc was initialised from the markdown file (InitFromText).
  fakeServer.seed('n1/sync', BODY);
  vi.mocked(api.listNotes).mockResolvedValue({
    notes: [{ id: 'n1', vault_id: 'v1', path: 'n1.md', title: 'Note 1', created_at: '', updated_at: '' }],
    limit: 200,
    offset: 0,
  } as any);
  vi.mocked(api.getNoteContent).mockResolvedValue({
    id: 'n1', vault_id: 'v1', path: 'n1.md', frontmatter: {}, body: BODY,
  });
  auth.user = { id: 'u1', username: 'ana', display_name: 'Ana' };
  vaults.list = [{ id: 'v1', name: 'Vault', slug: 'vault' } as any];
  vaults.select('v1');
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(async () => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  await notes.openVault(null);
  vaults.clear();
  auth.user = null;
});

describe('VaultHomeView editor', () => {
  it('enter edit → connect → text is unchanged (no duplication)', async () => {
    const content = await openNoteAndEdit();
    await settle();
    expect(content.textContent).toBe(BODY.replace(/\n/g, ''));
    // Line-accurate check via CodeMirror lines.
    const lines = Array.from(target.querySelectorAll('.cm-line')).map((l) => l.textContent);
    expect(lines).toEqual(BODY.split('\n'));
    // Server doc (what gets mirrored to disk) is untouched.
    expect(fakeServer.text('n1/sync')).toBe(BODY);
    // Joining never pushed the text through the LWW /diff path.
    expect(api.applyNoteDiff).not.toHaveBeenCalled();
  });

  it('stays in edit mode after entering it (selection effect does not cancel)', async () => {
    await openNoteAndEdit();
    await settle();
    expect(target.querySelector('[data-testid="note-editor"]')).not.toBeNull();
    expect(findButton('Done')).toBeDefined();
    expect(fakeServer.providers.filter((p) => !p.destroyed)).toHaveLength(1);
  });

  it('shows a read-only preview until the initial sync completes', async () => {
    fakeServer.autoSync = false;
    cmp = mount(VaultHomeView, { target });
    await settle();
    await notes.select('n1');
    await settle();
    (await waitFor(() => findButton('Edit'), 'Edit button')).click();
    await waitFor(() => target.querySelector('[data-testid="editor-syncing"]'), 'syncing banner');
    expect(target.querySelector('.cm-content')).toBeNull();

    fakeServer.providers[0].handshake();
    await waitFor(() => target.querySelector('.cm-content'), 'editor after sync');
    expect(target.querySelector('[data-testid="editor-syncing"]')).toBeNull();
    expect(fakeServer.text('n1/sync')).toBe(BODY);
  });

  it('Esc inside CodeMirror does not close the editor; Done does', async () => {
    const content = await openNoteAndEdit();
    content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.cm-content')).not.toBeNull();

    // Esc elsewhere while editing is not an exit command either.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(target.querySelector('.cm-content')).not.toBeNull();

    findButton('Done')!.click();
    await settle();
    expect(target.querySelector('.cm-content')).toBeNull();
    expect(fakeServer.providers.every((p) => p.destroyed)).toBe(true);
  });

  it('switching notes destroys the session', async () => {
    await openNoteAndEdit();
    const provider = fakeServer.providers[0];
    await notes.select(null);
    await settle();
    expect(provider.destroyed).toBe(true);
    expect(target.querySelector('.cm-content')).toBeNull();
  });
});
