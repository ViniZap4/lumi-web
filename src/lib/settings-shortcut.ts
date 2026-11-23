// ⌘, (macOS) / Ctrl+, (Windows, Linux) toggles Settings from anywhere:
// the explorer, the reader, inside CodeMirror (vim normal or insert
// mode) and inside modals. The listener sits on `window` in the
// CAPTURE phase, so it runs before CodeMirror, vim and any modal's own
// keydown handler (several stop propagation), and it stops the event
// there so nothing else also acts on it. preventDefault suppresses the
// browser's own binding where the browser lets pages do that (see the
// caveats in the settings view: Safari keeps ⌘, for its preferences).

import { isSettingsShortcut, MAC } from './platform.ts';

export interface SettingsShortcutDeps {
  /** Toggle settings (open on the context's section, or close). */
  toggle: () => void;
  /** False while the shortcut must not act (e.g. signed out). */
  enabled?: () => boolean;
  mac?: boolean;
}

export function installSettingsShortcut(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, deps: SettingsShortcutDeps): () => void {
  const mac = deps.mac ?? MAC;
  const onKey = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.repeat || !isSettingsShortcut(k, mac)) return;
    if (deps.enabled && !deps.enabled()) return;
    k.preventDefault();
    k.stopImmediatePropagation();
    deps.toggle();
  };
  target.addEventListener('keydown', onKey, { capture: true });
  return () => target.removeEventListener('keydown', onKey, { capture: true });
}
