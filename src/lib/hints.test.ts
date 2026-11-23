// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { hintLabels, filterHints, collectHintTargets } from './hints.ts';

describe('hint labels', () => {
  it('single letters while they suffice', () => {
    expect(hintLabels(3)).toEqual(['a', 's', 'd']);
    expect(hintLabels(0)).toEqual([]);
  });
  it('fixed-length, prefix-free, unique labels beyond the alphabet', () => {
    const l = hintLabels(60);
    expect(new Set(l).size).toBe(60);
    expect(l.every((x) => x.length === 2)).toBe(true);
    for (const a of l) for (const b of l) if (a !== b) expect(b.startsWith(a)).toBe(false);
  });
  it('filters by typed prefix and reports a full hit', () => {
    const l = hintLabels(40);
    const f = filterHints(l, l[30].slice(0, 1));
    expect(f.live).toContain(30);
    expect(f.hit).toBeNull();
    expect(filterHints(l, l[30]).hit).toBe(30);
    expect(filterHints(l, 'zz').live).toEqual([]);
  });
  it('collects visible targets, outermost first', () => {
    document.body.innerHTML = '<div id="r"><div data-hint-target role="option"><button>inner</button></div><button>b</button><button disabled>x</button><a href="#a">a</a></div>';
    for (const el of document.querySelectorAll<HTMLElement>('#r *')) el.getBoundingClientRect = () => ({ width: 20, height: 20, top: 10, left: 10, bottom: 30, right: 30 } as DOMRect);
    const t = collectHintTargets(document.getElementById('r')!, { w: 800, h: 600 });
    expect(t.map((e) => e.textContent)).toEqual(['inner', 'b', 'a']);
  });
});

describe('hint target pruning', () => {
  it('skips target containers and opted-out chrome', () => {
    document.body.innerHTML = '<div id="r"><div role="listbox" tabindex="0"><div data-hint-target role="option">row</div></div><div data-hint-skip><button>legend</button></div><button>ok</button></div>';
    for (const el of document.querySelectorAll<HTMLElement>('#r *')) el.getBoundingClientRect = () => ({ width: 20, height: 20, top: 10, left: 10, bottom: 30, right: 30 } as DOMRect);
    expect(collectHintTargets(document.getElementById('r')!, { w: 800, h: 600 }).map((e) => e.textContent)).toEqual(['row', 'ok']);
  });
});
