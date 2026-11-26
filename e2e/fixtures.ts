// Shared helpers for the headless quality harness (playwright.config.ts).
// Every spec drives the production bundle against the mock API, signs in
// as the mock's single user and navigates with the real keymap.
import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes, themeOrder } from '../src/lib/themes.ts';

export { expect };

/** PR smoke themes: the default dark and light pair. */
export const SMOKE_THEMES = ['tokyo-night', 'catppuccin-latte'] as const;
export const ALL_THEMES = themeOrder;
export const WIDTHS = [390, 1024, 1440] as const;
export const HEIGHTS: Record<number, number> = { 390: 844, 1024: 768, 1440: 900 };
export const SCHEMES = ['dark', 'light'] as const;

/** Fixed wall clock so relative dates ("há 2 dias") never drift. */
export const FIXED_NOW = new Date('2026-11-24T12:00:00-03:00');

export interface LumiOptions {
  theme?: string;
  motion?: 'full' | 'soft' | 'reduced';
}

/** Seeds theme + motion settings before any app script runs. */
export async function seed(ctx: BrowserContext | Page, opts: LumiOptions = {}): Promise<void> {
  const name = opts.theme ?? 'tokyo-night';
  const t = themes[name];
  if (!t) throw new Error(`unknown theme ${name}`);
  const theme = t.isDark
    ? { mode: 'dark', darkName: name, lightName: 'catppuccin-latte' }
    : { mode: 'light', darkName: 'tokyo-night', lightName: name };
  await ctx.addInitScript(
    ([th, motion]) => {
      try {
        localStorage.setItem('lumi.v2.theme', JSON.stringify(th));
        if (motion) localStorage.setItem('lumi.v2.editor', JSON.stringify({ motion }));
      } catch {
        /* storage blocked: defaults apply */
      }
    },
    [theme, opts.motion ?? null] as const,
  );
}

/** Signs in through the real login form (the mock accepts anything). */
export async function signIn(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  if (!origin.startsWith('http')) throw new Error('signIn: navigate to the app first');
  await page.fill('#lumi-server-url', origin);
  await page.fill('#lumi-username', 'admin');
  await page.fill('#lumi-password', 'pw');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15_000 });
}

/** Waits until fonts are ready and two frames have painted. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

/** Opens a note by its title through the floating explorer. */
export async function openNote(page: Page, title: string): Promise<void> {
  const fx = page.locator('[data-testid=floating-explorer]');
  if (!(await fx.isVisible().catch(() => false))) {
    await page.keyboard.press('-');
    await fx.waitFor({ state: 'visible', timeout: 5_000 });
  }
  await fx.locator('.fx-current').getByText(title, { exact: true }).first().click();
  await page.keyboard.press('Enter');
  await fx.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A free loopback port (other tools on the machine may hold fixed ones). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * One mock server per worker: specs never see each other's presence,
 * sockets or edits (the mock keeps one shared Yjs doc per note).
 */
export const test = base.extend<object, { mockURL: string }>({
  mockURL: [
    async ({}, use) => {
      const port = await freePort();
      const proc = spawn(process.execPath, [path.join(ROOT, 'scripts/perf/mock-server.mjs'), String(port)], {
        cwd: ROOT,
        env: { ...process.env, DIST: path.join(ROOT, 'dist') },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      let exited: number | null = null;
      proc.on('exit', (code) => (exited = code ?? -1));
      const url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 15_000;
      for (;;) {
        if (exited !== null) throw new Error(`mock server on ${port} exited (${exited})`);
        try {
          if ((await fetch(url + '/api/info')).ok) break;
        } catch {
          /* not up yet */
        }
        if (Date.now() > deadline) throw new Error(`mock server on ${port} did not start (did you run \`npm run build\`?)`);
        await new Promise((r) => setTimeout(r, 100));
      }
      await use(url);
      proc.kill('SIGTERM');
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ mockURL }, use) => use(mockURL),
});
