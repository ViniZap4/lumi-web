// Command palette entries (components/CommandPalette.svelte).
export interface PaletteCommand {
  id: string;
  title: string;
  /** Key hint shown at the right (`a`, `zp`, `⌘E`). */
  keys?: string;
  /** Extra search words. */
  group?: string;
  run: () => void;
}
