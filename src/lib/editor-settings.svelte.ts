// Reactive editor-settings store ($state), backed by localStorage via
// editor-settings.ts. Consumers read `editorSettings.value` and write
// through `update()` — every write is sanitised and persisted.

import { loadSettings, saveSettings, sanitizeSettings, defaultSettings, type EditorSettings, type KVStorage } from './editor-settings.ts';

export class EditorSettingsStore {
  value = $state<EditorSettings>(defaultSettings());
  /** Settings modal visibility (one per app). */
  open = $state(false);
  private readonly storage: KVStorage | null | undefined;

  constructor(storage?: KVStorage | null) {
    this.storage = storage;
    this.value = storage === undefined ? loadSettings() : loadSettings(storage);
  }

  update(patch: Partial<EditorSettings>): void {
    const next = sanitizeSettings({ ...$state.snapshot(this.value), ...patch });
    this.value = next;
    if (this.storage === undefined) saveSettings(next);
    else saveSettings(next, this.storage);
  }

  reset(): void {
    this.update(defaultSettings());
  }

  toggleEditMode(): void {
    this.update({ editMode: this.value.editMode === 'live' ? 'source' : 'live' });
  }
}

export const editorSettings = new EditorSettingsStore();
