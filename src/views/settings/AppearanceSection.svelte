<script lang="ts">
  // Settings → Appearance: theme mode and palettes, legend, motion.
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import type { MotionSetting } from '../../lib/editor-settings.ts';
  import { theme } from '../../lib/theme.svelte.ts';
  import { themes, themeOrder } from '../../lib/themes.ts';
  import type { ThemeMode } from '../../lib/types.ts';
  import { checked, type ShowRow } from './form.ts';

  const { show }: { show: ShowRow } = $props();
  const s = $derived(editorSettings.value);

  const darkThemes = themeOrder.filter((n) => themes[n].isDark);
  const lightThemes = themeOrder.filter((n) => !themes[n].isDark);
  const MODES: ThemeMode[] = ['auto', 'dark', 'light'];
</script>

<section class="group" aria-labelledby="sec-appearance">
  <h2 id="sec-appearance">Appearance</h2>
  {#if show('themeMode')}
    <div class="row">
      <div class="row-text"><span class="row-title">Theme</span><span class="row-desc">Auto follows the system light/dark setting.</span></div>
      <div class="ui-seg">
        {#each MODES as m (m)}
          <button type="button" aria-pressed={theme.settings.mode === m} onclick={() => theme.setMode(m)}>{m}</button>
        {/each}
      </div>
    </div>
  {/if}
  {#if show('themes')}
    {#each [{ label: 'Dark theme', list: darkThemes, cur: theme.settings.darkName, set: (n: string) => theme.setDarkName(n) }, { label: 'Light theme', list: lightThemes, cur: theme.settings.lightName, set: (n: string) => theme.setLightName(n) }] as grp (grp.label)}
      <div class="row stack">
        <div class="row-text"><span class="row-title">{grp.label}</span></div>
        <div class="swatches">
          {#each grp.list as name (name)}
            {@const th = themes[name]}
            <button type="button" class="swatch" class:on={grp.cur === name} aria-pressed={grp.cur === name} onclick={() => grp.set(name)}
              style="--sw-bg: {th.background}; --sw-fg: {th.text}; --sw-a: {th.primary}; --sw-b: {th.secondary}; --sw-c: {th.accent}; --sw-line: {th.border}">
              <span class="sw-preview"><span class="sw-bar"></span><span class="sw-bar short"></span><span class="sw-dots"><i></i><i></i><i></i></span></span>
              <span class="sw-name">{name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
  {#if show('legend')}
    <label class="row">
      <div class="row-text"><span class="row-title">Command legend</span><span class="row-desc">A one-line strip above the status bar with the keys for what you are doing now (explorer, reader, vim normal/insert/visual), and completions after <kbd>g</kbd>, <kbd>z</kbd> or the leader.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.legend} onchange={(e) => editorSettings.update({ legend: checked(e) })} data-testid="legend-toggle" />
    </label>
  {/if}
  {#if show('motion')}
    <div class="row">
      <div class="row-text"><span class="row-title">Movimento</span><span class="row-desc">Completo: every response moves with real springs. Suave: the same choreography with less travel and no overshoot. Reduzido: changes are instant (always, when your system asks for reduced motion).</span></div>
      <div class="ui-seg" data-testid="motion-level">
        {#each [['full', 'Completo'], ['soft', 'Suave'], ['reduced', 'Reduzido']] as [v, label] (v)}
          <button type="button" aria-pressed={s.motion === v} onclick={() => editorSettings.update({ motion: v as MotionSetting })}>{label}</button>
        {/each}
      </div>
    </div>
  {/if}
</section>
