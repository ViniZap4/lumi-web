// Device storage facts for Settings → Offline & storage.

export class DeviceStorage {
  usage = $state<{ used: number; quota: number } | null>(null);
  persisted = $state<boolean | null>(null);

  async load(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) this.usage = { used: est.usage ?? 0, quota: est.quota ?? 0 };
      this.persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      this.usage = null;
    }
  }

  async requestPersist(): Promise<void> {
    try {
      this.persisted = (await navigator.storage?.persist?.()) ?? this.persisted;
    } catch {
      // ignore
    }
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
