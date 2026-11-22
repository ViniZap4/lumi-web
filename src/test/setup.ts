// Global test setup.
//
// Node >= 25 ships an experimental global `localStorage` (backed by
// `--localstorage-file`). Without that flag the getter yields an
// object with no methods, and because it is defined on globalThis it
// shadows the Storage that vitest's jsdom environment would install —
// so `localStorage.clear()` throws in jsdom suites. Replace both
// storages with a small in-memory Storage implementation so tests are
// deterministic on every Node version.

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
}
