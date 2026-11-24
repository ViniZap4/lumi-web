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
  getNoteContent: vi.fn(async (_v: string, id: string) => ({ id, vault_id: 'v1', path: id + '.md', frontmatter: {}, body: `# ${id}\n\n<script>bad()</script>body of ${id}` })),
}));

import FloatingExplorer, { type FxOps } from './FloatingExplorer.svelte';
import { notes } from '../lib/notes.svelte.ts';
import type { NoteSummary } from '../lib/types.ts';

const note = (id: string, path: string, title = id): NoteSummary => ({ id, vault_id: 'v1', path, title, created_at: '', updated_at: '2026-01-01T00:00:00Z' });

let target: HTMLElement;
let cmp: Record<string, unknown> | null = null;
let onopen: ReturnType<typeof vi.fn<(id: string, where: string) => void>>;
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

const rows = () => Array.from(target.querySelectorAll('[data-testid="col-fx-cur"] [role="option"] .name')).map((e) => e.textContent);
const cursor = () => target.querySelector('[data-testid="col-fx-cur"] [aria-selected="true"] .name')?.textContent ?? null;

async function open(startNote: string | null): Promise<void> {
  cmp = mount(FloatingExplorer, { target, props: { vaultID: 'v1', bookName: 'Book', startNote, ops, onopen, onclose } });
  await settle();
}

beforeEach(() => {
  notes.list = [note('plan', 'trip/plan.md', 'Plan'), note('sites', 'trip/sites.md', 'Sites'), note('w', 'welcome.md', 'Welcome'), note('g', 'ref/glossary.md', 'Glossary')];
  target = document.createElement('div');
  document.body.appendChild(target);
  onopen = vi.fn<(id: string, where: string) => void>();
  onclose = vi.fn<() => void>();
  ops = { offline: () => false, run: vi.fn(async () => {}), remove: vi.fn(async () => {}), paste: vi.fn(async () => {}) };
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
    expect(onopen).toHaveBeenLastCalledWith('sites', 'current');
    await key('k');
    await key('v', { ctrlKey: true });
    expect(onopen).toHaveBeenLastCalledWith('plan', 'vsplit');
    await key('s', { ctrlKey: true });
    expect(onopen).toHaveBeenLastCalledWith('plan', 'hsplit');
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
    expect(onopen).toHaveBeenLastCalledWith('plan', 'current');
    target.querySelector<HTMLElement>('[data-testid="floating-explorer"]')!.click();
    expect(onclose).not.toHaveBeenCalled();
    target.querySelector<HTMLElement>('[data-testid="floating-explorer-scrim"]')!.click();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('the note preview is rendered through the sanitizer', async () => {
    await open('sites');
    await new Promise((r) => setTimeout(r, 150));
    await settle();
    const md = target.querySelector('.fx-preview .md-body');
    expect(md?.textContent).toContain('body of sites');
    expect(md?.innerHTML).not.toContain('<script');
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
});
