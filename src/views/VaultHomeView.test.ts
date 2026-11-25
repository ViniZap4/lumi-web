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
    listNotes: vi.fn(),
    getNoteContent: vi.fn(),
    applyNoteDiff: vi.fn(),
    createNoteWsTicket: vi.fn(),
  };
});

import VaultHomeView from './VaultHomeView.svelte';
import * as api from '../lib/api.ts';
import { vaults } from '../lib/vaults.svelte.ts';
import { notes } from '../lib/notes.svelte.ts';
import { accounts } from '../lib/accounts.svelte.ts';
import { books } from '../lib/books.svelte.ts';
import { fakeServer, flushMicrotasks } from '../test/fake-provider.ts';
import { ApiError } from '../lib/types.ts';

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
  // Default: an older server without the ticket endpoint (→ ?token=).
  vi.mocked(api.createNoteWsTicket).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  vi.mocked(api.getNoteContent).mockResolvedValue({
    id: 'n1', vault_id: 'v1', path: 'n1.md', frontmatter: {}, body: BODY,
  });
  // The editor must use the ACTIVE BOOK's account (server + token).
  await accounts.add(
    { server_url: 'https://lumi.work.com', username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '2026-01-01T00:00:00Z', expires_at: null, remember: false },
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
  books.clear();
  for (const a of [...accounts.list]) await accounts.forget(a.key);
  vaults.clear();
});

describe('VaultHomeView editor', () => {
  it('enter edit → connect → text is unchanged (no duplication)', async () => {
    const content = await openNoteAndEdit();
    await settle();
    expect(content.textContent).toBe(BODY.replace(/\n/g, ''));
    // Line-accurate check via CodeMirror lines.
    const lines = Array.from(target.querySelectorAll('.cm-line')).map((l) => l.textContent);
    expect(lines).toEqual(BODY.split('\n'));
    // Connected to the book's account server with its token (the
    // server has no ticket endpoint in this test → legacy fallback).
    expect(fakeServer.providers[0].url).toBe('wss://lumi.work.com/api/vaults/v1/notes/n1/sync?token=tk');
    // Server doc (what gets mirrored to disk) is untouched.
    expect(fakeServer.text('n1/sync')).toBe(BODY);
    // Joining never pushed the text through the LWW /diff path.
    expect(api.applyNoteDiff).not.toHaveBeenCalled();
  });

  it('dials with a single-use ticket when the server supports it', async () => {
    vi.mocked(api.createNoteWsTicket).mockResolvedValue({ ticket: 'tkt-1', expires_at: '' });
    await openNoteAndEdit();
    await settle();
    expect(api.createNoteWsTicket).toHaveBeenCalledWith('v1', 'n1', undefined); // an edit ticket (no mode)
    expect(fakeServer.providers[0].url).toBe('wss://lumi.work.com/api/vaults/v1/notes/n1/sync?ticket=tkt-1');
  });

  it('a viewer (can_edit false) opens a READ-ONLY live view: read ticket, no edits, chip', async () => {
    vi.mocked(api.createNoteWsTicket).mockResolvedValue({ ticket: 'tkt-r', expires_at: '', mode: 'read' });
    books.canEdit = { ...books.canEdit, v1: false };
    cmp = mount(VaultHomeView, { target });
    await settle();
    await notes.select('n1');
    await settle();
    (await waitFor(() => findButton('Ao vivo'), 'Ao vivo button')).click();
    await waitFor(() => target.querySelector('.cm-content'), 'editor');
    await settle();
    expect(api.createNoteWsTicket).toHaveBeenCalledWith('v1', 'n1', 'read');
    expect(target.querySelector('[data-testid="read-only-live"]')?.textContent).toBe('Somente leitura');
    expect(target.querySelector('[data-testid="note-editor"]')?.getAttribute('data-readonly')).toBe('true');
    // Remote edits arrive live.
    fakeServer.doc('n1/sync').getText('content').insert(0, 'LIVE ');
    await settle();
    expect(target.querySelector('.cm-content')!.textContent!.startsWith('LIVE ')).toBe(true);
    expect(fakeServer.providers[0].awareness.getLocalState()).toBeNull();
    expect(fakeServer.text('n1/sync')).toBe('LIVE ' + BODY);
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
