<script lang="ts">
  // Settings → Editor: editing mode, split preview, fonts, widths.
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import { FONT_SIZE_MIN, FONT_SIZE_MAX, TAB_SIZES, type EditorSettings, type ReadingWidth } from '../../lib/editor-settings.ts';
  import { effectiveSettings } from '../../lib/vim-config.ts';
  import { keyLabel } from '../../lib/platform.ts';
  import OverriddenBadge from './OverriddenBadge.svelte';
  import { num, checked, type ShowRow } from './form.ts';

  const { show }: { show: ShowRow } = $props();
  const s = $derived(editorSettings.value);
  const eff = $derived(effectiveSettings(s));
  const over = (k: keyof EditorSettings) => eff.overridden.includes(k);
</script>

<section class="group" aria-labelledby="sec-editor">
  <h2 id="sec-editor">Editor</h2>
  {#if show('editMode')}
    <div class="row">
      <div class="row-text"><span class="row-title">Editing mode</span><span class="row-desc">Live Preview hides markdown syntax off the cursor line; Source shows it raw. <kbd>{keyLabel('⌘⇧E')}</kbd></span></div>
      <div class="ui-seg">
        <button type="button" aria-pressed={s.editMode === 'live'} onclick={() => editorSettings.update({ editMode: 'live' })}>Live Preview</button>
        <button type="button" aria-pressed={s.editMode === 'source'} onclick={() => editorSettings.update({ editMode: 'source' })}>Source</button>
      </div>
    </div>
  {/if}
  {#if show('previewSplit')}
    <label class="row">
      <div class="row-text"><span class="row-title">Show preview beside source</span><span class="row-desc">In Source mode, the rendered note sits to the right and scrolls with the editor. Toggle with <kbd>{'\\'}p</kbd>, <kbd>{keyLabel('⌘⌥P')}</kbd> or <kbd>:preview split</kbd>.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.previewSplit} onchange={(e) => editorSettings.update({ previewSplit: checked(e) })} data-testid="preview-split-toggle" />
    </label>
  {/if}
  {#if show('openIn')}
    <div class="row">
      <div class="row-text"><span class="row-title">Opening a note shows</span><span class="row-desc">What <kbd>⏎</kbd> on a note opens.</span></div>
      <div class="ui-seg">
        <button type="button" aria-pressed={s.openIn === 'reading'} onclick={() => editorSettings.update({ openIn: 'reading' })}>Reading</button>
        <button type="button" aria-pressed={s.openIn === 'editing'} onclick={() => editorSettings.update({ openIn: 'editing' })}>Editor</button>
      </div>
    </div>
  {/if}
  {#if show('prose')}
    <div class="row">
      <div class="row-text"><span class="row-title">Prose font</span><span class="row-desc">Typeface for reading and Live Preview. Source mode is always monospace.</span></div>
      <div class="ui-seg">
        <button type="button" aria-pressed={s.proseFont === 'sans'} onclick={() => editorSettings.update({ proseFont: 'sans' })} style="font-family: var(--font-sans)">Sans</button>
        <button type="button" aria-pressed={s.proseFont === 'serif'} onclick={() => editorSettings.update({ proseFont: 'serif' })} style="font-family: var(--font-serif)">Serif</button>
        <button type="button" aria-pressed={s.proseFont === 'mono'} onclick={() => editorSettings.update({ proseFont: 'mono' })} style="font-family: var(--font-mono)">Mono</button>
      </div>
    </div>
  {/if}
  {#if show('readingWidth')}
    <div class="row">
      <div class="row-text"><span class="row-title">Largura de leitura</span><span class="row-desc">Text column of the reader, Live Preview and split preview. Total fills the pane.</span></div>
      <div class="ui-seg" data-testid="reading-width">
        {#each [['narrow', 'Estreita'], ['medium', 'Média'], ['wide', 'Larga'], ['full', 'Total']] as [v, label] (v)}
          <button type="button" aria-pressed={s.readingWidth === v} onclick={() => editorSettings.update({ readingWidth: v as ReadingWidth })}>{label}</button>
        {/each}
      </div>
    </div>
  {/if}
  {#if show('density')}
    <div class="row">
      <div class="row-text"><span class="row-title">Densidade</span><span class="row-desc">Row height in the explorer and lists.</span></div>
      <div class="ui-seg" data-testid="density">
        <button type="button" aria-pressed={s.density === 'comfortable'} onclick={() => editorSettings.update({ density: 'comfortable' })}>Confortável</button>
        <button type="button" aria-pressed={s.density === 'compact'} onclick={() => editorSettings.update({ density: 'compact' })}>Compacto</button>
      </div>
    </div>
  {/if}
  {#if show('fontSize')}
    <div class="row">
      <div class="row-text"><span class="row-title">Font size</span><span class="row-desc">Editor text size.</span></div>
      <div class="range">
        <input id="es-font" type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1" value={s.fontSize}
          aria-label="Font size" oninput={(e) => editorSettings.update({ fontSize: num(e) })} />
        <span class="value">{s.fontSize}px</span>
      </div>
    </div>
  {/if}
  {#if show('readable')}
    <label class="row">
      <div class="row-text"><span class="row-title">Readable line length</span><span class="row-desc">Keep the text column around 70 characters wide.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.readableWidth} onchange={(e) => editorSettings.update({ readableWidth: checked(e) })} />
    </label>
  {/if}
  {#if show('wrap')}
    <label class="row">
      <div class="row-text"><span class="row-title">Wrap long lines <OverriddenBadge k="lineWrapping" /></span></div>
      <input type="checkbox" class="ui-switch" checked={eff.lineWrapping} disabled={over('lineWrapping')} onchange={(e) => editorSettings.update({ lineWrapping: checked(e) })} />
    </label>
  {/if}
  {#if show('gutter')}
    <label class="row">
      <div class="row-text"><span class="row-title">Line numbers <OverriddenBadge k="lineNumbers" /></span></div>
      <input type="checkbox" class="ui-switch" checked={eff.lineNumbers} disabled={over('lineNumbers')} onchange={(e) => editorSettings.update({ lineNumbers: checked(e) })} />
    </label>
    <label class="row">
      <div class="row-text"><span class="row-title">Relative line numbers <OverriddenBadge k="relativeLineNumbers" /></span><span class="row-desc">Distance from the cursor line, for <kbd>5j</kbd>-style motions.</span></div>
      <input type="checkbox" class="ui-switch" checked={eff.relativeLineNumbers} disabled={over('relativeLineNumbers')} onchange={(e) => editorSettings.update({ relativeLineNumbers: checked(e) })} />
    </label>
  {/if}
  {#if show('tabSize')}
    <div class="row">
      <div class="row-text"><span class="row-title">Tab size <OverriddenBadge k="tabSize" /></span><span class="row-desc">{over('tabSize') ? `tabstop=${eff.tabSize}, shiftwidth=${eff.indentWidth}` : 'Spaces per indent level.'}</span></div>
      <div class="ui-seg">
        {#each TAB_SIZES as n (n)}
          <button type="button" disabled={over('tabSize')} aria-pressed={eff.tabSize === n} onclick={() => editorSettings.update({ tabSize: n })}>{n}</button>
        {/each}
      </div>
    </div>
  {/if}
</section>
