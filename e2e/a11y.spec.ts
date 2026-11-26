// Accessibility gate (WP 0.10, research 09 Q7): axe-core on every key
// screen must report 0 serious or critical violations. PR smoke: the 2
// default themes. Nightly (@matrix): all 12 themes, which is where
// colour-contrast regressions in the dim identity themes show up.
//
// KNOWN lists what fails today (found when this harness landed,
// 2026-11-26), keyed `screen:rule@theme` with `*` wildcards, with the
// reason. Those are reported as annotations instead of failing the run;
// anything else fails. Shrink this list; growing it needs the owner's
// approval in the PR.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, seed, signIn, settle, openNote, SMOKE_THEMES, ALL_THEMES } from './fixtures.ts';

const KNOWN: Record<string, string> = {
  // Muted labels below 4.5:1 on tokyo-night: the sync dot's "Offline"
  // label, the palette label, the TOC label, board meta, the home
  // eyebrow and status-line items (design tokens, Phase 3 design v3).
  '*:color-contrast@tokyo-night': 'muted text tokens under 4.5:1 on tokyo-night',
  // Same muted tokens in the other dark themes (nightly matrix).
  '*:color-contrast@catppuccin-mocha': 'muted text tokens under 4.5:1',
  '*:color-contrast@dracula': 'muted text tokens under 4.5:1',
  '*:color-contrast@transfem': 'muted text tokens under 4.5:1',
  '*:color-contrast@transmasc': 'muted text tokens under 4.5:1',
  // Explorer rows are role=option with action buttons inside.
  'explorer:nested-interactive@*': 'floating explorer rows nest buttons inside options',
  // Note embeds on a canvas scroll but cannot take keyboard focus.
  'canvas:scrollable-region-focusable@*': 'canvas note embeds (.cv-embed) scroll without a focus stop',
};

function known(screen: string, rule: string, theme: string): string | undefined {
  for (const s of [screen, '*']) for (const t of [theme, '*']) {
    const k = KNOWN[`${s}:${rule}@${t}`];
    if (k) return k;
  }
  return undefined;
}

type Screen = 'login' | 'explorer' | 'reader' | 'editor' | 'board' | 'canvas';

async function audit(page: Page, screen: Screen, theme: string): Promise<string[]> {
  await settle(page);
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const failures: string[] = [];
  for (const v of bad) {
    const line = `${screen} · ${theme} · ${v.id} (${v.impact}): ${v.help} — ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join(' | ')}`;
    if (known(screen, v.id, theme)) test.info().annotations.push({ type: 'known a11y debt', description: line });
    else failures.push(line);
  }
  return failures;
}

async function tour(page: Page, theme: string): Promise<string[]> {
  const out: string[] = [];
  await page.goto('/');
  await page.waitForSelector('#lumi-server-url');
  out.push(...(await audit(page, 'login', theme)));
  await signIn(page);
  out.push(...(await audit(page, 'explorer', theme)));
  await openNote(page, 'Showcase');
  await page.locator('[data-testid=md-body]').first().waitFor();
  out.push(...(await audit(page, 'reader', theme)));
  await page.keyboard.press('e');
  await page.locator('.cm-content').first().waitFor();
  out.push(...(await audit(page, 'editor', theme)));
  await page.keyboard.press('Escape');
  await openNote(page, 'board');
  await page.locator('[data-testid=kanban-board]').first().waitFor();
  out.push(...(await audit(page, 'board', theme)));
  await openNote(page, 'small');
  await page.locator('[data-testid=canvas-view]').first().waitFor();
  out.push(...(await audit(page, 'canvas', theme)));
  return out;
}

for (const theme of SMOKE_THEMES) {
  test.describe(`a11y smoke · ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
    test(`axe: 0 serious/critical · ${theme}`, async ({ context, page }) => {
      await seed(context, { theme });
      const failures = await tour(page, theme);
      expect(failures, failures.join('\n')).toEqual([]);
    });
  });
}

for (const theme of ALL_THEMES) {
  test.describe(`a11y matrix · ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
    test(`@matrix axe: 0 serious/critical · ${theme}`, async ({ context, page }) => {
      await seed(context, { theme });
      const failures = await tour(page, theme);
      expect(failures, failures.join('\n')).toEqual([]);
    });
  });
}
