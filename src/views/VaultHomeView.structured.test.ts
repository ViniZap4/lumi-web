// @vitest-environment jsdom
//
// Part 2 note-view switch: a kanban note opens as a board and a
// `.canvas` file as a canvas, each on its own live session; board keys
// reach the server doc as CRDT updates (no /diff), and Source opens
// the regular editor.

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

const BODY = '## Todo\n\n- [ ] alpha\n- [ ] beta\n\n## Done\n\n- [x] gamma\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%';
const CANVAS = '{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"Hello canvas","x":0,"y":0,"width":200,"height":60}\n\t],\n\t"edges":[]\n}';

const EP = Element.prototype as any;
EP.getAnimations ??= () => [];
EP.animate ??= () => ({ cancel() {}, finish() {}, finished: Promise.resolve(), onfinish: null });

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

beforeEach(async () => {
  // No "last opened note" carried over between tests.
  localStorage.clear();
  sessionStorage.clear();
  fakeServer.reset();
  // The server's doc was initialised from the markdown file (InitFromText).
  fakeServer.seed('n1/sync', BODY);
  fakeServer.seed('c1/sync', CANVAS);
  vi.mocked(api.listNotes).mockResolvedValue({
    notes: [
      { id: 'n1', vault_id: 'v1', path: 'board.md', title: 'Board', created_at: '', updated_at: '' },
      { id: 'c1', vault_id: 'v1', path: 'plan.canvas', title: 'Plan', created_at: '', updated_at: '' },
    ],
    limit: 200,
    offset: 0,
  } as any);
  // Default: an older server without the ticket endpoint (→ ?token=).
  vi.mocked(api.createNoteWsTicket).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  vi.mocked(api.getNoteContent).mockImplementation(async (_v: string, id: string) =>
    id === 'c1'
      ? { id: 'c1', vault_id: 'v1', path: 'plan.canvas', frontmatter: {}, body: CANVAS, kind: 'canvas' as const }
      : { id: 'n1', vault_id: 'v1', path: 'board.md', frontmatter: { 'kanban-plugin': 'board' }, body: BODY });
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

function key(el: Element, k: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  flushSync();
  return ev;
}

describe('VaultHomeView structured notes', () => {
  it('a kanban note opens as a live board; keys write CRDT updates', async () => {
    cmp = mount(VaultHomeView, { target });
    await settle();
    await notes.select('n1');
    const board = await waitFor(() => target.querySelector<HTMLElement>('[data-testid="kanban-board"]'), 'board');
    expect(target.querySelector('article.rendered')).toBeNull();
    // Live once the session has synced (status badge cleared).
    await waitFor(() => !target.querySelector('[data-testid="kanban-status"]'), 'live board');
    // Opens in Reading (SPEC-PARTE2 §5a): J changes nothing until `e`.
    expect(target.querySelector('[data-testid="structured-note"]')!.getAttribute('data-mode')).toBe('read');
    key(board, 'J');
    await settle();
    expect(fakeServer.text('n1/sync')).toBe(BODY);
    key(board, 'e');
    expect(target.querySelector('[data-testid="structured-note"]')!.getAttribute('data-mode')).toBe('edit');
    key(board, 'J');
    await settle();
    expect(fakeServer.text('n1/sync')).toContain('- [ ] beta\n- [ ] alpha\n');
    expect(fakeServer.text('n1/sync').endsWith('%%')).toBe(true);
    expect(api.applyNoteDiff).not.toHaveBeenCalled();
    // Source opens the regular editor; the board session is gone.
    const src = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Source')!;
    src.click();
    await waitFor(() => target.querySelector('.cm-content'), 'editor');
    expect(target.querySelector('[data-testid="kanban-board"]')).toBeNull();
  });

  it('a .canvas file opens as a canvas', async () => {
    cmp = mount(VaultHomeView, { target });
    await settle();
    // The book opens on its home (no note yet); then open the canvas.
    await waitFor(() => notes.list.length > 0 && !notes.loadingList, 'notes');
    await notes.select('c1');
    await waitFor(() => target.querySelector('[data-testid="canvas-view"]'), 'canvas');
    expect(target.textContent).toContain('Hello canvas');
  });

  it('markdown notes still get the reader', async () => {
    vi.mocked(api.getNoteContent).mockResolvedValue({ id: 'n1', vault_id: 'v1', path: 'board.md', frontmatter: {}, body: '# Plain' });
    cmp = mount(VaultHomeView, { target });
    await settle();
    await notes.select('n1');
    await waitFor(() => target.querySelector('article.rendered'), 'reader');
    expect(target.querySelector('[data-testid="structured-note"]')).toBeNull();
  });

  // Owner: "o canvas trava ao abrir, depois de dar reload ele volta".
  // In-app opens run inside a view transition and focused the reader
  // wrapper when it finished, i.e. AFTER the canvas focused itself on
  // mount: the canvas then ignored every key until a click.
  it('a canvas opened from the explorer keeps the keyboard after the view transition', async () => {
    const d = document as any;
    const had = d.startViewTransition;
    d.startViewTransition = (cb: () => unknown) => {
      const done = Promise.resolve().then(cb).then(() => new Promise((r) => setTimeout(r, 40)));
      return { finished: done, ready: Promise.resolve(), updateCallbackDone: done };
    };
    try {
      cmp = mount(VaultHomeView, { target });
      await waitFor(() => notes.vaultID === 'v1' && !notes.loadingList && notes.list.length > 0, 'notes');
      await settle();
      const press = async (k: string) => {
        const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        await settle();
      };
      const rows = () => Array.from(target.querySelectorAll('[data-testid="col-fx-cur"] [role="option"] .name')).map((e) => e.textContent);
      const openRow = async (name: string) => {
        if (!target.querySelector('[data-testid="floating-explorer"]')) target.querySelector<HTMLButtonElement>('[data-testid="explorer-button"]')!.click();
        await waitFor(() => document.activeElement?.closest('[data-testid="floating-explorer"]'), 'explorer focus');
        await press('g');
        await press('g');
        for (let k = 0; k < rows().indexOf(name); k++) await press('j');
        await press('Enter');
        await waitFor(() => !target.querySelector('[data-testid="floating-explorer"]'), 'explorer closed');
      };
      await openRow('Plan');
      const cv = await waitFor(() => target.querySelector<HTMLElement>('[data-testid="canvas-view"]'), 'canvas');
      await new Promise((r) => setTimeout(r, 80)); // past the transition
      await settle();
      expect(document.activeElement).toBe(cv);
      // …and it acts on the keys: `l` pans the view.
      const world = cv.querySelector<HTMLElement>('.cv-world')!;
      const before = world.style.transform;
      key(cv, 'l');
      expect(world.style.transform).not.toBe(before);
    } finally {
      d.startViewTransition = had;
    }
  });
});
