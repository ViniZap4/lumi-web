// @vitest-environment jsdom
//
// End to end in the view: a note edited once online gets a persisted
// replica; after "going offline" (REST + socket unreachable) the same
// note opens editable from that replica, the status bar says "Pending
// sync…" after an edit, and creating/deleting notes is disabled.

import 'fake-indexeddb/auto';
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
    listNotes: vi.fn(),
    getNoteContent: vi.fn(),
    getNoteSnapshot: vi.fn(),
    getNote: vi.fn(),
    createNoteWsTicket: vi.fn(),
  };
});

import * as Y from 'yjs';
import VaultHomeView from './VaultHomeView.svelte';
import * as api from '../lib/api.ts';
import { vaults } from '../lib/vaults.svelte.ts';
import { notes } from '../lib/notes.svelte.ts';
import { accounts } from '../lib/accounts.svelte.ts';
import { books } from '../lib/books.svelte.ts';
import { sync } from '../lib/sync.svelte.ts';
import { offline } from '../lib/offline.svelte.ts';
import { fakeServer, flushMicrotasks } from '../test/fake-provider.ts';
import { ApiError } from '../lib/types.ts';

const BODY = 'hello world';
const NOTE = { id: 'n1', vault_id: 'v1', path: 'n1.md', title: 'Note 1', created_at: '2026-11-01T00:00:00Z', updated_at: '' };
const net = () => new ApiError(0, { error: 'network_error' });

let target: HTMLElement;
let cmp: Record<string, any> | null = null;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await flushMicrotasks();
    await tick();
    await new Promise((r) => setTimeout(r, 2));
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

const findButton = (text: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

function online(): void {
  vi.mocked(api.listNotes).mockResolvedValue({ notes: [NOTE], limit: 200, offset: 0 } as any);
  vi.mocked(api.getNoteContent).mockResolvedValue({ id: 'n1', vault_id: 'v1', path: 'n1.md', frontmatter: {}, body: BODY });
  vi.mocked(api.getNote).mockResolvedValue(NOTE as any);
  vi.mocked(api.getNoteSnapshot).mockImplementation(async () => {
    const d = fakeServer.doc('n1/sync');
    const sv = Y.encodeStateVector(d);
    return { id: 'n1', path: 'n1.md', text: d.getText('content').toString(), vector_clock: btoa(String.fromCharCode(...sv)) };
  });
}

function goOffline(): void {
  vi.mocked(api.listNotes).mockRejectedValue(net());
  vi.mocked(api.getNoteContent).mockRejectedValue(net());
  vi.mocked(api.getNote).mockRejectedValue(net());
  vi.mocked(api.getNoteSnapshot).mockRejectedValue(net());
  vi.mocked(api.createNoteWsTicket).mockRejectedValue(net());
  offline.browserOnline = false;
}

beforeEach(async () => {
  fakeServer.reset();
  fakeServer.seed('n1/sync', BODY);
  online();
  vi.mocked(api.createNoteWsTicket).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  offline.browserOnline = true;
  notes.offlineHooks = offline;
  await accounts.add(
    { server_url: 'https://lumi.work.com', username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '2026-01-01T00:00:00Z', expires_at: null, remember: true },
    'tk',
  );
  books.addCreated({ id: 'v1', name: 'Vault', slug: 'vault', created_by: 'u1', created_at: '', owner_user_id: 'u1' }, 'https://lumi.work.com#ana');
  books.setActive('v1');
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(async () => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  await notes.openVault(null);
  await offline.store.wipeAll();
  books.clear();
  for (const a of [...accounts.list]) await accounts.forget(a.key);
  vaults.clear();
});

describe('offline editing in the view', () => {
  it('reopens a note from its replica, editable while offline, and reports pending', async () => {
    // 1. Online: open, edit once → replica persisted after Step2.
    cmp = mount(VaultHomeView, { target });
    await settle();
    await notes.select('n1');
    await settle();
    (await waitFor(() => findButton('Edit'), 'Edit')).click();
    await waitFor(() => target.querySelector('.cm-content'), 'editor online');
    findButton('Done')!.click();
    await settle();
    let reps = 0;
    for (let i = 0; i < 50 && reps === 0; i++) {
      reps = (await offline.store.listReplicas()).length;
      if (!reps) await settle();
    }
    expect(reps).toBe(1);
    unmount(cmp);
    cmp = null;
    await notes.openVault(null);
    await settle();

    // 2. Reload while offline.
    goOffline();
    cmp = mount(VaultHomeView, { target });
    await waitFor(() => notes.list.length === 1 && notes.stale, 'cached list');
    expect(target.querySelector('[data-testid="list-stale"]')).not.toBeNull();
    await notes.select('n1');
    await waitFor(() => target.querySelector('[data-testid="content-stale"]'), 'replica preview');
    expect(findButton('Delete')!.disabled).toBe(true);
    expect(findButton('+ New')!.disabled).toBe(true);

    (await waitFor(() => findButton('Edit'), 'Edit offline')).click();
    const content = await waitFor(() => target.querySelector<HTMLElement>('.cm-content'), 'editor offline');
    expect(content.textContent).toBe(BODY);
    expect(target.querySelector('[data-testid="editor-syncing"]')).toBeNull();

    const s = sync.editor!.session;
    expect(s.restored).toBe(true);
    s.ytext.insert(BODY.length, '!');
    await settle();
    expect(target.querySelector('[data-testid="editor-sync-state"]')!.textContent!.trim()).toBe('Pending sync…');
    expect(sync.statusOf(books.active!).pending).toBe(true);
    expect(fakeServer.text('n1/sync')).toBe(BODY); // nothing sent while offline
  });
});
