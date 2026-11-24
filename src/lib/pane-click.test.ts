// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { installPaneClickFocus, focusLanded } from './pane-click.ts';
import { dropSide, noteIdOfKey } from './pane-drop.ts';

function setup() {
  document.body.innerHTML = `
    <div id="root">
      <section data-leaf="a" tabindex="-1"><header class="bar"><span class="title">A</span></header><div class="scroll" tabindex="0"><button class="act">act</button><p class="txt">text</p></div></section>
      <section data-leaf="b"><header class="bar"><span class="title">B</span></header><div class="scroll" tabindex="0"><button class="act">act</button></div></section>
    </div>`;
  const root = document.getElementById('root')!;
  const calls: string[] = [];
  const off = installPaneClickFocus(root, {
    activate: (l) => calls.push('activate:' + l),
    focus: (l) => {
      calls.push('focus:' + l);
      root.querySelector<HTMLElement>(`[data-leaf="${l}"] .scroll`)!.focus();
    },
    defer: (fn) => fn(),
  });
  return { root, calls, off };
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('pane click-to-focus (first click focuses AND acts)', () => {
  it('a click on a button in an inactive pane activates the pane and still runs the button', () => {
    const { root, calls } = setup();
    const btn = root.querySelector('[data-leaf="b"] .act')!;
    const onclick = vi.fn();
    btn.addEventListener('click', onclick);
    click(btn);
    expect(calls[0]).toBe('activate:b');
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('activation happens even when an inner handler stops the pointerdown (canvas / kanban)', () => {
    const { root, calls } = setup();
    const t = root.querySelector('[data-leaf="b"] .scroll')!;
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    click(t);
    expect(calls).toContain('activate:b');
  });

  it('a click on a non-focusable header moves keyboard focus into that pane', () => {
    const { root, calls } = setup();
    (root.querySelector('[data-leaf="a"] .scroll') as HTMLElement).focus();
    click(root.querySelector('[data-leaf="b"] .title')!);
    expect(calls).toEqual(['activate:b', 'focus:b']);
    expect(document.activeElement?.closest('[data-leaf]')?.getAttribute('data-leaf')).toBe('b');
  });

  it('does not steal focus that the click already put inside the pane', () => {
    const { root, calls } = setup();
    const s = root.querySelector('[data-leaf="b"] .scroll') as HTMLElement;
    s.addEventListener('pointerdown', () => s.focus());
    click(s);
    expect(calls).toEqual(['activate:b']);
  });

  it('focus left on the pane wrapper (editing pane) is handed to the pane', () => {
    const { root, calls } = setup();
    const wrap = root.querySelector('[data-leaf="a"]') as HTMLElement;
    wrap.addEventListener('pointerdown', () => wrap.focus());
    click(root.querySelector('[data-leaf="a"] .title')!);
    expect(calls).toEqual(['activate:a', 'focus:a']);
  });

  it('clicks outside panes do nothing; uninstall removes the listeners', () => {
    const { root, calls, off } = setup();
    click(root);
    expect(calls).toEqual([]);
    off();
    click(root.querySelector('[data-leaf="b"] .title')!);
    expect(calls).toEqual([]);
  });

  it('focusLanded', () => {
    const { root } = setup();
    const a = root.querySelector('[data-leaf="a"]')!;
    expect(focusLanded(a, document.body)).toBe(false);
    expect(focusLanded(a, a)).toBe(false);
    expect(focusLanded(a, a.querySelector('.scroll'))).toBe(true);
    expect(focusLanded(a, root.querySelector('[data-leaf="b"] .scroll'))).toBe(false);
  });
});

describe('drop a note on a pane edge', () => {
  const r = { left: 0, top: 0, width: 1000, height: 600 };
  it('picks the nearest edge within the band', () => {
    expect(dropSide(r, 50, 300)).toEqual({ side: 'left', dir: 'row', before: true });
    expect(dropSide(r, 950, 300)).toEqual({ side: 'right', dir: 'row', before: false });
    expect(dropSide(r, 500, 20)).toEqual({ side: 'top', dir: 'col', before: true });
    expect(dropSide(r, 500, 590)).toEqual({ side: 'bottom', dir: 'col', before: false });
  });
  it('the middle and the outside are not drop targets', () => {
    expect(dropSide(r, 500, 300)).toBeNull();
    expect(dropSide(r, -5, 300)).toBeNull();
    expect(dropSide({ ...r, width: 0 }, 0, 0)).toBeNull();
  });
  it('row keys', () => {
    expect(noteIdOfKey('n:abc')).toBe('abc');
    expect(noteIdOfKey('d:work')).toBeNull();
  });
});
