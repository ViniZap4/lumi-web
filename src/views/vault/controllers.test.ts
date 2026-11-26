// @vitest-environment jsdom
//
// Unit tests for the book shell's controllers (views/vault/*.svelte.ts)
// and their pure helpers. The DOM-level behaviour is covered by the
// VaultHomeView suites; these pin the pieces that moved out of it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { single, splitPane } from '../../lib/pane-tree.ts';
import { readSavedLayout } from './panes.svelte.ts';
import { hoverLinkEl, hoverTargetFor } from './hover.svelte.ts';
import { noteEntryFor } from './commands.svelte.ts';
import { vimModeLabel } from './edit.svelte.ts';
import { errText } from './explorer.svelte.ts';
import { lazyComponent, whenIdle } from './lazy.svelte.ts';
import { Workspace } from './workspace.svelte.ts';
import { paletteCommands } from './palette-commands.ts';
import { ApiError, type NoteSummary } from '../../lib/types.ts';

const note = (id: string, path: string, title = id): NoteSummary => ({
  id, vault_id: 'v1', path, title, created_at: '', updated_at: '2026-01-01T00:00:00Z',
});

describe('readSavedLayout', () => {
  const two = () => {
    const base = single('a', 'L1');
    return splitPane(base, 'L1', 'row', 'b')!;
  };

  it('restores a multi-pane layout and its primary leaf', () => {
    const state = two();
    const raw = JSON.stringify({ v: 1, state, primary: 'L1' });
    const got = readSavedLayout(raw, new Set(['a', 'b']));
    expect(got?.primary).toBe('L1');
    expect(got?.state).toEqual(state);
  });

  it('drops panes whose notes are gone; one pane left is no layout', () => {
    const raw = JSON.stringify({ v: 1, state: two(), primary: 'L1' });
    expect(readSavedLayout(raw, new Set(['a']))).toBeNull();
  });

  it('an unknown primary falls back to the active leaf', () => {
    const state = two();
    const got = readSavedLayout(JSON.stringify({ v: 1, state, primary: 'nope' }), new Set(['a', 'b']));
    expect(got?.primary).toBe(state.active);
  });

  it('garbage and absence are null', () => {
    expect(readSavedLayout(null, new Set())).toBeNull();
    expect(readSavedLayout('{not json', new Set(['a']))).toBeNull();
    expect(readSavedLayout('{"state":42}', new Set(['a']))).toBeNull();
  });
});

describe('hover helpers', () => {
  const list = [note('one', 'one.md', 'One'), note('two', 'dir/two.md', 'Two')];

  it('classifies a link for the card: note, external, missing; anchors none', () => {
    expect(hoverTargetFor(list, '../one.md', 'dir/two.md', false)).toMatchObject({ kind: 'note', note: { id: 'one' } });
    expect(hoverTargetFor(list, 'https://example.com', 'one.md', false)).toEqual({ kind: 'external', url: 'https://example.com' });
    expect(hoverTargetFor(list, 'nope.md', 'one.md', false)).toMatchObject({ kind: 'missing' });
    expect(hoverTargetFor(list, '#top', 'one.md', false)).toBeNull();
  });

  it('only rendered note links preview (never inside the card or the explorer)', () => {
    document.body.innerHTML = `
      <div class="md-body"><a id="in" href="one.md"><span id="deep">x</span></a></div>
      <a id="out" href="one.md">y</a>
      <div class="hover-card"><div class="md-body"><a id="card" href="one.md">z</a></div></div>`;
    expect(hoverLinkEl(document.getElementById('deep'))?.id).toBe('in');
    expect(hoverLinkEl(document.getElementById('out'))).toBeNull();
    expect(hoverLinkEl(document.getElementById('card'))).toBeNull();
    expect(hoverLinkEl(null)).toBeNull();
    document.body.innerHTML = '';
  });
});

describe('small helpers', () => {
  it('noteEntryFor builds the explorer entry of a note', () => {
    expect(noteEntryFor(note('n', 'a/b.md', 'B'))).toEqual({ kind: 'note', key: 'n:n', name: 'B', path: 'a/b.md', note: note('n', 'a/b.md', 'B') });
    expect(noteEntryFor(null)).toBeNull();
  });

  it('vimModeLabel names the status-line pill', () => {
    expect(vimModeLabel('normal')).toBe('Normal');
    expect(vimModeLabel('insert')).toBe('Insert');
    expect(vimModeLabel('replace')).toBe('Replace');
    expect(vimModeLabel('visual')).toBe('Visual');
    expect(vimModeLabel('visual', 'linewise')).toBe('V-Line');
    expect(vimModeLabel('visual', 'blockwise')).toBe('V-Block');
  });

  it('errText prefers the API detail, then the code', () => {
    expect(errText(new ApiError(409, { error: 'conflict', detail: 'taken' }))).toBe('taken');
    expect(errText(new ApiError(404, { error: 'not_found' }))).toBe('not_found');
    expect(errText(new Error('boom'))).toBe('boom');
  });
});

describe('lazyComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('loads once on first read, then is the component', async () => {
    const Comp = { name: 'C' };
    const load = vi.fn(async () => ({ default: Comp }));
    const lazy = lazyComponent(load);
    expect(load).not.toHaveBeenCalled();
    expect(lazy.current).toBeNull();
    expect(lazy.current).toBeNull();
    await lazy.preload();
    flushSync();
    expect(lazy.current).toBe(Comp);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed load can be retried', async () => {
    const Comp = { name: 'C' };
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: Comp });
    const lazy = lazyComponent(load);
    await expect(lazy.preload()).rejects.toThrow('offline');
    await expect(lazy.preload()).resolves.toBe(Comp);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('whenIdle runs later and can be cancelled', () => {
    vi.useFakeTimers();
    const a = vi.fn();
    const b = vi.fn();
    whenIdle(a);
    const cancel = whenIdle(b);
    cancel();
    vi.advanceTimersByTime(3000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});

describe('workspace commands', () => {
  it('palette commands have unique ids; note and pane commands follow the state', () => {
    const ws = new Workspace();
    const ids = (cmds: { id: string }[]) => cmds.map((c) => c.id);
    const home = paletteCommands(ws);
    expect(new Set(ids(home)).size).toBe(home.length);
    expect(ids(home)).toEqual(expect.arrayContaining(['explorer', 'books', 'new', 'vsplit', 'book-settings', 'keys']));
    expect(ids(home)).not.toContain('close-note');
    expect(ids(home)).not.toContain('close-pane');

    ws.pane = 'note';
    expect(ids(paletteCommands(ws))).toEqual(expect.arrayContaining(['rename', 'delete', 'close-note']));

    paletteCommands(ws).find((c) => c.id === 'book-settings')!.run();
    expect(ws.showSettings).toBe(true);
  });

  it(':-lines route to the pane window commands and the explorer', () => {
    const ws = new Workspace();
    const runWin = vi.spyOn(ws.panes, 'runWin').mockImplementation(() => {});
    const open = vi.spyOn(ws.explorer, 'open').mockImplementation(() => {});
    const openBooks = vi.spyOn(ws.explorer, 'openBooks').mockImplementation(() => {});
    expect(ws.cmd.runExLine('vsplit two')).toBe(true);
    expect(runWin).toHaveBeenLastCalledWith('vsplit', { arg: 'two' });
    ws.cmd.runExLine('sp');
    expect(runWin).toHaveBeenLastCalledWith('split', { arg: '' });
    ws.cmd.runExLine('only');
    expect(runWin).toHaveBeenLastCalledWith('only');
    ws.cmd.runExLine('q');
    expect(runWin).toHaveBeenLastCalledWith('close');
    ws.cmd.runExLine('books');
    expect(openBooks).toHaveBeenCalled();
    ws.cmd.runExLine('Ex');
    expect(open).toHaveBeenCalled();
    expect(ws.cmd.runExLine('set nu')).toBe(false);
  });

  it('the overlay check covers every layer the shell opens', () => {
    const ws = new Workspace();
    expect(ws.cmd.overlayOpen()).toBe(false);
    ws.cmd.paletteMode = 'all';
    expect(ws.cmd.overlayOpen()).toBe(true);
    ws.cmd.paletteMode = null;
    ws.showSettings = true;
    expect(ws.cmd.overlayOpen()).toBe(true);
    ws.showSettings = false;
    ws.explorer.fx = { startNote: null, startDir: '', level: 'files', initial: null, key: 1 };
    expect(ws.cmd.overlayOpen()).toBe(true);
  });
});
