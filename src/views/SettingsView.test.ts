// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import SettingsView from './SettingsView.svelte';
import { editorSettings } from '../lib/editor-settings.svelte.ts';
import { uiState } from '../lib/uistate.svelte.ts';

let target: HTMLElement;
let cmp: Record<string, any> | null = null;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}
async function waitFor<T>(fn: () => T | null | undefined | false, label: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await settle();
  }
  throw new Error(`timed out waiting for ${label}`);
}
const text = () => target.textContent ?? '';

beforeEach(() => {
  editorSettings.reset();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  uiState.closeSettings();
  editorSettings.reset();
});

describe('SettingsView', () => {
  it('opens on the requested section and switches with number keys', async () => {
    uiState.openSettings('editor');
    cmp = mount(SettingsView, { target });
    await settle();
    expect(text()).toMatch(/Editing mode/);
    expect(text()).not.toMatch(/Leave insert mode with/);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    await settle();
    expect(text()).toMatch(/Leave insert mode with/);
  });

  it('search filters rows across sections', async () => {
    uiState.openSettings('editor');
    cmp = mount(SettingsView, { target });
    await settle();
    const input = target.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'legend';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(text()).toMatch(/Command legend/);
    expect(text()).not.toMatch(/Editing mode/);
    const toggle = target.querySelector<HTMLInputElement>('[data-testid="legend-toggle"]')!;
    toggle.click();
    await settle();
    expect(editorSettings.value.legend).toBe(false);
  });

  it('escape-sequence presets are one click', async () => {
    uiState.openSettings('vim');
    cmp = mount(SettingsView, { target });
    await settle();
    const jj = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === '+ jj')!;
    jj.click();
    await settle();
    expect(editorSettings.value.escapeSequences).toEqual(['jj']);
  });

  it('the .vimrc is a draft until Apply; diagnostics show per line', async () => {
    uiState.openSettings('vim');
    cmp = mount(SettingsView, { target });
    const content = await waitFor(() => target.querySelector<HTMLElement>('[data-testid="vimrc-editor"] .cm-content'), 'vimrc editor');
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ changes: { from: 0, insert: 'inoremap jj <Esc>\nfrobnicate\nset number' } });
    await settle();
    expect(editorSettings.value.vimrc).toBe('');
    expect(target.querySelector('[data-testid="vimrc-stats"]')!.textContent).toMatch(/1 mapping.*1 error/s);
    expect(target.querySelector('[data-testid="vimrc-diagnostics"]')!.textContent).toMatch(/line 2.*unknown command/s);
    expect(target.querySelector('.cm-vimrc-error')?.textContent).toMatch(/unknown command/);
    target.querySelector<HTMLButtonElement>('[data-testid="vimrc-apply"]')!.click();
    await settle();
    expect(editorSettings.value.vimrc).toBe('inoremap jj <Esc>\nfrobnicate\nset number');
    // `set number` now overrides the Editor toggle.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await settle();
    expect(text()).toMatch(/Line numbers\s*\.vimrc/);
  });
});
