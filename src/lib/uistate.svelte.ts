// Cross-cutting UI state that doesn't fit neatly into any domain
// store: the theme picker, and the account modal used for
// "Adicionar servidor…" and for re-entering an account that
// "Precisa entrar" (SPEC-LIVROS §5).

export interface AccountModalState {
  server: string | null;
  username: string | null;
}

export type SettingsSection = 'editor' | 'vim' | 'appearance' | 'keys' | 'storage' | 'account';

class UIState {
  themePickerOpen = $state(false);
  /** Full-screen settings view (null = closed). */
  settings = $state<SettingsSection | null>(null);
  /** `?` keymap overlay. */
  helpOpen = $state(false);

  openSettings(section: SettingsSection = 'editor'): void {
    this.settings = section;
  }

  closeSettings(): void {
    this.settings = null;
  }

  /** A deep link (`#/b/<vault>/n/<note>`) waiting for its book's notes
   *  to load; VaultHomeView opens the note and clears it. */
  pendingNote = $state<{ vault: string; note?: string; path?: string } | null>(null);
  /** Short app-level notice (e.g. a deep link to an unknown book). */
  notice = $state<string | null>(null);

  accountModal = $state<AccountModalState | null>(null);
  createBookOpen = $state(false);

  openThemePicker(): void {
    this.themePickerOpen = true;
  }

  closeThemePicker(): void {
    this.themePickerOpen = false;
  }

  toggleThemePicker(): void {
    this.themePickerOpen = !this.themePickerOpen;
  }

  openAddServer(): void {
    this.accountModal = { server: null, username: null };
  }

  openSignIn(server: string, username: string): void {
    this.accountModal = { server, username };
  }

  closeAccountModal(): void {
    this.accountModal = null;
  }
}

export const uiState = new UIState();
