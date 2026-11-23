// @vitest-environment jsdom
//
// Keyboard model of the modals/popovers: j/k move, Enter activates,
// Esc (or q) closes from inside the dialog, focus goes back to where
// it was before the dialog opened.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import ThemePickerModal from './ThemePickerModal.svelte';
import VaultCreateModal from './VaultCreateModal.svelte';
import SyncStatusPopover from './SyncStatusPopover.svelte';
import HelpOverlay from './HelpOverlay.svelte';
import { uiState } from '../lib/uistate.svelte.ts';
import { theme } from '../lib/theme.svelte.ts';
import { accounts } from '../lib/accounts.svelte.ts';
import { books } from '../lib/books.svelte.ts';

let target: HTMLElement;
let opener: HTMLButtonElement;
let cmp: Record<string, any> | null = null;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

function key(k: string, el: Element | null = document.activeElement, mods: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  (el ?? document.body).dispatchEvent(ev);
  flushSync();
  return ev;
}

function open<T extends Record<string, any>>(C: any, props: T): void {
  cmp = mount(C, { target, props });
}
function close(): void {
  if (cmp) unmount(cmp);
  cmp = null;
  flushSync();
}

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.appendChild(opener);
  opener.focus();
});

afterEach(() => {
  close();
  target.remove();
  opener.remove();
});

describe('ThemePickerModal', () => {
  it('focuses the live theme, j/k walk rows, Enter applies, Esc closes and restores focus', async () => {
    uiState.openThemePicker();
    open(ThemePickerModal, {});
    await settle();
    const rows = [...target.querySelectorAll<HTMLElement>('.mode-btn, .theme-row')];
    expect(rows.length).toBeGreaterThan(5);
    const start = rows.indexOf(document.activeElement as HTMLElement);
    expect(start).toBeGreaterThanOrEqual(0);
    expect((document.activeElement as HTMLElement).classList.contains('theme-row')).toBe(true);

    key('j');
    expect(rows.indexOf(document.activeElement as HTMLElement)).toBe(start + 1);
    key('k');
    key('k');
    expect(rows.indexOf(document.activeElement as HTMLElement)).toBe(start - 1);
    key('G');
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    key('g');
    key('g');
    expect(document.activeElement).toBe(rows[0]);

    // Second dark-theme row: Enter applies it.
    const darkRows = [...target.querySelectorAll<HTMLElement>('[aria-label="Dark themes"] .theme-row')];
    darkRows[1].focus();
    key('Enter');
    await settle();
    expect(theme.settings.darkName).toBe(darkRows[1].querySelector('.theme-name')!.textContent);

    const ev = key('Escape');
    expect(ev.defaultPrevented).toBe(true);
    expect(uiState.themePickerOpen).toBe(false);
    close();
    expect(document.activeElement).toBe(opener);
  });

  it('q closes too; Tab stays inside the dialog', async () => {
    uiState.openThemePicker();
    open(ThemePickerModal, {});
    await settle();
    const panel = target.querySelector<HTMLElement>('[role="dialog"]')!;
    const btns = [...panel.querySelectorAll<HTMLElement>('button')];
    btns[btns.length - 1].focus();
    key('Tab');
    expect(document.activeElement).toBe(btns[0]);
    key('q');
    expect(uiState.themePickerOpen).toBe(false);
  });
});

describe('VaultCreateModal', () => {
  it('Esc from inside the name field closes; q only outside text fields; focus restored', async () => {
    const onclose = vi.fn();
    open(VaultCreateModal, { onclose });
    await settle();
    const dialog = target.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe('new-book-title');
    const name = target.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    name.focus();
    key('q', name);
    expect(onclose).not.toHaveBeenCalled();
    // Keys inside the dialog never reach the view underneath.
    let leaked = 0;
    const spy = () => leaked++;
    window.addEventListener('keydown', spy);
    key('j', name);
    window.removeEventListener('keydown', spy);
    expect(leaked).toBe(0);
    key('Escape', name);
    expect(onclose).toHaveBeenCalledTimes(1);

    const cancel = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.focus();
    key('q', cancel);
    expect(onclose).toHaveBeenCalledTimes(2);
    close();
    expect(document.activeElement).toBe(opener);
  });

  it('Enter submits the form natively (button activation is not hijacked)', async () => {
    const onclose = vi.fn();
    open(VaultCreateModal, { onclose });
    await settle();
    const ev = key('Enter', target.querySelector('input[aria-label="Name"]'));
    expect(ev.defaultPrevented).toBe(false);
    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('HelpOverlay', () => {
  it('j/k/G scroll without closing; Esc closes; focus returns', async () => {
    const onclose = vi.fn();
    open(HelpOverlay, { onclose });
    await settle();
    const grid = target.querySelector<HTMLElement>('.grid')!;
    key('j');
    expect(grid.scrollTop).toBe(48);
    key('k');
    expect(grid.scrollTop).toBe(0);
    key('G');
    key('g');
    key('g');
    expect(grid.scrollTop).toBe(0);
    expect(onclose).not.toHaveBeenCalled();
    key('Escape');
    expect(onclose).toHaveBeenCalledTimes(1);
    close();
    expect(document.activeElement).toBe(opener);
  });

  it('any other key closes', async () => {
    const onclose = vi.fn();
    open(HelpOverlay, { onclose });
    await settle();
    key('x');
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});

describe('SyncStatusPopover', () => {
  const A = 'https://a.example';
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 404 }));
    await accounts.add({ server_url: A, username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '2026-01-01T00:00:00Z', expires_at: null, remember: false }, 'ta');
    books.addCreated({ id: 'a1', name: 'Alfa', slug: 'a1', created_by: 'u', created_at: '', owner_user_id: 'u' }, `${A}#ana`);
    books.setActive('a1');
  });
  afterEach(async () => {
    close();
    books.clear();
    for (const a of [...accounts.list]) await accounts.forget(a.key);
    vi.restoreAllMocks();
  });

  it('opens from the keyboard, j/k walk actions, Enter runs, Esc closes back to the indicator', async () => {
    open(SyncStatusPopover, {});
    await settle();
    const trigger = target.querySelector<HTMLButtonElement>('[data-testid="sync-indicator"]')!;
    trigger.focus();
    key('ArrowDown', trigger);
    await settle();
    const panel = target.querySelector<HTMLElement>('[data-testid="sync-panel"]')!;
    expect(panel).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const btns = () => [...panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    key('j', panel);
    expect(document.activeElement).toBe(btns()[0]);
    key('G');
    const last = btns()[btns().length - 1];
    expect(document.activeElement).toBe(last);
    expect(last.textContent).toBe('Desligar');
    key('Enter');
    await settle();
    // "Desligar" asks for confirmation inline.
    expect(panel.textContent).toContain('Remover da lista');
    key('k');
    expect(btns()).toContain(document.activeElement);

    key('Escape');
    await settle();
    expect(target.querySelector('[data-testid="sync-panel"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(books.activeID).toBe('a1');
  });
});
