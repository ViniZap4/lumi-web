// @vitest-environment jsdom
//
// Floating explorer (SPEC-PARTE2 §2): starts at the current note's
// folder, the explorer keymap moves, Enter / Ctrl-v / Ctrl-s open in
// the current pane / a vertical / a horizontal split, Esc / q / click
// outside close, file operations go through the view's ops.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

vi.mock('../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../lib/api.ts')>()),
  getNoteContent: vi.fn(async (_v: string, id: string) =>
    id === 'map'
      ? { id, vault_id: 'v1', path: 'trip/map.canvas', kind: 'canvas', frontmatter: {}, body: '{"nodes":[{"id":"a","type":"text","text":"Hello **map**","x":0,"y":0,"width":200,"height":60},{"id":"f","type":"file","file":"trip/plan.md","x":300,"y":0,"width":200,"height":100}],"edges":[{"id":"e","fromNode":"a","toNode":"f"}]}' }
      : id === 'board'
        ? { id, vault_id: 'v1', path: 'trip/board.md', frontmatter: { 'kanban-plugin': 'board' }, body: '## Todo\n\n- [ ] pack\n- [ ] book\n\n## Done\n\n- [x] plan\n' }
        : { id, vault_id: 'v1', path: id + '.md', frontmatter: {}, body: `# ${id}\n\n<script>bad()</script>body of ${id}` }),
}));

import FloatingExplorer, { type FxOps } from './FloatingExplorer.svelte';
import { notes } from '../lib/notes.svelte.ts';
import type { NoteSummary } from '../lib/types.ts';

const note = (id: string, path: string, title = id): NoteSummary => ({ id, vault_id: 'v1', path, title, created_at: '', updated_at: '2026-01-01T00:00:00Z' });

let target: HTMLElement;
let cmp: Record<string, unknown> | null = null;
let onopen: ReturnType<typeof vi.fn<(id: string, where: string, from?: HTMLElement | null) => void>>;
let onclose: ReturnType<typeof vi.fn<() => void>>;
let ops: FxOps;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

async function key(k: string, o: Partial<KeyboardEventInit> = {}): Promise<void> {
  const el = (document.activeElement && document.activeElement !== document.body ? document.activeElement : target.querySelector('[data-testid="floating-explorer"]'))!;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  await settle();
}

/** The note preview is a lazy chunk: poll for it instead of a fixed sleep. */
async function waitForEl(sel: string, ms = 3000): Promise<Element | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const el = target.querySelector(sel);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 10));
    await settle();
  }
  return target.querySelector(sel);
}

const rows = () => Array.from(target.querySelectorAll('[data-testid="col-fx-cur"] [role="option"] .name')).map((e) => e.textContent);
const cursor = () => target.querySelector('[data-testid="col-fx-cur"] [aria-selected="true"] .name')?.textContent ?? null;

async function open(startNote: string | null, extra: Record<string, unknown> = {}): Promise<void> {
  cmp = mount(FloatingExplorer, { target, props: { vaultID: 'v1', bookName: 'Book', startNote, ops, onopen, onclose, ...extra } });
  await settle();
}

beforeEach(() => {
  notes.list = [note('plan', 'trip/plan.md', 'Plan'), note('sites', 'trip/sites.md', 'Sites'), note('w', 'welcome.md', 'Welcome'), note('g', 'ref/glossary.md', 'Glossary')];
  target = document.createElement('div');
  document.body.appendChild(target);
  onopen = vi.fn<(id: string, where: string, from?: HTMLElement | null) => void>();
  onclose = vi.fn<() => void>();
  ops = { offline: () => false, run: vi.fn(async () => {}), remove: vi.fn(async () => {}), paste: vi.fn(async () => {}), move: vi.fn(async () => 'moved') };
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  notes.list = [];
});

describe('floating explorer', () => {
  it('starts at the current note folder with the cursor on it, focused', async () => {
    await open('sites');
    expect(rows()).toEqual(['Plan', 'Sites']);
    expect(cursor()).toBe('Sites');
    expect(target.querySelector('[data-testid="col-fx-cur"]')!.contains(document.activeElement) || document.activeElement === target.querySelector('[data-testid="col-fx-cur"]')).toBe(true);
  });

  it('j/k move, h goes up landing on the folder, l enters it', async () => {
    await open('sites');
    await key('k');
    expect(cursor()).toBe('Plan');
    await key('h');
    expect(rows()).toEqual(['ref', 'trip', 'Welcome']);
    expect(cursor()).toBe('trip');
    await key('l');
    expect(rows()).toEqual(['Plan', 'Sites']);
  });

  it('Enter opens here, Ctrl-v in a vertical split, Ctrl-s in a horizontal split', async () => {
    await open('sites');
    await key('Enter');
    expect(onopen.mock.lastCall?.slice(0, 2)).toEqual(['sites', 'current']);
    // The row's name is handed over for the shared-element morph.
    expect((onopen.mock.lastCall?.[2] as HTMLElement | undefined)?.textContent).toBe('Sites');
    await key('k');
    await key('v', { ctrlKey: true });
    expect(onopen.mock.lastCall?.slice(0, 2)).toEqual(['plan', 'vsplit']);
    await key('s', { ctrlKey: true });
    expect(onopen.mock.lastCall?.slice(0, 2)).toEqual(['plan', 'hsplit']);
  });

  it('keys do not leak to the page', async () => {
    await open('sites');
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    await key('j');
    await key('x');
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('Esc and q close; / filters and Esc clears the filter first', async () => {
    await open('w');
    await key('/');
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Filter folder"]')!;
    expect(document.activeElement).toBe(input);
    input.value = 'tr';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(rows()).toEqual(['trip']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    await key('Escape');
    expect(onclose).not.toHaveBeenCalled();
    expect(rows()).toEqual(['ref', 'trip', 'Welcome']);
    await key('q');
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('mouse: click selects, double-click opens, click outside closes', async () => {
    await open('sites');
    const plan = Array.from(target.querySelectorAll<HTMLElement>('[data-testid="col-fx-cur"] [role="option"]')).find((r) => r.textContent?.includes('Plan'))!;
    plan.click();
    await settle();
    expect(cursor()).toBe('Plan');
    plan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(onopen.mock.lastCall?.slice(0, 2)).toEqual(['plan', 'current']);
    target.querySelector<HTMLElement>('[data-testid="floating-explorer"]')!.click();
    expect(onclose).not.toHaveBeenCalled();
    target.querySelector<HTMLElement>('[data-testid="floating-explorer-scrim"]')!.click();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('the note preview is rendered through the sanitizer', async () => {
    await open('sites');
    const md = await waitForEl('.fx-preview .md-body');
    expect(md?.textContent).toContain('body of sites');
    expect(md?.innerHTML).not.toContain('<script');
  });

  it('a canvas previews as a mini canvas (not raw JSON); kind icon + "· canvas" when titles collide', async () => {
    notes.list = [...notes.list, { ...note('map', 'trip/map.canvas', 'Plan'), kind: 'canvas' }];
    await open('map');
    const mini = await waitForEl('.fx-preview [data-testid="canvas-mini"]');
    expect(mini).not.toBeNull();
    expect(target.querySelector('.fx-preview')!.textContent).not.toContain('"nodes"');
    expect(mini!.querySelectorAll('.cm-card')).toHaveLength(2);
    expect(mini!.textContent).toContain('plan'); // file node: titled card
    (mini as HTMLElement).click();
    expect(onopen).toHaveBeenCalledWith('map', 'current', expect.anything());
    // Rows: the canvas and the note both titled "Plan" are told apart.
    expect(rows()).toEqual(expect.arrayContaining(['Plan · canvas', 'Plan · note']));
    const icon = (name: string) => Array.from(target.querySelectorAll('[data-testid="col-fx-cur"] [role="option"]')).find((r) => r.querySelector('.name')?.textContent === name)?.querySelector('svg')?.getAttribute('data-kind');
    expect(icon('Plan · canvas')).toBe('canvas');
    expect(icon('Plan · note')).toBe('markdown');
  });

  it('a kanban note previews as a mini board', async () => {
    notes.list = [...notes.list, note('board', 'trip/board.md', 'Board')];
    await open('board');
    const mini = await waitForEl('.fx-preview [data-testid="kanban-mini"]');
    expect(mini).not.toBeNull();
    expect(Array.from(mini!.querySelectorAll('.km-title')).map((e) => e.textContent)).toEqual(['Todo', 'Done']);
    expect(mini!.textContent).toContain('pack');
  });

  it('a / d run the file operations through the view', async () => {
    await open('sites');
    await key('d');
    expect(target.textContent).toContain('Delete');
    await key('y');
    expect(ops.remove).toHaveBeenCalledTimes(1);
    await key('a');
    const input = target.querySelector<HTMLInputElement>('.fx-input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'new note';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(ops.run).toHaveBeenCalledTimes(1);
    expect((ops.run as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ kind: 'note', title: 'new note', folder: 'trip' });
  });

  it('initial actions: the reader `r` opens the overlay with the rename prompt on the note', async () => {
    await open('sites', { initial: 'rename' });
    const input = target.querySelector<HTMLInputElement>('.fx-input')!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Sites');
  });

  it('context menu: ⇧F10 opens the row menu; its mnemonic runs the same action', async () => {
    await open('sites');
    await key('F10', { shiftKey: true });
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain('Rename / move');
    (document.activeElement ?? menu!).dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(target.querySelector<HTMLInputElement>('.fx-input')?.value).toBe('Sites');
  });

  it('f: hint mode labels the overlay rows', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10, toJSON() {} } as DOMRect);
    await open('sites');
    await key('f');
    rect.mockRestore();
    expect(document.querySelector('.hints')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('.hints')).toBeNull();
  });

  it('drag a note onto a folder: moves it through the view', async () => {
    await open('w');
    const row = (name: string) => Array.from(target.querySelectorAll<HTMLElement>('[data-testid="col-fx-cur"] [role="option"]')).find((r) => r.querySelector('.name')?.textContent === name)!;
    const data = new Map<string, string>();
    const dt = { types: [] as string[], setData: (k: string, v: string) => { data.set(k, v); dt.types.push(k); }, getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' };
    const ev = (type: string) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: dt });
    row('Welcome').dispatchEvent(ev('dragstart'));
    row('trip').dispatchEvent(ev('dragover'));
    row('trip').dispatchEvent(ev('drop'));
    await settle();
    expect(ops.move).toHaveBeenCalledWith('n:w', expect.objectContaining({ kind: 'folder', path: 'trip' }));
  });

  it('y yanks; a yank handed in by the view (an earlier opening) pastes with p', async () => {
    await open('sites');
    await key('y');
    expect(target.querySelector('.fx-status')?.textContent).toContain('yanked Sites');
    unmount(cmp!);
    const plan = { kind: 'note', key: 'n:plan', name: 'Plan', path: 'trip/plan.md', note: notes.list[0] };
    await open('w', { yanked: plan });
    await key('p');
    expect(ops.paste).toHaveBeenCalledWith(plan, expect.anything());
  });
});

describe('floating explorer — books level (switching books floats too)', () => {
  beforeEach(async () => {
    const { books } = await import('../lib/books.svelte.ts');
    const { accounts } = await import('../lib/accounts.svelte.ts');
    await accounts.add({ server_url: 'https://a.example', username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '', expires_at: null, remember: false }, 'tk');
    await accounts.add({ server_url: 'https://b.example', username: 'bo', user_id: 'u2', display_name: 'Bo', added_at: '', expires_at: null, remember: false }, 'tk2');
    books.addCreated({ id: 'v1', name: 'Work', slug: 'work', created_by: 'u1', created_at: '', owner_user_id: 'u1' }, 'https://a.example#ana');
    books.addCreated({ id: 'v2', name: 'Notes', slug: 'notes', created_by: 'u1', created_at: '', owner_user_id: 'u1' }, 'https://a.example#ana');
    books.addCreated({ id: 'v3', name: 'Home', slug: 'home', created_by: 'u2', created_at: '', owner_user_id: 'u2' }, 'https://b.example#bo');
    books.setActive('v1');
  });
  afterEach(async () => {
    const { books } = await import('../lib/books.svelte.ts');
    const { accounts } = await import('../lib/accounts.svelte.ts');
    books.clear();
    for (const a of [...accounts.list]) await accounts.forget(a.key);
  });

  const bookRows = () => Array.from(target.querySelectorAll('[data-testid="fx-books-list"] [role="option"] .fx-row-name')).map((e) => e.textContent);
  const bookCursor = () => target.querySelector('[data-testid="fx-books-list"] [aria-selected="true"] .fx-row-name')?.textContent ?? null;

  it('opens on the Livros shelf: one list grouped by account, cursor on the active book; Enter switches', async () => {
    const onbook = vi.fn();
    await open('sites', { level: 'books', onbook });
    expect(target.querySelector('[data-testid="floating-explorer"]')!.getAttribute('data-level')).toBe('books');
    // Two accounts: no accounts layer, every book in one list.
    expect(bookRows()).toEqual(['Work', 'Notes', 'Home']);
    // Account headers are section headers, not rows (not options, no chevron).
    const heads = Array.from(target.querySelectorAll('[data-testid="fx-books-list"] .fx-acct'));
    expect(heads.map((h) => h.querySelector('.fx-acct-name')?.textContent)).toEqual(['ana', 'bo']);
    expect(heads.every((h) => !h.closest('[role="option"]'))).toBe(true);
    expect(target.querySelector('[data-testid="fx-books-list"] .chev')).toBeNull();
    expect(bookCursor()).toBe('Work');
    await key('j');
    expect(bookCursor()).toBe('Notes');
    await key('j'); // crosses into bo's group
    expect(bookCursor()).toBe('Home');
    await key('Enter');
    expect(onbook).toHaveBeenCalledWith('v3');
  });

  it('breadcrumb names the scope with its own icon; pt-BR plurals in the footer', async () => {
    await open('sites', { level: 'books' });
    const crumbs = target.querySelector('[data-testid="fx-crumbs"]')!;
    expect(crumbs.textContent?.trim()).toBe('Livros');
    expect(crumbs.querySelector('[aria-current="location"] .lv-shelf')).not.toBeNull();
    expect(target.querySelector('[data-testid="fx-stat"]')!.textContent).toBe('3 livros · 2 contas');
    expect(target.querySelector('[data-testid="floating-explorer"]')!.getAttribute('aria-label')).toBe('Livros');
  });

  it('h climbs from the book root to Livros; with few accounts h stays there (no accounts layer)', async () => {
    const onlevel = vi.fn();
    await open('w', { onlevel });
    const files = target.querySelector('[data-testid="fx-crumbs"]')!;
    expect(files.querySelector('[data-level="shelf"]')?.textContent).toBe('Livros');
    expect(files.querySelector('[data-level="book"] .lv-book')).not.toBeNull();
    await key('h'); // book root → Livros
    expect(onlevel).toHaveBeenLastCalledWith('books');
    expect(bookRows()).toEqual(['Work', 'Notes', 'Home']);
    await key('h');
    expect(bookRows()).toEqual(['Work', 'Notes', 'Home']);
    expect(target.querySelector('[data-testid="fx-books"]')!.getAttribute('data-layer')).toBe('books');
    expect(target.querySelector('.fx-flash')?.textContent).toContain('Livros é o topo');
  });

  it('many accounts: h opens "Contas e servidores" (cards, no chevron); breadcrumb Contas › user@host › Livros', async () => {
    const { books } = await import('../lib/books.svelte.ts');
    const { accounts } = await import('../lib/accounts.svelte.ts');
    await accounts.add({ server_url: 'https://c.example', username: 'cy', user_id: 'u3', display_name: 'Cy', added_at: '', expires_at: null, remember: false }, 'tk3');
    books.addCreated({ id: 'v4', name: 'Lab', slug: 'lab', created_by: 'u3', created_at: '', owner_user_id: 'u3' }, 'https://c.example#cy');
    const onbook = vi.fn();
    await open('sites', { level: 'books', onbook });
    const crumbText = () => Array.from(target.querySelectorAll('[data-testid="fx-crumbs"] .fx-crumb')).map((c) => c.textContent?.trim());
    expect(crumbText()).toEqual(['Contas', 'ana@a.example', 'Livros']);
    await key('h');
    expect(target.querySelector('[data-testid="fx-books"]')!.getAttribute('data-layer')).toBe('accounts');
    expect(crumbText()).toEqual(['Contas e servidores']);
    expect(bookRows()).toEqual(['ana', 'bo', 'cy']);
    expect(target.querySelector('[data-testid="fx-books-list"] .chev')).toBeNull();
    expect(target.querySelectorAll('[data-testid="fx-books-list"] .fx-acct-row').length).toBe(3);
    await key('j');
    await key('l'); // bo → Livros, cursor on bo's first book
    expect(target.querySelector('[data-testid="fx-books"]')!.getAttribute('data-layer')).toBe('books');
    expect(bookCursor()).toBe('Home');
    expect(crumbText()).toEqual(['Contas', 'bo@b.example', 'Livros']);
  });

  it('Enter on the open book goes back to its files; g2 opens book 2', async () => {
    const onbook = vi.fn();
    await open('sites', { level: 'books', onbook });
    await key('Enter');
    expect(target.querySelector('[data-testid="floating-explorer"]')!.getAttribute('data-level')).toBe('files');
    expect(rows()).toEqual(['Plan', 'Sites']);
    await key('g');
    await key('b');
    expect(target.querySelector('[data-testid="floating-explorer"]')!.getAttribute('data-level')).toBe('books');
    await key('g');
    await key('2');
    expect(onbook).toHaveBeenCalledWith('v2');
  });
});

describe('floating explorer — narrow screens', () => {
  it('becomes a full-height sheet with touch-sized rows; a tap opens a note', async () => {
    await open('sites', { narrow: true });
    const fx = target.querySelector<HTMLElement>('[data-testid="floating-explorer"]')!;
    expect(fx.classList.contains('sheet')).toBe(true);
    const row = target.querySelector<HTMLElement>('[data-testid="col-fx-cur"] [role="option"]')!;
    expect(row.style.height).toBe('44px');
    expect(target.querySelector('.fx-up')).not.toBeNull();
    row.click(); // Plan
    await settle();
    expect(onopen.mock.lastCall?.slice(0, 2)).toEqual(['plan', 'current']);
  });

  it('the back button climbs folders like h', async () => {
    await open('sites', { narrow: true });
    target.querySelector<HTMLElement>('.fx-up')!.click();
    await settle();
    expect(rows()).toEqual(['ref', 'trip', 'Welcome']);
  });
});
