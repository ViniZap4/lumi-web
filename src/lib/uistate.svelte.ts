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
