// Toast stack (SPEC-PARTE2 §1, "toasts sliding and stacking"): short
// status messages that slide in from the bottom and stack, newest at
// the bottom, at most MAX_TOASTS (the oldest leaves first). Each one
// dismisses itself; a repeat of the visible newest text just renews it.

export type ToastTone = 'info' | 'warn' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

export const MAX_TOASTS = 3;

/** Default lifetime per tone (ms). */
export const TOAST_MS: Record<ToastTone, number> = { info: 3500, warn: 4500, error: 6000 };

class Toasts {
  list = $state<Toast[]>([]);
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private seq = 1;

  push(text: string, tone: ToastTone = 'info', ms: number = TOAST_MS[tone]): number {
    const last = this.list[this.list.length - 1];
    if (last && last.text === text && last.tone === tone) {
      this.arm(last.id, ms);
      return last.id;
    }
    const t: Toast = { id: this.seq++, text, tone };
    let next = [...this.list, t];
    while (next.length > MAX_TOASTS) {
      this.clearTimer(next[0].id);
      next = next.slice(1);
    }
    this.list = next;
    this.arm(t.id, ms);
    return t.id;
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this.list = this.list.filter((t) => t.id !== id);
  }

  clear(): void {
    for (const id of this.timers.keys()) this.clearTimer(id);
    this.list = [];
  }

  private arm(id: number, ms: number): void {
    this.clearTimer(id);
    if (ms > 0) this.timers.set(id, setTimeout(() => this.dismiss(id), ms));
  }

  private clearTimer(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }
}

export const toasts = new Toasts();
