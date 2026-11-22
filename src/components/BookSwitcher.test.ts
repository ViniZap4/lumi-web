// @vitest-environment jsdom
//
// Book switcher keyboard (SPEC-LIVROS §5): open, j/k/↑/↓, Enter, Esc,
// digit shortcut; keys never leak to the view underneath.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import BookSwitcher from './BookSwitcher.svelte';
import { accounts } from '../lib/accounts.svelte.ts';
import { books } from '../lib/books.svelte.ts';

const A = 'https://a.example';
const B = 'https://b.example';
let target: HTMLElement;
let cmp: Record<string, any> | null = null;
const vault = (id: string, name: string) => ({ id, name, slug: id, created_by: 'u', created_at: '', owner_user_id: 'u' });

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

function key(el: Element, k: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  flushSync();
  return ev;
}

beforeEach(async () => {
  await accounts.add({ server_url: A, username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '2026-01-01T00:00:00Z', expires_at: null, remember: false }, 'ta');
  await accounts.add({ server_url: B, username: 'bia', user_id: 'u2', display_name: 'Bia', added_at: '2026-02-01T00:00:00Z', expires_at: null, remember: false }, 'tb');
  books.addCreated(vault('a1', 'Alfa'), `${A}#ana`);
  books.addCreated(vault('a2', 'Beta'), `${A}#ana`);
  books.addCreated(vault('b1', 'Gama'), `${B}#bia`);
  books.setActive('a1');
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(BookSwitcher, { target });
  await settle();
});

afterEach(async () => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  books.clear();
  for (const a of [...accounts.list]) await accounts.forget(a.key);
});

const button = () => target.querySelector<HTMLButtonElement>('[data-testid="book-switcher"]')!;
const list = () => target.querySelector<HTMLElement>('[role="listbox"]');
const cursorName = () => target.querySelector('.opt.cursor .opt-name')?.textContent;

describe('BookSwitcher keyboard', () => {
  it('shows the active book; opens a listbox grouped by server with focus on it', async () => {
    expect(button().textContent).toContain('Alfa');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    button().click();
    await settle();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(list());
    expect([...target.querySelectorAll('.group')].map((g) => g.textContent)).toEqual(['a.example', 'b.example']);
    expect([...target.querySelectorAll('.opt-meta')].map((m) => m.textContent?.trim())).toEqual([
      'ana · g1', 'ana · g2', 'bia · g3',
    ]);
    expect(cursorName()).toBe('Alfa');
  });

  it('j/k/↓/↑ move, Enter opens the book, keys do not bubble to the view', async () => {
    button().click();
    await settle();
    let bubbled = 0;
    const onWin = () => bubbled++;
    window.addEventListener('keydown', onWin);
    key(list()!, 'j');
    expect(cursorName()).toBe('Beta');
    key(list()!, 'ArrowDown');
    expect(cursorName()).toBe('Gama');
    key(list()!, 'ArrowDown');
    expect(cursorName()).toBe('Gama'); // clamped
    key(list()!, 'k');
    key(list()!, 'ArrowUp');
    expect(cursorName()).toBe('Alfa');
    key(list()!, 'End');
    key(list()!, 'Enter');
    await settle();
    window.removeEventListener('keydown', onWin);
    expect(bubbled).toBe(0);
    expect(books.activeID).toBe('b1');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('Esc closes without changing the book; a digit opens that book', async () => {
    button().click();
    await settle();
    key(list()!, 'j');
    key(list()!, 'Escape');
    await settle();
    expect(list()).toBeNull();
    expect(books.activeID).toBe('a1');
    button().click();
    await settle();
    key(list()!, '2');
    await settle();
    expect(books.activeID).toBe('a2');
  });
});
