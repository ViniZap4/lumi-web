// @vitest-environment jsdom
//
// Tests for the ThemeStore setters. The store is a singleton — tests
// share state with each other and with any prior runs, so each test
// resets to a known baseline in beforeEach. localStorage and document
// come from the jsdom environment.

import { describe, it, expect, beforeEach } from 'vitest';
import { theme } from './theme.svelte.ts';

const STORAGE_KEY = 'lumi.v2.theme';

beforeEach(() => {
  localStorage.clear();
  theme.setMode('dark');
  theme.setDarkName('tokyo-night');
  theme.setLightName('tokyo-day');
});

describe('ThemeStore.setMode', () => {
  it('updates settings and persists', () => {
    theme.setMode('light');
    expect(theme.settings.mode).toBe('light');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.mode).toBe('light');
  });

  it('changes the resolved active theme when toggling dark→light', () => {
    theme.setMode('dark');
    expect(theme.active.isDark).toBe(true);
    theme.setMode('light');
    expect(theme.active.isDark).toBe(false);
  });
});

describe('ThemeStore.setDarkName', () => {
  it('accepts a valid dark theme and applies it', () => {
    theme.setMode('dark');
    theme.setDarkName('catppuccin-mocha');
    expect(theme.settings.darkName).toBe('catppuccin-mocha');
    expect(theme.active.name).toBe('catppuccin-mocha');
  });

  it('rejects a light theme name silently', () => {
    theme.setDarkName('tokyo-day'); // tokyo-day is a light theme
    // settings.darkName must NOT have been overwritten with a light theme,
    // otherwise mode=dark would resolve to a light theme.
    expect(theme.settings.darkName).toBe('tokyo-night');
  });

  it('rejects a non-existent theme name silently', () => {
    theme.setDarkName('does-not-exist');
    expect(theme.settings.darkName).toBe('tokyo-night');
  });

  it('persists to localStorage', () => {
    theme.setDarkName('dracula');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.darkName).toBe('dracula');
  });
});

describe('ThemeStore.setLightName', () => {
  it('accepts a valid light theme', () => {
    theme.setMode('light');
    theme.setLightName('catppuccin-latte');
    expect(theme.settings.lightName).toBe('catppuccin-latte');
    expect(theme.active.name).toBe('catppuccin-latte');
  });

  it('rejects a dark theme name silently', () => {
    theme.setLightName('tokyo-night'); // dark theme
    expect(theme.settings.lightName).toBe('tokyo-day');
  });

  it('rejects a non-existent theme name silently', () => {
    theme.setLightName('does-not-exist');
    expect(theme.settings.lightName).toBe('tokyo-day');
  });

  it('persists to localStorage', () => {
    theme.setLightName('lgbt-light');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.lightName).toBe('lgbt-light');
  });
});

describe('ThemeStore CSS application', () => {
  it('writes color variables to the document root', () => {
    theme.setMode('dark');
    theme.setDarkName('dracula');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-primary')).toBe('#bd93f9');
    expect(root.style.getPropertyValue('--color-background')).toBe('#282a36');
  });

  it('switches CSS variables when the dark theme changes', () => {
    theme.setMode('dark');
    theme.setDarkName('tokyo-night');
    const before = document.documentElement.style.getPropertyValue('--color-background');
    theme.setDarkName('dracula');
    const after = document.documentElement.style.getPropertyValue('--color-background');
    expect(after).not.toBe(before);
  });
});
