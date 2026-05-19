// Minimal theme application. Reads user preference from
// localStorage, applies the matching theme's CSS variables to
// :root, and watches the system dark/light query when mode=auto.
//
// Theme catalogue lives in themes.ts (shared with TUI + site).
// Slice 4.1 only ships application; a "pick a theme" UI is a
// later polish slice.

import { themes, type Theme, type ThemeSettings } from './themes.ts';
import type { ThemeMode } from './types.ts';

const STORAGE_KEY = 'lumi.v2.theme';

const DEFAULTS: ThemeSettings = {
  mode: 'auto',
  darkName: 'tokyo-night',
  lightName: 'tokyo-day',
};

function readSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      darkName: parsed.darkName ?? DEFAULTS.darkName,
      lightName: parsed.lightName ?? DEFAULTS.lightName,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(s: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveActive(settings: ThemeSettings): Theme {
  const useDark =
    settings.mode === 'dark' || (settings.mode === 'auto' && systemPrefersDark());
  const name = useDark ? settings.darkName : settings.lightName;
  return themes[name] ?? themes['tokyo-night'];
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--color-primary', theme.primary);
  r.setProperty('--color-secondary', theme.secondary);
  r.setProperty('--color-accent', theme.accent);
  r.setProperty('--color-muted', theme.muted);
  r.setProperty('--color-background', theme.background);
  r.setProperty('--color-selected-bg', theme.selectedBg);
  r.setProperty('--color-overlay-bg', theme.overlayBg);
  r.setProperty('--color-text', theme.text);
  r.setProperty('--color-text-dim', theme.textDim);
  r.setProperty('--color-border', theme.border);
  r.setProperty('--color-separator', theme.separator);
  r.setProperty('--color-error', theme.error);
  r.setProperty('--color-warning', theme.warning);
  r.setProperty('--color-info', theme.info);
  theme.logoColors.forEach((c, i) => r.setProperty(`--color-logo-${i}`, c));
}

class ThemeStore {
  settings = $state<ThemeSettings>(DEFAULTS);
  active = $state<Theme>(themes['tokyo-night']);
  private mediaQuery: MediaQueryList | null = null;
  private mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;

  init(): void {
    this.settings = readSettings();
    this.apply();
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaHandler = () => this.apply();
      this.mediaQuery.addEventListener('change', this.mediaHandler);
    }
  }

  setMode(mode: ThemeMode): void {
    this.settings = { ...this.settings, mode };
    persist(this.settings);
    this.apply();
  }

  /** Pick which theme applies when mode resolves to "dark". Silently
   *  ignores names that don't exist or aren't dark themes — guards
   *  against bad localStorage data and any future UI bugs. */
  setDarkName(name: string): void {
    const t = themes[name];
    if (!t || !t.isDark) return;
    this.settings = { ...this.settings, darkName: name };
    persist(this.settings);
    this.apply();
  }

  /** Pick which theme applies when mode resolves to "light". */
  setLightName(name: string): void {
    const t = themes[name];
    if (!t || t.isDark) return;
    this.settings = { ...this.settings, lightName: name };
    persist(this.settings);
    this.apply();
  }

  destroy(): void {
    if (this.mediaQuery && this.mediaHandler) {
      this.mediaQuery.removeEventListener('change', this.mediaHandler);
    }
    this.mediaQuery = null;
    this.mediaHandler = null;
  }

  private apply(): void {
    this.active = resolveActive(this.settings);
    applyToDocument(this.active);
  }
}

export const theme = new ThemeStore();
