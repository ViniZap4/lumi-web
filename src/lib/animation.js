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

/**
 * Calculate the max rune width across all logo lines.
 */
export function logoMaxRunes(logoLines) {
  let max = 0;
  for (const line of logoLines) {
    const len = [...line].length;
    if (len > max) max = len;
  }
  return max;
}

/**
 * Calculate the total stagger offset (last line's offset).
 */
export function logoStagger(logoLines) {
  return (logoLines.length - 1) * LINE_STAGGER;
}

/**
 * Total columns needed to fully reveal the logo.
 */
export function totalColumns(logoLines) {
  return logoMaxRunes(logoLines) + logoStagger(logoLines);
}

/**
 * For a given line index and current animProgress,
 * return how many runes (chars) should be visible.
 */
export function visibleRunes(lineIndex, animProgress) {
  return animProgress - lineIndex * LINE_STAGGER;
}

/**
 * Start the diagonal wipe animation.
 * Calls onTick(animProgress) each frame and onDone() when complete.
 * Returns a cleanup function that stops the animation.
 */
export function startAnimation(logoLines, onTick, onDone) {
  const total = totalColumns(logoLines);
  let progress = 0;
  let lastTime = 0;
  let rafId = null;

  function tick(timestamp) {
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
