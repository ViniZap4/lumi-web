// Motion gates (WP 0.10; PHASE3-PROPOSAL §1 principle 1 and §2 C14):
//
// 1. Reduce Motion (the OS preference, or Configurações → Movimento →
//    reduzido): no animated transform at all; only opacity dissolves of
//    at most 100 ms.
// 2. Idle: after 60 s without input no animation is still running
//    (ambient motion stops; 0 compositor frames at rest).
//
// Animations are read through the page's own Web Animations API
// (document.getAnimations(), which covers CSS transitions, CSS
// animations and WAAPI), sampled every frame while the test drives the
// app, so nothing depends on screenshot timing.
import type { Page } from '@playwright/test';
import { test, expect, seed, signIn, openNote, FIXED_NOW } from './fixtures.ts';

interface Seen {
  kind: string;
  name: string;
  props: string[];
  transform: boolean;
  duration: number;
  iterations: number;
  target: string;
}

/** Records every animation that appears while the page runs. */
async function recordAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = new WeakSet<Animation>();
    const out: unknown[] = [];
    (window as unknown as { __anims: unknown[] }).__anims = out;
    const MOVING = /^(transform|translate|scale|rotate|offset-|inset|top|left|right|bottom|margin)/;
    const describe = (a: Animation) => {
      const eff = a.effect as KeyframeEffect | null;
      const kfs = eff?.getKeyframes?.() ?? [];
      const props = new Set<string>();
      for (const k of kfs) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p);
      if ('transitionProperty' in a) props.add(String((a as CSSTransition).transitionProperty));
      // A transform that is the identity in every keyframe is not motion.
      const transform = kfs.some((k) =>
        Object.entries(k).some(([p, v]) => MOVING.test(p) && v != null && !/^(none|0(px)?|1|0deg|translate(3d)?\(0(px)?, 0(px)?(, 0(px)?)?\)|scale\(1\)|matrix\(1, 0, 0, 1, 0, 0\))$/.test(String(v).trim())),
      ) || [...props].some((p) => MOVING.test(p) && kfs.length === 0);
      const t = eff?.getComputedTiming?.();
      const el = eff?.target as Element | null;
      return {
        kind: a.constructor.name,
        name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? '',
        props: [...props],
        transform,
        duration: Number(t?.duration ?? 0),
        iterations: Number(t?.iterations ?? 1),
        target: el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList?.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}` : '',
      };
    };
    const tick = () => {
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        seen.add(a);
        out.push(describe(a));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const seenAnimations = (page: Page) => page.evaluate(() => (window as unknown as { __anims: Seen[] }).__anims) as Promise<Seen[]>;

/** A tour that triggers the main choreographies: explorer, books level, notes, board, canvas. */
async function drive(page: Page): Promise<void> {
  await page.goto('/');
  await signIn(page);
  await page.waitForTimeout(300);
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.waitForTimeout(300);
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  await openNote(page, 'Showcase');
  await page.waitForTimeout(300);
  await openNote(page, 'board');
  await page.waitForTimeout(300);
  await page.keyboard.press('j');
  await page.keyboard.press('l');
  await openNote(page, 'small');
  await page.waitForTimeout(300);
  await page.keyboard.press('-');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

function assertReduced(list: Seen[]): void {
  const moving = list.filter((a) => a.transform);
  expect(moving, `animated transforms under reduced motion:\n${JSON.stringify(moving, null, 1)}`).toEqual([]);
  const long = list.filter((a) => a.duration > 100 || a.iterations === Infinity);
  expect(long, `animations longer than 100 ms under reduced motion:\n${JSON.stringify(long, null, 1)}`).toEqual([]);
  const notOpacity = list.filter((a) => a.props.some((p) => p !== 'opacity' && p !== 'all'));
  expect(notOpacity, `non-opacity animations under reduced motion:\n${JSON.stringify(notOpacity, null, 1)}`).toEqual([]);
}

test.describe('reduced motion', () => {
  test.describe('OS preference', () => {
    test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
    test('only opacity dissolves of at most 100 ms', async ({ context, page }) => {
      await seed(context, {});
      await recordAnimations(page);
      await drive(page);
      assertReduced(await seenAnimations(page));
    });
  });

  test.describe('app setting (Movimento: reduzido)', () => {
    test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'no-preference' } });
    test('only opacity dissolves of at most 100 ms', async ({ context, page }) => {
      await seed(context, { motion: 'reduced' });
      await recordAnimations(page);
      await drive(page);
      assertReduced(await seenAnimations(page));
    });
  });

  test.describe('full motion (control)', () => {
    test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'no-preference' } });
    test('the same tour does animate transforms', async ({ context, page }) => {
      // Guards the recorder itself: if this finds nothing, the reduced
      // checks above would pass vacuously.
      await seed(context, { motion: 'full' });
      await recordAnimations(page);
      await drive(page);
      expect((await seenAnimations(page)).some((a) => a.transform)).toBe(true);
    });
  });
});

// Ambient loops that do not stop at idle today (found when this harness
// landed, 2026-11-26): the wordmark's `mark-turn` loop and the home
// blooms. PHASE3-PROPOSAL principle 1 / C15 cut or idle-stop them. Any
// other animation still running fails the gate, and a KNOWN entry that
// no longer shows up fails too, so this list only shrinks.
const IDLE_KNOWN: Record<'home' | 'note', string[]> = {
  home: ['mark-turn', 'ambient-drift-a', 'ambient-drift-b'],
  note: ['mark-turn'],
};

test.describe('idle', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'no-preference' } });

  for (const where of ['home', 'note'] as const) {
    test(`no animation is running after 60 s idle · ${where}`, async ({ context, page }) => {
      await seed(context, { motion: 'full' });
      await page.clock.install({ time: FIXED_NOW });
      await page.goto('/');
      await signIn(page);
      await page.keyboard.press('Escape');
      if (where === 'note') {
        await openNote(page, 'Showcase');
        await page.locator('[data-testid=md-body]').first().waitFor();
      }
      await page.mouse.move(2, 2);
      // The fake clock drives timers and Date (idle timeouts), but not
      // the document timeline: CSS/WAAPI animations only advance in real
      // time. Run the animation timeline 100x through CDP so the next
      // ~0.7 s of real time is ~70 s of animation time, and one-shot
      // entrances have really finished before we look.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Animation.enable');
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 100 });
      await page.clock.runFor(61_000);
      await page.waitForTimeout(700);
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .map((a) => {
            const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
            const name = String((a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? a.constructor.name);
            return { name, target: `${el?.tagName.toLowerCase() ?? '?'}.${el ? [...el.classList].join('.') : ''}` };
          }),
      );
      const known = IDLE_KNOWN[where];
      for (const r of running.filter((r) => known.includes(r.name))) {
        test.info().annotations.push({ type: 'known idle loop', description: `${r.name} on ${r.target}` });
      }
      const unexpected = running.filter((r) => !known.includes(r.name)).map((r) => `${r.name} on ${r.target}`);
      expect(unexpected, 'animations still running after 60 s idle').toEqual([]);
      const gone = known.filter((k) => !running.some((r) => r.name === k));
      expect(gone, 'these loops now stop at idle: remove them from IDLE_KNOWN').toEqual([]);
    });
  }
});
