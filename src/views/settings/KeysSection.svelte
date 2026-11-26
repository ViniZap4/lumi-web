<script lang="ts">
  // Settings → Keys: pane navigation, preview and hover toggles, and the
  // keymap reference.
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import { keymapFor } from '../../lib/keymap-help.ts';
  import { checked, type ShowRow } from './form.ts';

  const { show }: { show: ShowRow } = $props();
  const s = $derived(editorSettings.value);
  const KEYMAP = keymapFor();
</script>

<section class="group" aria-labelledby="sec-keys">
  <h2 id="sec-keys">Keys</h2>
  {#if show('keysLegend')}
    <label class="row">
      <div class="row-text"><span class="row-title">Show the command legend</span><span class="row-desc">Press <kbd>?</kbd> anywhere for the full map. Settings open with <kbd>,</kbd> outside text fields, <kbd>:settings</kbd> in the editor, or the command palette.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.legend} onchange={(e) => editorSettings.update({ legend: checked(e) })} />
    </label>
  {/if}
  {#if show('paneNav')}
    <label class="row">
      <div class="row-text"><span class="row-title">Ctrl-h/j/k/l moves between panes</span><span class="row-desc">Note panes, the editor and the split preview, like vim windows or vim-tmux-navigator. In the editor only in Normal/Visual; Insert keeps <kbd>Ctrl-h</kbd> backspace and <kbd>Ctrl-j</kbd> newline. <kbd>Ctrl-w h/j/k/l/w/p</kbd> always work, and your .vimrc maps of these keys win.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.paneNav} onchange={(e) => editorSettings.update({ paneNav: checked(e) })} data-testid="pane-nav-toggle" />
    </label>
  {/if}
  {#if show('previewCursor')}
    <label class="row">
      <div class="row-text"><span class="row-title">Returning from the preview moves the cursor</span><span class="row-desc">Leaving the split preview by keyboard (<kbd>q</kbd>, <kbd>Esc</kbd>, <kbd>Ctrl-h</kbd>) puts the editor cursor on the source line at the top of the preview.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.previewCursorSync} onchange={(e) => editorSettings.update({ previewCursorSync: checked(e) })} data-testid="preview-cursor-toggle" />
    </label>
  {/if}
  {#if show('hoverPreview')}
    <label class="row">
      <div class="row-text"><span class="row-title">Preview links on hover</span><span class="row-desc">Resting the pointer on a note link for a moment shows a card with the start of the note. <kbd>K</kbd> on a link opens the same card from the keyboard; external links only show their address (nothing is fetched).</span></div>
      <input type="checkbox" class="ui-switch" checked={s.hoverPreview} onchange={(e) => editorSettings.update({ hoverPreview: checked(e) })} data-testid="hover-preview-toggle" />
    </label>
  {/if}
  {#if show('keymap')}
    <div class="keymap">
      {#each KEYMAP as sec (sec.title)}
        <div class="km-sec">
          <h3 class="ui-eyebrow">{sec.title}</h3>
          <dl>
            {#each sec.rows as [k, label] (k)}
              <dt class="mono">{k}</dt>
              <dd>{label}</dd>
            {/each}
          </dl>
        </div>
      {/each}
    </div>
  {/if}
</section>
