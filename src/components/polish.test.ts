// @vitest-environment jsdom
//
// Rendered markdown interactions, the split preview and the legend.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick, createRawSnippet } from 'svelte';
import * as Y from 'yjs';
import MarkdownView from './MarkdownView.svelte';
import SourceSplit from './SourceSplit.svelte';
import CommandLegend from './CommandLegend.svelte';
import ContextMenu from './ContextMenu.svelte';
import { renderBlocks, taskToggle } from '../lib/markdown.ts';
import { PREVIEW_DEBOUNCE_MS } from '../lib/scroll-sync.ts';
import { menuFor } from '../lib/context-actions.ts';
import type { Entry } from '../lib/notetree.ts';

let cmp: Record<string, unknown> | null = null;
let target: HTMLElement;

function setup(): HTMLElement {
  target = document.createElement('div');
  document.body.replaceChildren(target);
  return target;
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  vi.useRealTimers();
});

const editorSnippet = createRawSnippet(() => ({ render: () => '<div class="fake-editor">editor</div>' }));

describe('MarkdownView', () => {
  const src = '# T\n\n- [ ] one\n- [x] two\n\n```js\nlet a = 1\n```';

  it('task checkboxes toggle through the callback (document order index)', async () => {
    const onT = vi.fn();
    cmp = mount(MarkdownView, { target: setup(), props: { blocks: renderBlocks(src), ontoggletask: onT } });
    await settle();
    const boxes = target.querySelectorAll<HTMLInputElement>('input[data-task]');
    expect(boxes.length).toBe(2);
    expect(boxes[1].disabled).toBe(false);
    boxes[1].click();
    expect(onT).toHaveBeenCalledWith(1);
    // The index maps to a single-character change in the source.
    const ch = taskToggle(src, 1)!;
    expect(ch.to - ch.from).toBe(1);
    expect(ch.insert).toBe(' ');
  });

  it('is read-only without a toggle callback', async () => {
    cmp = mount(MarkdownView, { target: setup(), props: { blocks: renderBlocks(src) } });
    await settle();
    for (const b of target.querySelectorAll<HTMLInputElement>('input[data-task]')) {
      expect(b.disabled).toBe(true);
      expect(b.tabIndex).toBe(-1);
    }
  });

  it('code blocks get a language label and a copy button', async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    cmp = mount(MarkdownView, { target: setup(), props: { blocks: renderBlocks(src) } });
    await settle();
    expect(target.querySelector('.md-code-lang')?.textContent).toBe('js');
    (target.querySelector('button.md-copy') as HTMLButtonElement).click();
    expect(write).toHaveBeenCalledWith('let a = 1');
  });

  it('each block carries its source line', async () => {
    cmp = mount(MarkdownView, { target: setup(), props: { blocks: renderBlocks(src) } });
    await settle();
    expect([...target.querySelectorAll<HTMLElement>('.md-b')].map((b) => b.dataset.line)).toEqual(['0', '2', '5']);
  });
});

describe('SourceSplit', () => {
  function make(enabled: boolean, extra: Record<string, unknown> = {}) {
    const doc = new Y.Doc();
    const ytext = doc.getText('content');
    ytext.insert(0, '# Hello\n\nworld');
    const onratio = vi.fn();
    cmp = mount(SourceSplit, {
      target: setup(),
      props: { enabled, ytext, editorView: () => null, ratio: 0.5, onratio, children: editorSnippet, ...extra },
    });
    return { ytext, onratio };
  }

  it('is off by default: the editor alone, no preview pane', async () => {
    const { editorSettings } = await import('../lib/editor-settings.svelte.ts');
    const { defaultSettings } = await import('../lib/editor-settings.ts');
    expect(defaultSettings().previewSplit).toBe(false);
    void editorSettings;
    make(false);
    await settle();
    expect(target.querySelector('.fake-editor')).not.toBeNull();
    expect(target.querySelector('[data-testid="split-preview"]')).toBeNull();
    expect(target.querySelector('[role="separator"]')).toBeNull();
  });

  it('renders the preview and re-renders after the debounce', async () => {
    const { ytext } = make(true);
    await settle();
    const pane = () => target.querySelector('[data-testid="split-preview"]')!;
    expect(pane().querySelector('h1')?.textContent).toContain('Hello');
    vi.useFakeTimers();
    ytext.insert(ytext.length, '\n\n## Second');
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 20);
    flushSync();
    expect(pane().querySelector('h2')).toBeNull();
    vi.advanceTimersByTime(40);
    flushSync();
    expect(pane().querySelector('h2')?.textContent).toContain('Second');
  });

  it('the divider resizes from the keyboard', async () => {
    const { onratio } = make(true);
    await settle();
    const sep = target.querySelector<HTMLElement>('[role="separator"]')!;
    expect(sep.getAttribute('aria-valuenow')).toBe('50');
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    flushSync();
    expect(onratio).toHaveBeenLastCalledWith(0.52);
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onratio).toHaveBeenLastCalledWith(0.75);
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onratio).toHaveBeenLastCalledWith(0.5);
  });
});

describe('SourceSplit — keyboard reader', () => {
  // jsdom has no layout for ranges.
  const R = Range.prototype as unknown as Record<string, unknown>;
  R.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  type SplitApi = { focusPreview(): Promise<boolean>; run(a: unknown): boolean; clearFind(): boolean; topLine(): number | null; previewElement(): HTMLElement | null };
  function make(props: Record<string, unknown> = {}) {
    const doc = new Y.Doc();
    const ytext = doc.getText('content');
    ytext.insert(0, '# Hello\n\nworld and World\n\n## Two\n\nmore world');
    cmp = mount(SourceSplit, {
      target: setup(),
      props: { enabled: true, ytext, editorView: () => null, ratio: 0.5, onratio: () => {}, children: editorSnippet, ...props },
    });
    return cmp as unknown as SplitApi;
  }

  it('focusPreview focuses the preview pane; the focused side is marked', async () => {
    const api = make({ focused: 'split' });
    await settle();
    expect(await api.focusPreview()).toBe(true);
    const pane = target.querySelector<HTMLElement>('[data-testid="split-preview"]')!;
    expect(document.activeElement).toBe(pane);
    expect(pane.dataset.pane).toBe('split');
    expect(pane.classList.contains('pane-focus')).toBe(true);
    expect(target.querySelector('[data-pane="editor"]')!.classList.contains('pane-focus')).toBe(false);
    expect(api.previewElement()).toBe(pane);
    expect(api.topLine()).toBeGreaterThanOrEqual(1); // jsdom: no layout
  });

  it('scroll / heading / top actions run; unknown ones report false', async () => {
    const api = make();
    await settle();
    expect(api.run({ kind: 'scroll', unit: 'line', n: 3 })).toBe(true);
    expect(api.run({ kind: 'heading', dir: 1, n: 1 })).toBe(true);
    expect(api.run({ kind: 'top' })).toBe(true);
    expect(api.run({ kind: 'open' })).toBe(false); // nothing focused
    expect(api.run({ kind: 'yank' })).toBe(false); // the view copies
  });

  it('/ opens a find bar: smartcase matches, n steps, Esc in the reader clears', async () => {
    const api = make();
    await settle();
    api.run({ kind: 'find' });
    await settle();
    const input = target.querySelector<HTMLInputElement>('[data-testid="preview-find"] input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'world';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(target.querySelector('.find-info')?.textContent).toBe('1/3');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('[data-testid="preview-find"]')).toBeNull();
    api.run({ kind: 'findNext', dir: 1 });
    await settle();
    expect(target.querySelector('.find-info')?.textContent).toContain('2/3');
    expect(api.clearFind()).toBe(true);
    await settle();
    expect(target.querySelector('.find-info')).toBeNull();
    expect(api.clearFind()).toBe(false);
  });
});

describe('CommandLegend', () => {
  it('items with actions are buttons that run them; the rest are labels', async () => {
    const onaction = vi.fn();
    cmp = mount(CommandLegend, {
      target: setup(),
      props: { items: [{ keys: 'a', label: 'new', do: 'shell:create' }, { keys: '⌘V', label: 'paste url' }], mode: 'files', onaction },
    });
    await settle();
    const btn = target.querySelector<HTMLButtonElement>('.items button.item')!;
    expect(btn.title).toBe('new (a)');
    btn.click();
    expect(onaction).toHaveBeenCalledWith(expect.objectContaining({ do: 'shell:create' }));
    expect(target.querySelectorAll('.items button.item').length).toBe(1);
    expect(target.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Command legend');
  });
});

describe('ContextMenu', () => {
  const note = { kind: 'note', key: 'n:a', name: 'a.md', path: 'a.md', note: { id: 'a', title: 'A', path: 'a.md' } } as unknown as Entry;

  it('j/k move, Enter runs, mnemonic keys run directly, Esc closes', async () => {
    const opener = document.createElement('button');
    setup();
    document.body.append(opener);
    opener.focus();
    const onrun = vi.fn();
    const onclose = vi.fn();
    cmp = mount(ContextMenu, { target, props: { x: 10, y: 10, items: menuFor(note, { canPaste: true }), onrun, onclose } });
    await settle();
    const k = (key: string) => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      flushSync();
    };
    expect((document.activeElement as HTMLElement).textContent).toContain('Open');
    k('j');
    expect((document.activeElement as HTMLElement).textContent).toContain('Edit');
    k('Enter');
    expect(onrun).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'edit' }));
    expect(document.activeElement).toBe(opener);
  });

  it('a mnemonic runs its item; Esc closes and restores focus', async () => {
    const opener = document.createElement('button');
    setup();
    document.body.append(opener);
    opener.focus();
    const onrun = vi.fn();
    const onclose = vi.fn();
    cmp = mount(ContextMenu, { target, props: { x: 10, y: 10, items: menuFor(note, {}), onrun, onclose } });
    await settle();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    expect(onrun).toHaveBeenCalledWith(expect.objectContaining({ action: 'rename' }));
    unmount(cmp);
    cmp = mount(ContextMenu, { target, props: { x: 10, y: 10, items: menuFor(note, {}), onrun, onclose } });
    await settle();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onclose).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });
});
