import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  defaultSettings,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  validateEscapeSequence,
  validateMapping,
  type KVStorage,
} from './editor-settings.ts';
import { EditorSettingsStore } from './editor-settings.svelte.ts';

class FakeStorage implements KVStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('defaults', () => {
  it('Live Preview, vim on, no escape sequences', () => {
    const d = defaultSettings();
    expect(d.editMode).toBe('live');
    expect(d.vim).toBe(true);
    expect(d.escapeSequences).toEqual([]);
    expect(d.openIn).toBe('reading');
    expect(d.tabSize).toBe(4);
  });
  it('returns fresh arrays (no shared mutable state)', () => {
    const a = defaultSettings();
    a.escapeSequences.push('jk');
    expect(defaultSettings().escapeSequences).toEqual([]);
    expect(DEFAULT_SETTINGS.escapeSequences).toEqual([]);
  });
  it('empty / missing storage yields defaults', () => {
    expect(loadSettings(new FakeStorage())).toEqual(defaultSettings());
    expect(loadSettings(null)).toEqual(defaultSettings());
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const st = new FakeStorage();
    const s = { ...defaultSettings(), vim: false, escapeSequences: ['jk', 'ff'], fontSize: 18, editMode: 'source' as const };
    saveSettings(s, st);
    expect(JSON.parse(st.getItem(STORAGE_KEY)!).escapeSequences).toEqual(['jk', 'ff']);
    expect(loadSettings(st)).toEqual(s);
  });
  it('survives throwing storage', () => {
    const bad: KVStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); },
    };
    expect(loadSettings(bad)).toEqual(defaultSettings());
    expect(() => saveSettings(defaultSettings(), bad)).not.toThrow();
  });
  it('corrupt JSON falls back to defaults', () => {
    const st = new FakeStorage();
    st.setItem(STORAGE_KEY, '{nope');
    expect(loadSettings(st)).toEqual(defaultSettings());
  });
  it('store update() sanitises and persists', () => {
    const st = new FakeStorage();
    const store = new EditorSettingsStore(st);
    store.update({ fontSize: 99, escapeSequences: ['jk', 'x'] });
    expect(store.value.fontSize).toBe(24);
    expect(store.value.escapeSequences).toEqual(['jk']);
    expect(new EditorSettingsStore(st).value.fontSize).toBe(24);
    store.toggleEditMode();
    expect(store.value.editMode).toBe('source');
    store.reset();
    expect(store.value).toEqual(defaultSettings());
  });
});

describe('sanitizeSettings (invalid input)', () => {
  it('non-objects become defaults', () => {
    for (const v of [null, 1, 'x', [], true]) expect(sanitizeSettings(v)).toEqual(defaultSettings());
  });
  it('wrong field types fall back per field', () => {
    const s = sanitizeSettings({ vim: 'yes', lineWrapping: false, editMode: 'wysiwyg', openIn: 'editing', tabSize: 3, fontSize: 'big' });
    expect(s.vim).toBe(true);
    expect(s.lineWrapping).toBe(false);
    expect(s.editMode).toBe('live');
    expect(s.openIn).toBe('editing');
    expect(s.tabSize).toBe(4);
    expect(s.fontSize).toBe(15);
  });
  it('clamps numbers', () => {
    expect(sanitizeSettings({ fontSize: 2 }).fontSize).toBe(11);
    expect(sanitizeSettings({ fontSize: 1e9 }).fontSize).toBe(24);
    expect(sanitizeSettings({ escapeTimeout: 5 }).escapeTimeout).toBe(100);
    expect(sanitizeSettings({ escapeTimeout: NaN }).escapeTimeout).toBe(200);
  });
  it('drops invalid / duplicate escape sequences and caps the list', () => {
    const s = sanitizeSettings({ escapeSequences: ['jk', 'jk', 'j', 'a b', '<Esc>', 7, 'jj', 'abcde'] });
    expect(s.escapeSequences).toEqual(['jk', 'jj']);
    const many = sanitizeSettings({ escapeSequences: Array.from({ length: 20 }, (_, i) => 'q' + String.fromCharCode(97 + i)) });
    expect(many.escapeSequences.length).toBe(8);
  });
  it('drops invalid mappings', () => {
    const s = sanitizeSettings({
      mappings: [
        { mode: 'normal', lhs: 'H', rhs: '^' },
        { mode: 'ex', lhs: 'a', rhs: 'b' },
        { mode: 'insert', lhs: '', rhs: 'b' },
        { mode: 'normal', lhs: ':w', rhs: 'b' },
        { mode: 'visual', lhs: 'x'.repeat(40), rhs: 'b' },
        'nope',
      ],
    });
    expect(s.mappings).toEqual([{ mode: 'normal', lhs: 'H', rhs: '^', noremap: false }]);
  });
});

describe('validateEscapeSequence', () => {
  it('accepts 2–4 printable chars', () => {
    expect(validateEscapeSequence('jk')).toEqual({ ok: true, value: 'jk' });
    expect(validateEscapeSequence(' ff ')).toEqual({ ok: true, value: 'ff' });
    expect(validateEscapeSequence('çç')).toEqual({ ok: true, value: 'çç' });
    expect(validateEscapeSequence('jjjj').ok).toBe(true);
  });
  it('rejects too short / long / whitespace / notation / control chars', () => {
    for (const v of ['', 'j', 'abcde', 'j k', '<C-c>', 'j\u0007']) expect(validateEscapeSequence(v).ok).toBe(false);
  });
});

describe('validateMapping', () => {
  it('trims and keeps noremap flag', () => {
    expect(validateMapping({ mode: 'insert', lhs: ' <C-l> ', rhs: '<Right>', noremap: true }))
      .toEqual({ mode: 'insert', lhs: '<C-l>', rhs: '<Right>', noremap: true });
  });
});

describe('module default storage (localStorage)', () => {
  beforeEach(() => localStorage.clear());
  it('uses localStorage when no storage is injected', () => {
    saveSettings({ ...defaultSettings(), fontSize: 13 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).fontSize).toBe(13);
    expect(loadSettings().fontSize).toBe(13);
  });
});
