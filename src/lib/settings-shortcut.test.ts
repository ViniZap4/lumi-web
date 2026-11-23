// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installSettingsShortcut } from './settings-shortcut.ts';

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
  document.body.innerHTML = '';
});

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/** A CodeMirror-like contenteditable whose own handler swallows keys
 *  (vim normal mode consumes everything it sees). */
function fakeEditor(): { el: HTMLElement; seen: KeyboardEvent[] } {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  const seen: KeyboardEvent[] = [];
  el.addEventListener('keydown', (e) => { seen.push(e); e.preventDefault(); e.stopPropagation(); });
  document.body.append(el);
  return { el, seen };
}

describe('installSettingsShortcut', () => {
  it('Ctrl+, (Windows/Linux) toggles from inside the editor, before the editor sees it', () => {
    const toggle = vi.fn();
    off = installSettingsShortcut(window, { toggle, mac: false });
    const ed = fakeEditor();
    const e = press(ed.el, { key: ',', code: 'Comma', ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(ed.seen).toHaveLength(0);
    // ⌘/Super+, is not the shortcut there; plain keys still reach the editor.
    press(ed.el, { key: ',', code: 'Comma', metaKey: true });
    press(ed.el, { key: 'j' });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(ed.seen).toHaveLength(2);
  });

  it('⌘, (macOS) works from a text field inside a modal that stops propagation', () => {
    const toggle = vi.fn();
    off = installSettingsShortcut(window, { toggle, mac: true });
    const modal = document.createElement('div');
    modal.addEventListener('keydown', (e) => e.stopPropagation());
    const input = document.createElement('input');
    modal.append(input);
    document.body.append(modal);
    press(input, { key: ',', code: 'Comma', metaKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    press(input, { key: ',', code: 'Comma', ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('ignores auto-repeat and respects enabled()', () => {
    const toggle = vi.fn();
    let on = false;
    off = installSettingsShortcut(window, { toggle, mac: false, enabled: () => on });
    const e = press(document.body, { key: ',', ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    on = true;
    press(document.body, { key: ',', ctrlKey: true, repeat: true });
    expect(toggle).not.toHaveBeenCalled();
    press(document.body, { key: ',', ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('uninstalls cleanly', () => {
    const toggle = vi.fn();
    installSettingsShortcut(window, { toggle, mac: false })();
    press(document.body, { key: ',', ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });
});
