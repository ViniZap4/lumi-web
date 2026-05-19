<script lang="ts">
  // ThemePickerModal — opens off uiState.themePickerOpen. Three
  // sections: mode (dark/light/auto), the dark-theme list, and the
  // light-theme list. Clicking a row calls into the ThemeStore which
  // persists + applies immediately, so selection feels modeless (no
  // separate save step). Escape closes; click on the overlay closes;
  // the close button does the same.
  //
  // Why we render BOTH lists regardless of mode: mode=auto follows
  // the OS, so users routinely want to set both halves at once. Dim
  // the inactive list so it's clear which one applies right now.

  import { onMount, onDestroy } from 'svelte';
  import { themes, themeOrder, type Theme } from '../lib/themes.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import type { ThemeMode } from '../lib/types.ts';

  const darkThemes = themeOrder.filter((n) => themes[n].isDark);
  const lightThemes = themeOrder.filter((n) => !themes[n].isDark);

  const MODES: ThemeMode[] = ['dark', 'light', 'auto'];

  function close(): void {
    uiState.closeThemePicker();
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
  });

  // The "currently active" theme — used to mark the right row in the
  // list with a check. When mode=auto we look at the resolved active
  // theme; otherwise it's whichever name is set for the chosen mode.
  let activeName = $derived(theme.active.name);

  // Whether each list is "live" — i.e. its selection actually affects
  // the screen right now. dim the other one to communicate that.
  let darkLive = $derived(
    theme.settings.mode === 'dark' ||
      (theme.settings.mode === 'auto' && theme.active.isDark),
  );
  let lightLive = $derived(
    theme.settings.mode === 'light' ||
      (theme.settings.mode === 'auto' && !theme.active.isDark),
  );

  function pickMode(m: ThemeMode): void {
    theme.setMode(m);
  }

  function pickDark(name: string): void {
    theme.setDarkName(name);
  }

  function pickLight(name: string): void {
    theme.setLightName(name);
  }
</script>

<div
  class="overlay"
  role="presentation"
  onclick={close}
  onkeydown={(e) => {
    if (e.key === 'Escape') close();
  }}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Theme picker"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <header class="panel-head">
      <h2>Themes</h2>
      <button class="close" type="button" aria-label="Close" onclick={close}>×</button>
    </header>

    <section class="row">
      <h3>Mode</h3>
      <div class="mode-row">
        {#each MODES as m (m)}
          <button
            type="button"
            class="mode-btn"
            class:active={theme.settings.mode === m}
            onclick={() => pickMode(m)}
            aria-pressed={theme.settings.mode === m}
          >
            {m === 'auto' ? 'Auto (system)' : m === 'dark' ? 'Dark' : 'Light'}
          </button>
        {/each}
      </div>
    </section>

    <section class="row" class:dim={!darkLive}>
      <h3>
        Dark theme
        {#if !darkLive}<span class="hint">— not active in current mode</span>{/if}
      </h3>
      <ul class="theme-list" role="listbox" aria-label="Dark themes">
        {#each darkThemes as name (name)}
          {@const t = themes[name]}
          <li>
            <button
              type="button"
              class="theme-row"
              class:active={theme.settings.darkName === name}
              class:current={darkLive && activeName === name}
              onclick={() => pickDark(name)}
              role="option"
              aria-selected={theme.settings.darkName === name}
            >
              <span class="theme-name">{name}</span>
              <span class="swatches" aria-hidden="true">
                {#each swatchColors(t) as color, i (i)}
                  <span class="swatch" style="background: {color}"></span>
                {/each}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>

    <section class="row" class:dim={!lightLive}>
      <h3>
        Light theme
        {#if !lightLive}<span class="hint">— not active in current mode</span>{/if}
      </h3>
      <ul class="theme-list" role="listbox" aria-label="Light themes">
        {#each lightThemes as name (name)}
          {@const t = themes[name]}
          <li>
            <button
              type="button"
              class="theme-row"
              class:active={theme.settings.lightName === name}
              class:current={lightLive && activeName === name}
              onclick={() => pickLight(name)}
              role="option"
              aria-selected={theme.settings.lightName === name}
            >
              <span class="theme-name">{name}</span>
              <span class="swatches" aria-hidden="true">
                {#each swatchColors(t) as color, i (i)}
                  <span class="swatch" style="background: {color}"></span>
                {/each}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>

    <footer class="panel-foot">
      <span class="hint"><kbd>Esc</kbd> closes — changes apply instantly</span>
    </footer>
  </div>
</div>

<script lang="ts" module>
  // Five-swatch preview per theme. Picked to span the palette without
  // showing redundant near-duplicates — primary/secondary/accent are
  // the personality, background/text fix the contrast feel.
  import type { Theme as ThemeT } from '../lib/themes.ts';
  export function swatchColors(t: ThemeT): string[] {
    return [t.primary, t.secondary, t.accent, t.background, t.text];
  }
</script>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }
  .panel {
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 8px;
    width: min(560px, 100%);
    max-height: 88vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    position: sticky;
    top: 0;
    background: var(--color-background);
    z-index: 1;
  }
  .panel-head h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .close {
    background: transparent;
    border: none;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.4rem;
  }
  .close:hover {
    color: var(--color-text);
  }

  .row {
    padding: 0.75rem 1.1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }
  .row:last-of-type {
    border-bottom: none;
  }
  .row h3 {
    margin: 0 0 0.55rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-dim, var(--color-muted));
    font-weight: 600;
  }
  .row.dim {
    opacity: 0.6;
  }
  .row.dim h3 {
    color: var(--color-text-dim, var(--color-muted));
  }
  .hint {
    font-size: 0.7rem;
    color: var(--color-text-dim, var(--color-muted));
    text-transform: none;
    letter-spacing: 0;
    margin-left: 0.3rem;
    font-weight: 400;
  }

  .mode-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .mode-btn {
    padding: 0.4rem 0.9rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 999px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    transition: border-color 80ms ease, background 80ms ease;
  }
  .mode-btn:hover {
    border-color: var(--color-primary);
  }
  .mode-btn.active {
    border-color: var(--color-primary);
    background: var(--color-selected-bg, var(--color-overlay-bg));
    color: var(--color-primary);
  }

  .theme-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .theme-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.7rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.88rem;
    cursor: pointer;
    transition: border-color 80ms ease;
  }
  .theme-row:hover {
    border-color: var(--color-secondary);
  }
  .theme-row.active {
    border-color: var(--color-primary);
  }
  .theme-row.current::before {
    content: '✓';
    color: var(--color-primary);
    margin-right: 0.4rem;
  }
  .theme-name {
    flex: 1;
    text-align: left;
  }
  .swatches {
    display: inline-flex;
    gap: 0.18rem;
  }
  .swatch {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    border: 1px solid var(--color-separator, var(--color-border));
    display: inline-block;
  }

  .panel-foot {
    padding: 0.6rem 1.1rem 0.85rem;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.78rem;
    text-align: center;
  }
  kbd {
    background: var(--color-selected-bg, var(--color-overlay-bg));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 3px;
    padding: 0.05rem 0.35rem;
    font-family: inherit;
    font-size: 0.76rem;
    color: var(--color-secondary);
  }
</style>
