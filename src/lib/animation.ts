/**
 * Diagonal wipe animation matching TUI's view_home.go logic.
 *
 * - 60ms tick interval, 5 rune columns per tick
 * - Each logo line staggered by 2 columns (line i starts at column i * 2)
 * - Total columns = maxRunes + stagger
 */

const TICK_MS = 60;
const RUNES_PER_TICK = 5;
const LINE_STAGGER = 2;

export function logoMaxRunes(logoLines: string[]): number {
  let max = 0;
  for (const line of logoLines) {
    const len = [...line].length;
    if (len > max) max = len;
  }
  return max;
}

export function logoStagger(logoLines: string[]): number {
  return (logoLines.length - 1) * LINE_STAGGER;
}

export function totalColumns(logoLines: string[]): number {
  return logoMaxRunes(logoLines) + logoStagger(logoLines);
}

export function visibleRunes(lineIndex: number, animProgress: number): number {
  return animProgress - lineIndex * LINE_STAGGER;
}

export function startAnimation(
  logoLines: string[],
  onTick: (animProgress: number) => void,
  onDone: () => void,
): () => void {
  const total = totalColumns(logoLines);
  let progress = 0;
  let lastTime = 0;
  let rafId: number | null = null;

  function tick(timestamp: number): void {
    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;

    if (elapsed >= TICK_MS) {
      const ticks = Math.floor(elapsed / TICK_MS);
      progress += ticks * RUNES_PER_TICK;
      lastTime = timestamp - (elapsed % TICK_MS);

      if (progress >= total) {
        progress = total;
        onTick(progress);
        onDone();
        return;
      }

      onTick(progress);
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
  };
}
