import { describe, it, expect } from 'vitest';
import { parseDeepLink, formatDeepLink, resolveBook } from './deeplink.ts';

const V = '7c2a6a52-3b1f-4f1e-9a43-1d5e8f0b6a11';

describe('deep links', () => {
  it('parses book, note id and note path forms', () => {
    expect(parseDeepLink(`#/b/${V}`)).toEqual({ vault: V });
    expect(parseDeepLink(`#/b/${V}/`)).toEqual({ vault: V });
    expect(parseDeepLink(`#/b/${V}/n/plan-2026`)).toEqual({ vault: V, note: 'plan-2026' });
    expect(parseDeepLink(`#/b/${V}/p/projects/trip/plan.md`)).toEqual({ vault: V, path: 'projects/trip/plan.md' });
    expect(parseDeepLink(`#/b/${V}/p/dir/My%20Note.md`)).toEqual({ vault: V, path: 'dir/My Note.md' });
  });

  it('round-trips with formatDeepLink', () => {
    for (const l of [{ vault: V }, { vault: V, note: 'a b' }, { vault: V, path: 'x y/z.md' }]) {
      expect(parseDeepLink(formatDeepLink(l))).toEqual(l);
    }
  });

  it('rejects non-links, traversal, control characters and bad encodings', () => {
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('#/settings')).toBeNull();
    expect(parseDeepLink('#/b/')).toBeNull();
    expect(parseDeepLink(`#/b/${V}/p/../secret.md`)).toBeNull();
    expect(parseDeepLink(`#/b/${V}/p/a/%2E%2E/b.md`)).toBeNull();
    expect(parseDeepLink(`#/b/${V}/n/a%00b`)).toBeNull();
    expect(parseDeepLink(`#/b/${V}/n/a%2Fb`)).toBeNull(); // an id never has a slash
    expect(parseDeepLink(`#/b/${V}/n/%E0%A4%A`)).toBeNull();
    expect(parseDeepLink(`#/b/${V}/x/y`)).toBeNull();
    expect(parseDeepLink(`#/b/${V}/n/a/b`)).toBeNull();
  });

  it('resolves only books on this device: vault id, book id, then slug', () => {
    const books = [{ id: 'b1', vault_id: 'v1' }, { id: 'b2', vault_id: V }];
    expect(resolveBook({ vault: V }, books)?.id).toBe('b2');
    expect(resolveBook({ vault: 'b1' }, books)?.id).toBe('b1');
    expect(resolveBook({ vault: 'field-notes' }, books, (b) => (b.id === 'b2' ? 'field-notes' : null))?.id).toBe('b2');
    expect(resolveBook({ vault: 'unknown' }, books)).toBeNull();
  });
});
