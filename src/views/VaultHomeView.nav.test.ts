// @vitest-environment jsdom
//
// Miller-column browser (wave 3): column rendering from note paths,
// yazi keyboard grammar, filter, mouse, ARIA wiring, preserved book
// chords, and a 10k-note performance smoke test.

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
  };
});

import VaultHomeView from './VaultHomeView.svelte';
import * as api from '../lib/api.ts';
import { vaults } from '../lib/vaults.svelte.ts';
import { notes, PAGE_SIZE } from '../lib/notes.svelte.ts';
import { accounts } from '../lib/accounts.svelte.ts';
import { books } from '../lib/books.svelte.ts';
import type { NoteSummary } from '../lib/types.ts';

const note = (id: string, path: string, title = id): NoteSummary => ({
  id, vault_id: 'v1', path, title, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});

const VAULT = [
  note('two', 'two.md', 'Two'),
  note('inner', 'alpha/inner.md', 'Inner'),
  note('deep', 'alpha/nested/deep.md', 'Deep'),
  note('b1', 'beta/b1.md', 'B1'),
  note('one', 'one.md', 'One'),
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

const col = (id: string) => target.querySelector<HTMLElement>(`[data-testid="col-${id}"]`);
const rows = (id: string) => Array.from(col(id)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
const names = (id: string) => rows(id).map((r) => r.querySelector('.name')!.textContent);
const cursorName = (id: string) => col(id)?.querySelector('[aria-selected="true"] .name')?.textContent ?? null;
const crumbs = () =>
  Array.from(target.querySelectorAll('[data-testid="breadcrumb"] .crumb:not(.back)')).map((b) => b.textContent);

async function mountView(): Promise<void> {
  cmp = mount(VaultHomeView, { target });
  await waitFor(() => rows('cur').length > 0, 'current column');
}

beforeEach(async () => {
  serve(VAULT);
  vi.mocked(api.getNoteContent).mockImplementation(async (_v, id) => ({
    id, vault_id: 'v1', path: `${id}.md`, frontmatter: {}, body: `# body of ${id}`,
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
});

describe('miller browser — layout', () => {
  it('derives parent | current | preview from note paths', async () => {
    await mountView();
    expect(names('cur')).toEqual(['alpha', 'beta', 'One', 'Two']);
    expect(col('parent')).toBeNull(); // at the book root
    expect(cursorName('cur')).toBe('alpha');
    expect(names('preview')).toEqual(['nested', 'Inner']); // folder preview
    expect(crumbs()).toEqual(['Vault']);
  });

  it('ARIA: the current column is a focusable listbox whose active descendant exists', async () => {
    await mountView();
    const lb = col('cur')!;
    expect(lb.getAttribute('role')).toBe('listbox');
    expect(lb.tabIndex).toBe(0);
    const id = lb.getAttribute('aria-activedescendant')!;
    const opt = document.getElementById(id)!;
    expect(opt.getAttribute('aria-selected')).toBe('true');
    expect(opt.getAttribute('aria-setsize')).toBe('4');
    expect(opt.getAttribute('aria-posinset')).toBe('1');
    expect(col('preview')!.tabIndex).toBe(-1);
    await press('j');
    expect(lb.getAttribute('aria-activedescendant')).toBe('cur-1');
    expect(target.querySelector('[data-testid="nav-live"]')!.textContent).toMatch(/Vault root, 4 items/);
  });
});

describe('miller browser — keyboard', () => {
  it('l/h walk columns, cursor lands on the folder we came from', async () => {
    await mountView();
    await press('l');
    expect(crumbs()).toEqual(['Vault', 'alpha']);
    expect(names('cur')).toEqual(['nested', 'Inner']);
    expect(names('parent')).toEqual(['alpha', 'beta', 'One', 'Two']);
    expect(cursorName('parent')).toBe('alpha');
    await press('l');
    expect(crumbs()).toEqual(['Vault', 'alpha', 'nested']);
    await press('h', 'h');
    expect(crumbs()).toEqual(['Vault']);
    expect(cursorName('cur')).toBe('alpha');
    await press('h'); // no-op at the root (does not leave the book)
    expect(books.pickerOpen ?? false).toBe(false);
    expect(names('cur')).toEqual(['alpha', 'beta', 'One', 'Two']);
  });

  it('H/L history, gh and zh go home, gg/G ends', async () => {
    await mountView();
    await press('l', 'l');
    await press('H');
    expect(crumbs()).toEqual(['Vault', 'alpha']);
    await press('L');
    expect(crumbs()).toEqual(['Vault', 'alpha', 'nested']);
    await press('g', 'h');
    expect(crumbs()).toEqual(['Vault']);
    await press('l', 'z', 'h');
    expect(crumbs()).toEqual(['Vault']);
    await press('G');
    expect(cursorName('cur')).toBe('Two');
    await press('g', 'g');
    expect(cursorName('cur')).toBe('alpha');
  });

  it('j onto a note previews it (debounced); Enter opens it; h/Esc returns', async () => {
    await mountView();
    await press('j', 'j'); // beta → One
    expect(cursorName('cur')).toBe('One');
    await waitFor(() => notes.selectedID === 'one', 'debounced preview');
    await waitFor(() => target.querySelector('.rendered'), 'rendered preview');
    expect(api.getNoteContent).toHaveBeenCalledWith('v1', 'one', expect.anything());
    // The intermediate folder row never fetched anything.
    expect(vi.mocked(api.getNoteContent).mock.calls.map((c) => c[1])).toEqual(['one']);

    await press('Enter');
    expect(target.querySelector('[data-testid="miller"]')!.classList.contains('note-mode')).toBe(true);
    expect(document.activeElement?.classList.contains('col-preview')).toBe(true);
    expect(target.querySelector('.crumb-note')?.textContent).toBe('One');

    await press('Escape');
    expect(target.querySelector('[data-testid="miller"]')!.classList.contains('note-mode')).toBe(false);
    expect(document.activeElement).toBe(col('cur'));
    expect(cursorName('cur')).toBe('One');
  });

  it('zp toggles the preview column', async () => {
    await mountView();
    const m = () => target.querySelector('[data-testid="miller"]')!;
    await press('z', 'p');
    expect(m().classList.contains('no-preview')).toBe(true);
    await press('z', 'p');
    expect(m().classList.contains('no-preview')).toBe(false);
  });

  it('/ filters the current column; Enter hands keys back; Esc clears', async () => {
    await mountView();
    await press('/');
    const input = await waitFor(() => target.querySelector<HTMLInputElement>('.filter-input'), 'filter input');
    expect(document.activeElement).toBe(input);
    input.value = 'o';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(names('cur')).toEqual(['One', 'Two']);
    // Typing "j" in the filter is text, not navigation.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(document.activeElement).toBe(col('cur'));
    await press('j');
    expect(cursorName('cur')).toBe('Two');
    await press('Escape');
    expect(names('cur')).toEqual(['alpha', 'beta', 'One', 'Two']);
    expect(target.querySelector('.filter-input')).toBeNull();
  });

  it('book chords are preserved: g1 opens a book, gb the picker', async () => {
    await mountView();
    const open = vi.spyOn(books, 'openShortcut');
    const picker = vi.spyOn(books, 'openPicker');
    await press('g', '1');
    expect(open).toHaveBeenCalledWith(1);
    await press('g', 'b');
    expect(picker).toHaveBeenCalled();
  });
});

describe('miller browser — mouse', () => {
  it('click a folder enters it; dblclick a note opens it; click parent/crumb navigates', async () => {
    await mountView();
    rows('cur')[0].click(); // alpha
    await settle();
    expect(crumbs()).toEqual(['Vault', 'alpha']);
    rows('cur')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); // Inner
    await settle();
    expect(notes.selectedID).toBe('inner');
    expect(target.querySelector('[data-testid="miller"]')!.classList.contains('note-mode')).toBe(true);
    // Breadcrumb root.
    (target.querySelector('[data-testid="breadcrumb"] .crumb:not(.back)') as HTMLElement).click();
    await settle();
    expect(crumbs()).toEqual(['Vault']);
    rows('cur')[1].click(); // beta
    await settle();
    rows('parent')[0].click(); // alpha in the parent column
    await settle();
    expect(crumbs()).toEqual(['Vault', 'alpha']);
  });
});

describe('miller browser — new note goes into the browsed folder', () => {
  it('creates at root then moves into the current folder', async () => {
    const created = note('fresh', 'fresh.md', 'Fresh');
    const served = [...VAULT];
    serve(served);
    vi.mocked(api.createNote).mockImplementation(async () => {
      served.unshift(created);
      return created;
    });
    vi.mocked(api.updateNote).mockImplementation(async (_v, _id, input) => {
      const moved = { ...created, path: input.path! };
      served[0] = moved;
      return moved;
    });
    await mountView();
    await press('l', 'n');
    const input = await waitFor(() => target.querySelector<HTMLInputElement>('.modal-panel input'), 'new-note input');
    input.value = 'Fresh';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    target.querySelector<HTMLFormElement>('.modal-form')!.requestSubmit();
    await waitFor(() => vi.mocked(api.updateNote).mock.calls.length > 0, 'move into folder');
    expect(api.updateNote).toHaveBeenCalledWith('v1', 'fresh', { path: 'alpha/fresh.md' });
    await waitFor(() => names('cur').includes('Fresh'), 'fresh note in alpha');
    expect(crumbs()).toEqual(['Vault', 'alpha']);
    expect(cursorName('cur')).toBe('Fresh');
  });
});

describe('miller browser — 10k notes performance smoke', () => {
  it('loads all pages, renders a bounded window, and jumps to the end quickly', async () => {
    const many: NoteSummary[] = [];
    for (let i = 0; i < 10_000; i++) {
      // 8000 in the root, the rest spread over 20 folders.
      many.push(i < 8000 ? note(`r${i}`, `r${i}.md`, `Root note ${i}`) : note(`f${i}`, `dir${i % 20}/f${i}.md`, `Note ${i}`));
    }
    serve(many);
    const t0 = performance.now();
    cmp = mount(VaultHomeView, { target });
    await waitFor(() => notes.list.length === 10_000 && !notes.loadingList, 'all pages');
    await waitFor(() => rows('cur').length > 0, 'rows');
    const mountMs = performance.now() - t0;

    // 20 folders + 8000 notes in the root column, but only a window in the DOM.
    expect(col('cur')!.querySelector('[role="option"]')!.getAttribute('aria-setsize')).toBe('8020');
    expect(rows('cur').length).toBeLessThan(100);

    const t1 = performance.now();
    await press('G');
    const jumpMs = performance.now() - t1;
    const lb = col('cur')!;
    expect(lb.getAttribute('aria-activedescendant')).toBe('cur-8019');
    expect(document.getElementById('cur-8019')).not.toBeNull();
    expect(rows('cur').length).toBeLessThan(100);

    for (let i = 0; i < 20; i++) await press('k');
    expect(lb.getAttribute('aria-activedescendant')).toBe('cur-7999');

    // Generous bounds: this is a smoke test against O(n²) regressions,
    // not a benchmark (CI machines vary).
    expect(mountMs).toBeLessThan(5000);
    expect(jumpMs).toBeLessThan(1000);
  });
});
