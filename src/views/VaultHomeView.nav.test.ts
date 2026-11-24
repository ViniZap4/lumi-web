// @vitest-environment jsdom
//
// The book shell with the floating explorer as the ONLY navigation
// (SPEC-PARTE2 §2, owner decision 2026-11-24): a book opens on its last
// note (per book, per device) or on a calm empty home with the explorer
// floating on top; `-`, the top-bar button, the palette and `:explore`
// open it; `gb` opens it at the books level; `[`/`]` still cycle books;
// file operations run inside it; splits, deep links and a 10k-note book
// keep working.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return {
    ...actual,
    listNotes: vi.fn(),
    getNoteContent: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
  };
});

import VaultHomeView from './VaultHomeView.svelte';
import * as api from '../lib/api.ts';
import { vaults } from '../lib/vaults.svelte.ts';
import { notes, PAGE_SIZE } from '../lib/notes.svelte.ts';
import { accounts } from '../lib/accounts.svelte.ts';
import { books } from '../lib/books.svelte.ts';
import { uiState } from '../lib/uistate.svelte.ts';
import { toasts } from '../lib/toasts.svelte.ts';
import { LAST_NOTE_KEY } from '../lib/book-home.ts';
import type { NoteSummary } from '../lib/types.ts';

// jsdom has no Web Animations: svelte's transitions need a stand-in.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.getAnimations ??= () => [];

const note = (id: string, path: string, title = id, updated = '2026-01-01T00:00:00Z'): NoteSummary => ({
  id, vault_id: 'v1', path, title, created_at: '2026-01-01T00:00:00Z', updated_at: updated,
});

const VAULT = [
  note('two', 'two.md', 'Two', '2026-01-02T00:00:00Z'),
  note('inner', 'alpha/inner.md', 'Inner', '2026-01-05T00:00:00Z'),
  note('deep', 'alpha/nested/deep.md', 'Deep', '2026-01-04T00:00:00Z'),
  note('b1', 'beta/b1.md', 'B1', '2026-01-03T00:00:00Z'),
  note('one', 'one.md', 'One', '2026-01-01T00:00:00Z'),
];

let target: HTMLElement;
let cmp: Record<string, any> | null = null;

function serve(all: NoteSummary[]) {
  vi.mocked(api.listNotes).mockImplementation(async (_v, o = {}) => {
    const off = o.offset ?? 0;
    const lim = Math.min(o.limit ?? 50, PAGE_SIZE);
    return { notes: all.slice(off, off + lim), limit: lim, offset: off };
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
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

async function press(...keys: string[]): Promise<void> {
  for (const key of keys) {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (document.activeElement && document.activeElement !== document.body ? document.activeElement : window).dispatchEvent(ev);
    await settle();
  }
}

async function ctrl(key: string): Promise<void> {
  const ev = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
  (document.activeElement && document.activeElement !== document.body ? document.activeElement : window).dispatchEvent(ev);
  await settle();
}

const fx = () => target.querySelector<HTMLElement>('[data-testid="floating-explorer"]');
const fxRows = () => Array.from(target.querySelectorAll('[data-testid="col-fx-cur"] [role="option"] .name')).map((e) => e.textContent);
const fxCursor = () => target.querySelector('[data-testid="col-fx-cur"] [aria-selected="true"] .name')?.textContent ?? null;
const home = () => target.querySelector<HTMLElement>('[data-testid="book-home"]');
const openTitle = () => target.querySelector('.crumb-note')?.textContent ?? null;
const legend = () => target.querySelector('[data-testid="command-legend"]')?.textContent ?? '';

async function mountView(): Promise<void> {
  cmp = mount(VaultHomeView, { target });
  await waitFor(() => notes.vaultID === 'v1' && !notes.loadingList && notes.list.length > 0, 'notes');
  await settle();
}

/** Open note `name` through the floating explorer (rows by title). */
async function openThroughExplorer(...path: string[]): Promise<void> {
  if (!fx()) await press('-');
  await waitFor(fx, 'explorer');
  await press('g', 'h');
  for (const name of path) {
    const i = fxRows().indexOf(name);
    expect(i, `row ${name} in ${fxRows().join(',')}`).toBeGreaterThanOrEqual(0);
    await press('g', 'g');
    for (let k = 0; k < i; k++) await press('j');
    await press('l');
  }
  await waitFor(() => !fx() && notes.content, 'note open');
}

beforeEach(async () => {
  try { localStorage.clear(); } catch { /* none */ }
  serve(VAULT);
  vi.mocked(api.getNoteContent).mockImplementation(async (_v, id) => ({
    id, vault_id: 'v1', path: VAULT.find((n) => n.id === id)?.path ?? `${id}.md`, frontmatter: {}, body: `# body of ${id}\n\nsee [one](/one.md)`,
  }));
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
  toasts.clear();
  uiState.pendingNote = null;
  uiState.helpOpen = false;
});

describe('opening a book', () => {
  it('no last note: a calm home (name, recent notes, sync) with the explorer floating on top', async () => {
    await mountView();
    expect(home()).not.toBeNull();
    expect(home()!.querySelector('.home-title')!.textContent).toBe('Vault');
    // Recent notes, most recently updated first.
    const recent = Array.from(home()!.querySelectorAll('.recent-title')).map((e) => e.textContent);
    expect(recent).toEqual(['Inner', 'Deep', 'B1', 'Two', 'One']);
    expect(home()!.querySelector('.sync-dot-wrap')).not.toBeNull();
    // No explorer column, no books sidebar: only the floating overlay.
    expect(target.querySelector('[data-testid="miller"]')).toBeNull();
    expect(target.querySelector('.col-parent, .col-current')).toBeNull();
    await waitFor(fx, 'auto-opened explorer');
    expect(fx()!.getAttribute('data-level')).toBe('files');
    expect(fxRows()).toEqual(['alpha', 'beta', 'One', 'Two']);
    expect(fx()!.contains(document.activeElement)).toBe(true);
  });

  it('opening a note remembers it; the book reopens on it (per book, per device)', async () => {
    await mountView();
    await openThroughExplorer('alpha', 'Inner');
    expect(openTitle()).toBe('Inner');
    expect(localStorage.getItem(LAST_NOTE_KEY + 'v1')).toBe('inner');
    unmount(cmp!);
    cmp = null;
    await notes.openVault(null);
    await mountView();
    await waitFor(() => notes.selectedID === 'inner' && openTitle() === 'Inner', 'restored note');
    expect(home()).toBeNull();
    expect(fx()).toBeNull();
  });

  it('a last note that no longer exists falls back to the home + explorer', async () => {
    localStorage.setItem(LAST_NOTE_KEY + 'v1', 'gone');
    await mountView();
    expect(home()).not.toBeNull();
    await waitFor(fx, 'explorer');
  });

  it('an empty book: home says so, the explorer still floats', async () => {
    serve([]);
    cmp = mount(VaultHomeView, { target });
    await waitFor(() => notes.vaultID === 'v1' && !notes.loadingList, 'list');
    await settle();
    expect(home()!.textContent).toContain('This book is empty');
    await waitFor(fx, 'explorer');
    expect(fx()!.textContent).toContain('Empty folder');
  });

  it('a deep link opens its note directly (no overlay)', async () => {
    uiState.pendingNote = { vault: 'v1', note: 'deep' };
    await mountView();
    await waitFor(() => openTitle() === 'Deep', 'deep link');
    expect(fx()).toBeNull();
    expect(window.location.hash).toBe('#/b/v1/n/deep');
  });
});

describe('the floating explorer is the only navigation', () => {
  it('- in the reader opens it at the note folder; Esc closes it back to the note', async () => {
    await mountView();
    await openThroughExplorer('alpha', 'nested', 'Deep');
    await press('-');
    await waitFor(fx, 'explorer');
    expect(fxRows()).toEqual(['Deep']);
    expect(fxCursor()).toBe('Deep');
    await press('Escape');
    expect(fx()).toBeNull();
    expect(openTitle()).toBe('Deep');
  });

  it('h in the reader and the top-bar Explorer button open it too', async () => {
    await mountView();
    await openThroughExplorer('Two');
    await press('h');
    await waitFor(fx, 'explorer via h');
    await press('q');
    target.querySelector<HTMLButtonElement>('[data-testid="explorer-button"]')!.click();
    await waitFor(fx, 'explorer via button');
    expect(target.querySelector('[data-testid="explorer-button"]')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('the palette: "Open explorer" and :explore', async () => {
    await mountView();
    await openThroughExplorer('One');
    await press(' ');
    const input = await waitFor(() => target.querySelector<HTMLInputElement>('[data-testid="palette"] input'), 'palette');
    input.value = 'open explorer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(fx, 'explorer from palette');
    await press('Escape');
    await press(':');
    const ex = await waitFor(() => target.querySelector<HTMLInputElement>('[data-testid="palette"] input'), 'ex line');
    ex.value = 'explore';
    ex.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    ex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(fx, 'explorer from :explore');
  });

  it('home: j/k walk the recent notes, Enter opens one; q closes the note back to the home', async () => {
    await mountView();
    await waitFor(fx, 'explorer');
    await press('Escape');
    expect(fx()).toBeNull();
    await press('j');
    expect((document.activeElement as HTMLElement).dataset.recent).toBe('0');
    await press('j');
    expect(document.activeElement!.textContent).toContain('Deep');
    (document.activeElement as HTMLButtonElement).click();
    await waitFor(() => openTitle() === 'Deep', 'opened recent');
    await press('q');
    await waitFor(home, 'home again');
    expect(notes.selectedID).toBeNull();
    expect(localStorage.getItem(LAST_NOTE_KEY + 'v1')).toBeNull();
  });

  it('H / L walk the notes opened before', async () => {
    await mountView();
    await openThroughExplorer('One');
    await openThroughExplorer('Two');
    await press('H');
    await waitFor(() => openTitle() === 'One', 'back');
    await press('L');
    await waitFor(() => openTitle() === 'Two', 'forward');
  });

  it('the legend follows: home, explorer, books level', async () => {
    await mountView();
    await waitFor(fx, 'explorer');
    expect(legend()).toMatch(/right/);
    expect(legend()).toMatch(/below/);
    await press('Escape');
    expect(legend()).toMatch(/explorer/);
    expect(legend()).toMatch(/new note/);
    await press('g', 'b');
    await waitFor(() => fx()?.getAttribute('data-level') === 'books', 'books');
    expect(legend()).toMatch(/abrir livro/);
  });

  it('narrow screens: the overlay is a full-height sheet', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 720px'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      await mountView();
      await waitFor(fx, 'explorer');
      expect(fx()!.classList.contains('sheet')).toBe(true);
      expect(target.querySelector<HTMLElement>('[data-testid="col-fx-cur"] [role="option"]')!.style.height).toBe('44px');
    } finally {
      window.matchMedia = mm;
    }
  });
});

describe('books float too', () => {
  beforeEach(() => {
    books.addCreated({ id: 'v2', name: 'Other', slug: 'other', created_by: 'u1', created_at: '', owner_user_id: 'u1' }, 'https://lumi.work.com#ana');
    books.setActive('v1');
  });

  it('gb opens the explorer at the books level; Enter switches the book', async () => {
    await mountView();
    await openThroughExplorer('One');
    await press('g', 'b');
    await waitFor(() => fx()?.getAttribute('data-level') === 'books', 'books level');
    const names = Array.from(target.querySelectorAll('[data-testid="fx-books-list"] .fx-row-name')).map((e) => e.textContent);
    expect(names).toEqual(['Vault', 'Other']);
    await press('j', 'Enter');
    await waitFor(() => books.activeID === 'v2', 'switched');
    expect(books.pickerOpen).toBe(false);
  });

  it('the book button opens the books level; [ and ] still cycle', async () => {
    await mountView();
    await waitFor(fx, 'explorer');
    await press('Escape');
    target.querySelector<HTMLButtonElement>('[data-testid="book-switcher"]')!.click();
    await waitFor(() => fx()?.getAttribute('data-level') === 'books', 'books level');
    await press('Escape');
    await press(']');
    expect(books.activeID).toBe('v2');
    await press('[');
    expect(books.activeID).toBe('v1');
  });
});

describe('file operations run inside the overlay', () => {
  function serveMutable(): NoteSummary[] {
    const served = [...VAULT];
    serve(served);
    let n = 0;
    vi.mocked(api.createNote).mockImplementation(async (_v, input) => {
      const id = `new${++n}`;
      const created = note(id, `${id}.md`, input.title);
      served.unshift(created);
      return created;
    });
    vi.mocked(api.updateNote).mockImplementation(async (_v, id, input) => {
      const i = served.findIndex((x) => x.id === id);
      served[i] = { ...served[i], ...(input.path ? { path: input.path } : {}), ...(input.title ? { title: input.title } : {}) };
      return served[i];
    });
    vi.mocked(api.deleteNote).mockImplementation(async (_v, id) => {
      const i = served.findIndex((x) => x.id === id);
      served.splice(i, 1);
    });
    return served;
  }

  async function typePrompt(text: string): Promise<void> {
    const input = await waitFor(() => target.querySelector<HTMLInputElement>('.fx-input'), 'prompt input');
    expect(document.activeElement).toBe(input);
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    input.form!.requestSubmit();
    await settle();
  }

  it('a in the reader: the explorer opens at the note folder with the new-note prompt', async () => {
    serveMutable();
    await mountView();
    await openThroughExplorer('alpha', 'Inner');
    await press('a');
    await waitFor(fx, 'explorer');
    await typePrompt('Fresh');
    await waitFor(() => vi.mocked(api.updateNote).mock.calls.length > 0, 'move into folder');
    expect(api.createNote).toHaveBeenCalledWith('v1', { title: 'Fresh', body: '' });
    expect(api.updateNote).toHaveBeenCalledWith('v1', 'new1', { path: 'alpha/new1.md' });
  });

  it('r in the reader renames the open note', async () => {
    serveMutable();
    await mountView();
    await openThroughExplorer('One');
    await press('r');
    await typePrompt('Uno');
    await waitFor(() => vi.mocked(api.updateNote).mock.calls.length > 0, 'rename');
    expect(api.updateNote).toHaveBeenCalledWith('v1', 'one', { title: 'Uno' });
  });

  it('the reader context menu: Delete asks in the overlay; y deletes and the home returns', async () => {
    serveMutable();
    await mountView();
    await openThroughExplorer('Two');
    const reader = target.querySelector<HTMLElement>('.rendered')!;
    reader.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await settle();
    const del = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.includes('Delete'))!;
    del.click();
    await waitFor(() => target.querySelector('[data-testid="delete-confirm"]'), 'confirm');
    await press('y');
    await waitFor(() => vi.mocked(api.deleteNote).mock.calls.length > 0, 'delete');
    expect(api.deleteNote).toHaveBeenCalledWith('v1', 'two');
    await waitFor(home, 'home');
  });
});

describe('note splits (SPEC-PARTE2 §3)', () => {
  const panes = () => target.querySelectorAll('[data-testid="note-pane"]');

  it('Ctrl-w v splits the note, Ctrl-w l/h move between panes, Ctrl-w q closes', async () => {
    await mountView();
    await openThroughExplorer('Two');
    await ctrl('w');
    await press('v');
    await waitFor(() => panes().length === 1 && target.querySelector('[data-testid="pane-host"]'), 'split');
    expect(target.querySelector('[data-testid="primary-pane"]')).not.toBeNull();
    await waitFor(() => panes()[0].querySelector('.md-body')?.textContent?.includes('body of two'), 'pane body');
    await ctrl('w');
    await press('h');
    expect(target.querySelector('[data-testid="primary-pane"]')!.contains(document.activeElement)).toBe(true);
    await ctrl('w');
    await press('l');
    expect(panes()[0].contains(document.activeElement)).toBe(true);
    await ctrl('w');
    await press('q');
    await waitFor(() => panes().length === 0, 'closed');
    expect(target.querySelector('[data-testid="pane-host"]')).toBeNull();
  });

  it('Ctrl-v in the explorer opens in a vertical split; the layout is remembered per book', async () => {
    await mountView();
    await openThroughExplorer('Two');
    await press('-');
    await waitFor(fx, 'explorer');
    await press('k'); // One
    await ctrl('v');
    await waitFor(() => panes().length === 1, 'split');
    expect(fx()).toBeNull();
    const saved = JSON.parse(localStorage.getItem('lumi.panes.v1:v1') ?? 'null');
    expect(saved?.state?.root?.dir).toBe('row');
  });
});

describe('pane zoom, click-to-focus and mouse splits (SPEC-PARTE2 §3)', () => {
  const panes = () => target.querySelectorAll<HTMLElement>('[data-testid="note-pane"]');
  const cellHidden = (el: Element) => !!el.closest('.pane-cell')?.classList.contains('zoom-hide');
  async function twoPanes(): Promise<void> {
    await mountView();
    await openThroughExplorer('Two');
    await ctrl('w');
    await press('v');
    await waitFor(() => panes().length === 1, 'split');
  }

  it('Ctrl-w z zooms the focused pane (others hidden, not closed) and back; badges show', async () => {
    await twoPanes();
    await ctrl('w');
    await press('z');
    const primary = target.querySelector('[data-testid="primary-pane"]')!;
    await waitFor(() => cellHidden(primary), 'primary hidden');
    expect(panes().length).toBe(1);
    expect(cellHidden(panes()[0])).toBe(false);
    expect(panes()[0].querySelector('[data-testid="zoom-badge"]')).not.toBeNull();
    // The zoomed cell fills the split (flex-grow 1, not its 0.5 share).
    expect((panes()[0].closest('.pane-cell') as HTMLElement).style.flex).toMatch(/^1 1 0(px)?$/);
    expect(target.querySelector('[data-testid="status-zoom"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="pane-divider"]')).toBeNull();
    await ctrl('w');
    await press('z');
    await waitFor(() => !cellHidden(primary), 'restored');
    expect(target.querySelector('[data-testid="status-zoom"]')).toBeNull();
    expect(target.querySelector('[data-testid="pane-divider"]')).not.toBeNull();
  });

  it('moving to another pane unzooms first; the header button and double-click toggle zoom', async () => {
    await twoPanes();
    (panes()[0].querySelector('[data-testid="pane-zoom"]') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('[data-testid="status-zoom"]')).not.toBeNull();
    await ctrl('w');
    await press('h');
    expect(target.querySelector('[data-testid="status-zoom"]')).toBeNull();
    expect(target.querySelector('[data-testid="primary-pane"]')!.contains(document.activeElement)).toBe(true);
    panes()[0].querySelector('.pane-bar')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(target.querySelector('[data-testid="status-zoom"]')).not.toBeNull();
  });

  it('the first click in an unfocused pane focuses it and still performs the click', async () => {
    await twoPanes();
    await ctrl('w');
    await press('h');
    const pane = panes()[0];
    expect(pane.classList.contains('active')).toBe(false);
    const edit = pane.querySelector<HTMLButtonElement>('.pane-btn')!;
    edit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await settle();
    expect(panes()[0].classList.contains('active')).toBe(true);
    const onclick = vi.fn();
    edit.addEventListener('click', onclick);
    edit.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    edit.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('explorer rows: inline Open right / Open below, the same items in the menu, a clickable footer legend', async () => {
    await mountView();
    await openThroughExplorer('Two');
    await press('-');
    await waitFor(fx, 'explorer');
    const footer = target.querySelector('[data-testid="fx-footer"]')!;
    expect(footer.textContent).toMatch(/open/);
    expect(target.querySelector('[data-testid="fx-stat"]')?.textContent).toMatch(/items?/);
    const right = target.querySelector<HTMLButtonElement>('[data-testid="col-fx-cur"] [data-testid="row-open-right"]')!;
    right.click();
    await waitFor(() => panes().length === 1, 'opened right');
    expect(fx()).toBeNull();
    await press('-');
    await waitFor(fx, 'explorer');
    const below = target.querySelector<HTMLButtonElement>('[data-testid="col-fx-cur"] [data-testid="row-open-below"]')!;
    below.click();
    await waitFor(() => panes().length === 2, 'opened below');
  });
});

describe('a 10k-note book', () => {
  it('the explorer renders a bounded window and jumps to the end quickly', async () => {
    const many: NoteSummary[] = [];
    for (let i = 0; i < 10_000; i++) {
      // 8000 in the root, the rest spread over 20 folders.
      many.push(i < 8000 ? note(`r${i}`, `r${i}.md`, `Root note ${i}`) : note(`f${i}`, `dir${i % 20}/f${i}.md`, `Note ${i}`));
    }
    serve(many);
    const t0 = performance.now();
    cmp = mount(VaultHomeView, { target });
    await waitFor(() => notes.list.length === 10_000 && !notes.loadingList, 'all pages');
    await waitFor(() => fxRows().length > 0, 'rows');
    const mountMs = performance.now() - t0;

    const lb = target.querySelector<HTMLElement>('[data-testid="col-fx-cur"]')!;
    expect(lb.querySelector('[role="option"]')!.getAttribute('aria-setsize')).toBe('8020');
    expect(fxRows().length).toBeLessThan(100);
    // The home lists only a handful of recent notes.
    expect(home()!.querySelectorAll('.recent').length).toBe(8);

    const t1 = performance.now();
    await press('G');
    const jumpMs = performance.now() - t1;
    expect(lb.getAttribute('aria-activedescendant')).toBe('fx-cur-8019');
    expect(document.getElementById('fx-cur-8019')).not.toBeNull();
    for (let i = 0; i < 20; i++) await press('k');
    expect(lb.getAttribute('aria-activedescendant')).toBe('fx-cur-7999');

    // Smoke bounds against O(n²) regressions, not a benchmark.
    expect(mountMs).toBeLessThan(5000);
    expect(jumpMs).toBeLessThan(1000);
  });
});
