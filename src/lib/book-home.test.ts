import { describe, it, expect, beforeEach } from 'vitest';
import { rememberLastNote, lastNote, planBookOpen, recentNotes, NoteHistory, LAST_NOTE_KEY } from './book-home.ts';

beforeEach(() => localStorage.clear());

describe('last opened note (per book, per device)', () => {
  it('is stored per book and cleared with null', () => {
    rememberLastNote('v1', 'a');
    rememberLastNote('v2', 'b');
    expect(lastNote('v1')).toBe('a');
    expect(lastNote('v2')).toBe('b');
    expect(localStorage.getItem(LAST_NOTE_KEY + 'v1')).toBe('a');
    rememberLastNote('v1', null);
    expect(lastNote('v1')).toBeNull();
    expect(lastNote('v2')).toBe('b');
  });
  it('survives a broken storage (opens on the home instead)', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() {} } as unknown as Storage;
    expect(() => rememberLastNote('v1', 'a', broken)).not.toThrow();
    expect(lastNote('v1', broken)).toBeNull();
    expect(lastNote('v1', null)).toBeNull();
  });
});

describe('planBookOpen', () => {
  const notes = [{ id: 'a' }, { id: 'b' }];
  it('the last note when it still exists', () => {
    expect(planBookOpen({ notes, last: 'b' })).toEqual({ kind: 'note', note: 'b', source: 'last' });
  });
  it('a saved split layout wins over the last note', () => {
    expect(planBookOpen({ notes, last: 'b', layoutNote: 'a' })).toEqual({ kind: 'note', note: 'a', source: 'layout' });
  });
  it('no last note, or a deleted one: the empty home with the explorer open', () => {
    expect(planBookOpen({ notes })).toEqual({ kind: 'home', explore: true });
    expect(planBookOpen({ notes, last: 'gone', layoutNote: 'gone-too' })).toEqual({ kind: 'home', explore: true });
    expect(planBookOpen({ notes: [], last: 'a' })).toEqual({ kind: 'home', explore: true });
  });
});

describe('recentNotes', () => {
  const n = (id: string, updated_at: string) => ({ id, updated_at });
  it('most recently updated first, capped', () => {
    const list = [n('a', '2026-01-01'), n('b', '2026-03-01'), n('c', '2026-02-01'), n('d', '2026-04-01')];
    expect(recentNotes(list, 3).map((x) => x.id)).toEqual(['d', 'b', 'c']);
    expect(recentNotes(list, 10).map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(recentNotes(list, 0)).toEqual([]);
  });
  it('stays linear-ish on a 10k-note book', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => n('x' + i, new Date(Date.UTC(2026, 0, 1) + ((i * 7919) % 10_000) * 60_000).toISOString()));
    const t = performance.now();
    const r = recentNotes(big, 8);
    expect(performance.now() - t).toBeLessThan(50);
    expect(r).toHaveLength(8);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].updated_at >= r[i].updated_at).toBe(true);
  });
});

describe('NoteHistory (H / L)', () => {
  it('back and forward, a new visit drops the forward stack', () => {
    const h = new NoteHistory();
    h.visit('a');
    h.visit('b');
    h.visit('c');
    expect(h.goBack()).toBe('b');
    expect(h.goBack()).toBe('a');
    expect(h.goBack()).toBeNull();
    expect(h.goForward()).toBe('b');
    h.visit('d');
    expect(h.canForward).toBe(false);
    expect(h.goBack()).toBe('b');
  });
  it('ignores revisiting the current note and prunes deleted ones', () => {
    const h = new NoteHistory();
    h.visit('a');
    h.visit('a');
    h.visit('b');
    h.visit('c');
    h.prune((id) => id !== 'b');
    expect(h.goBack()).toBe('a');
    h.reset();
    expect(h.canBack).toBe(false);
    expect(h.current).toBeNull();
  });
  it('is capped', () => {
    const h = new NoteHistory(3);
    for (const id of ['a', 'b', 'c', 'd', 'e']) h.visit(id);
    expect([h.goBack(), h.goBack(), h.goBack(), h.goBack()]).toEqual(['d', 'c', 'b', null]);
  });
});
