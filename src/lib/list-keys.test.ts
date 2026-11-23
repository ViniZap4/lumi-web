// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { listKey, newChord, CHORD_MS, isTextTarget, captureFocus, trapTab, rovingKey, focusables } from './list-keys.ts';

const k = (key: string, mods: Partial<KeyboardEventInit> = {}) => ({ key, ...mods });

describe('listKey', () => {
  it('j/k and arrows move, clamped at the ends', () => {
    expect(listKey(k('j'), 0, 3)).toEqual({ index: 1, action: null });
    expect(listKey(k('ArrowDown'), 2, 3)).toEqual({ index: 2, action: null });
    expect(listKey(k('k'), 0, 3)).toEqual({ index: 0, action: null });
    expect(listKey(k('ArrowUp'), 2, 3)).toEqual({ index: 1, action: null });
  });

  it('wraps when asked', () => {
    expect(listKey(k('j'), 2, 3, { wrap: true })!.index).toBe(0);
    expect(listKey(k('k'), 0, 3, { wrap: true })!.index).toBe(2);
  });

  it('G/End go to the end, Home to the top', () => {
    expect(listKey(k('G'), 0, 5)!.index).toBe(4);
    expect(listKey(k('End'), 0, 5)!.index).toBe(4);
    expect(listKey(k('Home'), 3, 5)!.index).toBe(0);
  });

  it('gg needs two g within the chord window', () => {
    const chord = newChord();
    expect(listKey(k('g'), 3, 5, { chord, now: 1000 })).toEqual({ index: 3, action: null });
    expect(listKey(k('g'), 3, 5, { chord, now: 1200 })).toEqual({ index: 0, action: null });
    // too slow
    listKey(k('g'), 3, 5, { chord, now: 5000 });
    expect(listKey(k('g'), 3, 5, { chord, now: 5000 + CHORD_MS + 1 })!.index).toBe(3);
    // another key cancels a pending g
    const c2 = newChord();
    listKey(k('g'), 3, 5, { chord: c2, now: 1 });
    listKey(k('j'), 3, 5, { chord: c2, now: 2 });
    expect(listKey(k('g'), 4, 5, { chord: c2, now: 3 })!.index).toBe(4);
  });

  it('without a chord state a single g jumps to the top', () => {
    expect(listKey(k('g'), 3, 5)!.index).toBe(0);
  });

  it('⌃d/⌃u move half a page, ⌃n/⌃p one row', () => {
    expect(listKey(k('d', { ctrlKey: true }), 0, 20, { halfPage: 6 })!.index).toBe(6);
    expect(listKey(k('u', { ctrlKey: true }), 10, 20, { halfPage: 6 })!.index).toBe(4);
    expect(listKey(k('n', { ctrlKey: true }), 0, 20)!.index).toBe(1);
    expect(listKey(k('p', { ctrlKey: true }), 5, 20)!.index).toBe(4);
    expect(listKey(k('x', { ctrlKey: true }), 5, 20)).toBeNull();
  });

  it('Enter / l / space activate; Esc / q close; h is back only when asked', () => {
    expect(listKey(k('Enter'), 2, 3)!.action).toBe('activate');
    expect(listKey(k('l'), 2, 3)!.action).toBe('activate');
    expect(listKey(k(' '), 2, 3)!.action).toBe('activate');
    expect(listKey(k(' '), 2, 3, { spaceActivates: false })).toBeNull();
    expect(listKey(k('Escape'), 2, 3)!.action).toBe('close');
    expect(listKey(k('q'), 2, 3)!.action).toBe('close');
    expect(listKey(k('h'), 2, 3)).toBeNull();
    expect(listKey(k('h'), 2, 3, { hBack: true })!.action).toBe('back');
  });

  it('in a text field only arrows, Enter and Esc count', () => {
    const o = { isTextTarget: true };
    expect(listKey(k('j'), 0, 3, o)).toBeNull();
    expect(listKey(k('q'), 0, 3, o)).toBeNull();
    expect(listKey(k('G'), 0, 3, o)).toBeNull();
    expect(listKey(k('ArrowDown'), 0, 3, o)!.index).toBe(1);
    expect(listKey(k('Enter'), 0, 3, o)!.action).toBe('activate');
    expect(listKey(k('Escape'), 0, 3, o)!.action).toBe('close');
  });

  it('ignores meta/alt chords and unknown keys; tolerates empty lists', () => {
    expect(listKey(k('j', { metaKey: true }), 0, 3)).toBeNull();
    expect(listKey(k('j', { altKey: true }), 0, 3)).toBeNull();
    expect(listKey(k('x'), 0, 3)).toBeNull();
    expect(listKey(k('j'), 0, 0)).toEqual({ index: 0, action: null });
    expect(listKey(k('G'), 0, 0)).toEqual({ index: 0, action: null });
  });
});

describe('DOM helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('isTextTarget', () => {
    const mk = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };
    expect(isTextTarget(mk('<input type="text">'))).toBe(true);
    expect(isTextTarget(mk('<input type="search">'))).toBe(true);
    expect(isTextTarget(mk('<textarea></textarea>'))).toBe(true);
    expect(isTextTarget(mk('<input type="checkbox">'))).toBe(false);
    expect(isTextTarget(mk('<button></button>'))).toBe(false);
    expect(isTextTarget(null)).toBe(false);
  });

  it('captureFocus restores the previous element, if still attached', () => {
    document.body.innerHTML = '<button id="a">a</button><button id="b">b</button>';
    const a = document.getElementById('a')!;
    a.focus();
    const restore = captureFocus();
    document.getElementById('b')!.focus();
    restore();
    expect(document.activeElement).toBe(a);

    a.focus();
    const restore2 = captureFocus();
    a.remove();
    document.getElementById('b')!.focus();
    restore2();
    expect(document.activeElement!.id).toBe('b');
  });

  it('trapTab cycles inside the root', () => {
    document.body.innerHTML = '<div id="r"><button id="x">x</button><button disabled>d</button><button id="y">y</button></div>';
    const r = document.getElementById('r')!;
    expect(focusables(r).map((e) => e.id)).toEqual(['x', 'y']);
    document.getElementById('y')!.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(trapTab(ev, r)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement!.id).toBe('x');
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    expect(trapTab(back, r)).toBe(true);
    expect(document.activeElement!.id).toBe('y');
    // Esc is never trapped
    expect(trapTab(new KeyboardEvent('keydown', { key: 'Escape' }), r)).toBe(false);
  });

  it('rovingKey moves focus, clicks on Enter, closes on Esc/q', () => {
    document.body.innerHTML = '<div id="r"><button class="it" id="i0">0</button><button class="it" id="i1">1</button><button class="it" id="i2">2</button><input id="t"></div>';
    const r = document.getElementById('r')!;
    let clicked = '';
    r.querySelectorAll('.it').forEach((b) => b.addEventListener('click', () => (clicked = b.id)));
    let closed = 0;
    const press = (key: string, target: Element = document.activeElement ?? document.body, mods: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...mods });
      Object.defineProperty(ev, 'target', { value: target });
      return rovingKey(ev, r, '.it', () => closed++, { chord: chord });
    };
    const chord = newChord();
    // From outside the list: j lands on the first item, k on the last.
    expect(press('j', document.body)).toBe(true);
    expect(document.activeElement!.id).toBe('i0');
    press('j');
    expect(document.activeElement!.id).toBe('i1');
    press('G');
    expect(document.activeElement!.id).toBe('i2');
    press('g');
    expect(document.activeElement!.id).toBe('i2');
    press('g');
    expect(document.activeElement!.id).toBe('i0');
    press('Enter');
    expect(clicked).toBe('i0');
    press('q');
    expect(closed).toBe(1);
    // typing in a field is left alone, but Esc still closes
    const t = document.getElementById('t')!;
    t.focus();
    expect(press('j', t)).toBe(false);
    expect(press('Escape', t)).toBe(true);
    expect(closed).toBe(2);
  });
});
