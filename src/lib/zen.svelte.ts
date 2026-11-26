// Modo zen (PHASE3-PROPOSAL §7): the book shell with no chrome at all —
// no top bar, note bar, legend or status line. Pointing at the top-left
// hot corner reveals the top bar (the web's corner dock) with a soft
// dissolve; leaving it hides the bar again after HIDE_DELAY_MS.
//
// This module owns the state and nothing else. It reflects it as two
// attributes on <html> that the CSS in ZenCorner.svelte keys off:
//   data-zen         zen is on
//   data-zen-reveal  the chrome is revealed (pointer in the corner)
// so the shell needs no per-element wiring.
//
// Rules (all clients):
// - Only the pointer reveals. Typing never does; the controller has no
//   keyboard input at all.
// - Toggling zen off always clears the reveal.
// - The setting persists per device (localStorage, every access in
//   try/catch: private windows and blocked storage just do not persist).

/** Top-left hot corner, CSS px (same 72×40 pt region as the Mac). */
export const HOT_CORNER = { w: 72, h: 40 } as const;
/** How long the revealed chrome lingers after the pointer leaves. */
export const HIDE_DELAY_MS = 600;
export const ZEN_STORAGE_KEY = 'lumi.v2.zen';

export interface ZenStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface ZenDeps {
  storage?: ZenStorage | null;
  /** Element the attributes go on (default: <html>). null = none. */
  root?: HTMLElement | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

function defaultStorage(): ZenStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Pure: is (x, y) inside the hot corner? */
export function inHotCorner(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= HOT_CORNER.w && y <= HOT_CORNER.h;
}

export class ZenController {
  on = $state(false);
  revealed = $state(false);

  private readonly storage: ZenStorage | null;
  private readonly root: HTMLElement | null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private hideTimer: unknown = null;

  constructor(deps: ZenDeps = {}) {
    this.storage = deps.storage === undefined ? defaultStorage() : deps.storage;
    this.root = deps.root === undefined ? (typeof document !== 'undefined' ? document.documentElement : null) : deps.root;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    let stored = false;
    try {
      stored = this.storage?.getItem(ZEN_STORAGE_KEY) === '1';
    } catch {
      stored = false;
    }
    this.on = stored;
    this.reflect();
  }

  toggle(): void {
    this.set(!this.on);
  }

  set(on: boolean): void {
    this.cancelHide();
    this.on = on;
    this.revealed = false;
    try {
      if (on) this.storage?.setItem(ZEN_STORAGE_KEY, '1');
      else this.storage?.removeItem(ZEN_STORAGE_KEY);
    } catch {
      /* not persisted; still applies for this page */
    }
    this.reflect();
  }

  /** The pointer moved. `inside` = in the hot corner, or over the
   *  revealed chrome (so moving from the corner onto the bar keeps it). */
  pointer(inside: boolean): void {
    if (!this.on) return;
    if (inside) {
      this.cancelHide();
      if (!this.revealed) {
        this.revealed = true;
        this.reflect();
      }
      return;
    }
    if (this.revealed && this.hideTimer == null) {
      this.hideTimer = this.setTimer(() => {
        this.hideTimer = null;
        this.revealed = false;
        this.reflect();
      }, HIDE_DELAY_MS);
    }
  }

  /** The pointer left the window: same as leaving the corner. */
  pointerLeftWindow(): void {
    this.pointer(false);
  }

  private cancelHide(): void {
    if (this.hideTimer != null) {
      this.clearTimer(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private reflect(): void {
    const r = this.root;
    if (!r) return;
    if (this.on) r.dataset.zen = '';
    else delete r.dataset.zen;
    if (this.on && this.revealed) r.dataset.zenReveal = '';
    else delete r.dataset.zenReveal;
  }
}

export const zen = new ZenController();
