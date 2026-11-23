// Platform detection + platform-correct shortcut labels.
//
// Shortcuts are written once in macOS glyph notation (`⌘K`, `⌘⇧E`,
// `⌘⌥P`, `⌃d`) and rendered per platform: unchanged on Apple devices,
// `Ctrl+K`, `Ctrl+Shift+E`, `Ctrl+Alt+P`, `Ctrl+d` elsewhere. Matching
// follows CodeMirror's `Mod`: ⌘ (metaKey) on Apple, Ctrl elsewhere.

export type Platform = 'mac' | 'windows' | 'linux' | 'other';

/** The slice of `navigator` we read (tests pass a fake). */
export interface NavigatorLike {
  userAgentData?: { platform?: string } | null;
  platform?: string;
  userAgent?: string;
}

export function detectPlatform(nav: NavigatorLike | null | undefined = typeof navigator !== 'undefined' ? navigator : null): Platform {
  if (!nav) return 'other';
  let p = '';
  try {
    // UA Client Hints first (Chromium), then the legacy fields.
    p = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  } catch {
    return 'other';
  }
  // iPadOS / iOS with a hardware keyboard use ⌘ like macOS.
  if (/mac|iphone|ipad|ipod|ios/i.test(p)) return 'mac';
  if (/win/i.test(p)) return 'windows';
  if (/linux|x11|cros|chrome os|android/i.test(p)) return 'linux';
  return 'other';
}

/** Apple keyboard conventions (⌘ is the primary modifier). */
export function isApple(p: Platform = detectPlatform()): boolean {
  return p === 'mac';
}

/** Detected once per page load (the platform cannot change). */
export const PLATFORM: Platform = detectPlatform();
export const MAC: boolean = isApple(PLATFORM);

type ModEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'> & { code?: string };

/** The primary modifier (⌘ on Apple, Ctrl elsewhere) — and only it. */
export function primaryMod(e: ModEvent, mac: boolean = MAC): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * ⌘, (Apple) / Ctrl+, (Windows, Linux): open settings. Shift is
 * tolerated (⌘⇧, was the earlier binding and stays). Matches on the
 * physical key too, so layouts where `,` needs a modifier still work.
 */
export function isSettingsShortcut(e: ModEvent, mac: boolean = MAC): boolean {
  if (e.altKey || !primaryMod(e, mac)) return false;
  return e.key === ',' || e.key === '<' || e.code === 'Comma';
}

/** Mac glyph → PC modifier name, in PC display order. */
const PC_MOD: Record<string, string> = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };
const PC_ORDER = ['Ctrl', 'Alt', 'Shift'];

/**
 * Render a shortcut written in mac glyphs for the platform. Every run
 * of modifier glyphs plus the key after it is rewritten; plain keys,
 * vim notation and words are untouched. `⌘-click` → `Ctrl+click`.
 *
 *   keyLabel('⌘⇧E', false)  → 'Ctrl+Shift+E'
 *   keyLabel('⌘⌥P', false)  → 'Ctrl+Alt+P'
 *   keyLabel('u ⌃r', false) → 'u Ctrl+r'
 *   keyLabel('⌘K', true)    → '⌘K'
 */
export function keyLabel(s: string, mac: boolean = MAC): string {
  if (mac || !s) return s;
  return s.replace(/([⌃⌥⇧⌘]+)-?(?=\S)/g, (run) => {
    // ⌃ and ⌘ both become Ctrl; keep one.
    const mods = new Set(Array.from(run.replace(/-$/, '')).map((g) => PC_MOD[g]));
    return PC_ORDER.filter((m) => mods.has(m)).join('+') + '+';
  });
}

/** `⌘` or `Ctrl` (for prose such as "⌘-click" vs "Ctrl-click"). */
export function modName(mac: boolean = MAC): string {
  return mac ? '⌘' : 'Ctrl';
}

/** The settings shortcut label: `⌘,` or `Ctrl+,`. */
export function settingsKey(mac: boolean = MAC): string {
  return keyLabel('⌘,', mac);
}
