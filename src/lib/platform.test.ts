import { describe, it, expect } from 'vitest';
import { detectPlatform, isApple, isSettingsShortcut, keyLabel, primaryMod, settingsKey, modName } from './platform.ts';
import { keymapFor } from './keymap-help.ts';

const ev = (key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}, code?: string) => ({
  key,
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('detectPlatform', () => {
  it('prefers UA client hints, then navigator.platform, then the UA string', () => {
    expect(detectPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(detectPlatform({ userAgentData: { platform: 'Linux' } })).toBe('linux');
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32' })).toBe('windows');
    expect(detectPlatform({ platform: 'Linux x86_64' })).toBe('linux');
    expect(detectPlatform({ platform: 'iPad' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'Chrome OS' } })).toBe('linux');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
    expect(detectPlatform({})).toBe('other');
    expect(detectPlatform(null)).toBe('other');
  });
  it('only Apple platforms use ⌘', () => {
    expect(isApple('mac')).toBe(true);
    expect(isApple('windows')).toBe(false);
    expect(isApple('linux')).toBe(false);
    expect(isApple('other')).toBe(false);
  });
});

describe('settings shortcut (⌘, / Ctrl+,)', () => {
  it('macOS: ⌘, only', () => {
    expect(isSettingsShortcut(ev(',', { meta: true }), true)).toBe(true);
    expect(isSettingsShortcut(ev(',', { meta: true, shift: true }), true)).toBe(true);
    expect(isSettingsShortcut(ev(',', { ctrl: true }), true)).toBe(false);
    expect(isSettingsShortcut(ev(',', { meta: true, ctrl: true }), true)).toBe(false);
    expect(isSettingsShortcut(ev(',', { meta: true, alt: true }), true)).toBe(false);
    expect(isSettingsShortcut(ev(','), true)).toBe(false);
  });
  it('Windows/Linux: Ctrl+, only (⊞/Super+, is not it)', () => {
    expect(isSettingsShortcut(ev(',', { ctrl: true }), false)).toBe(true);
    expect(isSettingsShortcut(ev('<', { ctrl: true, shift: true }), false)).toBe(true);
    expect(isSettingsShortcut(ev(',', { meta: true }), false)).toBe(false);
    expect(isSettingsShortcut(ev(',', { ctrl: true, alt: true }), false)).toBe(false);
    expect(isSettingsShortcut(ev('k', { ctrl: true }), false)).toBe(false);
  });
  it('matches the physical key on layouts where , is elsewhere', () => {
    expect(isSettingsShortcut(ev(';', { ctrl: true }, 'Comma'), false)).toBe(true);
    expect(isSettingsShortcut(ev('m', { meta: true }, 'KeyM'), true)).toBe(false);
  });
  it('primaryMod follows CodeMirror Mod', () => {
    expect(primaryMod(ev('k', { meta: true }), true)).toBe(true);
    expect(primaryMod(ev('k', { ctrl: true }), true)).toBe(false);
    expect(primaryMod(ev('k', { ctrl: true }), false)).toBe(true);
    expect(primaryMod(ev('k', { meta: true }), false)).toBe(false);
  });
});

describe('keyLabel', () => {
  it('keeps mac glyphs on Apple', () => {
    for (const k of ['⌘K', '⌘⇧E', '⌘⌥P', '⌘,', 'u ⌃r', '⌘-click link']) expect(keyLabel(k, true)).toBe(k);
    expect(settingsKey(true)).toBe('⌘,');
    expect(modName(true)).toBe('⌘');
  });
  it('spells modifiers out elsewhere, Ctrl/Alt/Shift order', () => {
    expect(keyLabel('⌘K', false)).toBe('Ctrl+K');
    expect(keyLabel('⌘E', false)).toBe('Ctrl+E');
    expect(keyLabel('⌘⇧E', false)).toBe('Ctrl+Shift+E');
    expect(keyLabel('⌘⌥P', false)).toBe('Ctrl+Alt+P');
    expect(keyLabel('⇧F10', false)).toBe('Shift+F10');
    expect(keyLabel('⌘,', false)).toBe('Ctrl+,');
    expect(keyLabel('u ⌃r', false)).toBe('u Ctrl+r');
    expect(keyLabel('↑ ↓ ⌃n ⌃p', false)).toBe('↑ ↓ Ctrl+n Ctrl+p');
    expect(keyLabel('⌘-click link', false)).toBe('Ctrl+click link');
    expect(keyLabel('space  :  ⌘K', false)).toBe('space  :  Ctrl+K');
    expect(keyLabel('Rendered preview (⌘⌥P, :preview split)', false)).toBe('Rendered preview (Ctrl+Alt+P, :preview split)');
    expect(keyLabel('gg G', false)).toBe('gg G');
    expect(settingsKey(false)).toBe('Ctrl+,');
    expect(modName(false)).toBe('Ctrl');
  });
  it('the help keymap is platform-correct (and drops mac-only ⌃⌘1–9)', () => {
    const flat = (mac: boolean) => keymapFor(mac).flatMap((s) => s.rows.map(([k]) => k));
    expect(flat(true)).toContain('⌘,  ,');
    expect(flat(true)).toContain('g1–9  ⌃⌘1–9');
    const pc = flat(false);
    expect(pc).toContain('Ctrl+,  ,');
    expect(pc).toContain('g1–9');
    expect(pc).toContain('space  :  Ctrl+K');
    expect(pc.join(' ')).not.toMatch(/[⌘⌃⌥⇧]/);
  });
});
