// Cross-cutting UI state that doesn't fit neatly into any domain
// store. Currently just the theme picker open/close flag — App.svelte
// mounts the modal off this so every authenticated view can open it
// without each one owning the modal markup. Add other transient,
// view-spanning flags here as they come up.

class UIState {
  themePickerOpen = $state(false);

  openThemePicker(): void {
    this.themePickerOpen = true;
  }

  closeThemePicker(): void {
    this.themePickerOpen = false;
  }

  toggleThemePicker(): void {
    this.themePickerOpen = !this.themePickerOpen;
  }
}

export const uiState = new UIState();
