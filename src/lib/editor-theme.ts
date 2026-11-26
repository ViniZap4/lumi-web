// Editor chrome. Colours are theme tokens (see app.css for the Live
// Preview prose styles); layout keeps the text in a centred writing
// column with the gutter hugging it, while the scrollbar stays at
// the pane edge.
const mono = 'var(--font-mono)';
export const EDITOR_THEME = {
  '&': {
    height: '100%',
    fontFamily: 'var(--editor-font, var(--prose-font))',
    background: 'transparent',
    color: 'var(--color-text)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--editor-leading, var(--prose-leading))',
    padding: '0 var(--editor-pad-x, 24px)',
    overscrollBehavior: 'contain',
  },
  // Centre content (and the gutter beside it): the free space goes
  // to the gutter's left margin and the content's right margin.
  '.cm-content': {
    maxWidth: 'var(--editor-measure, none)',
    marginInline: 'auto',
    padding: 'var(--editor-pad-top, 40px) 0 40vh',
    caretColor: 'var(--color-primary)',
  },
  '.cm-gutters ~ .cm-content': { marginLeft: '0' },
  '.cm-line': { padding: '0 1px' },
  '.cm-gutters': {
    marginLeft: 'auto',
    paddingTop: 'var(--editor-pad-top, 40px)',
    background: 'transparent',
    color: 'var(--md-marker)',
    border: 'none',
    fontFamily: mono,
    fontSize: '0.74em',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '28px', opacity: '0.75' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text)' },
  '.cm-lineNumbers .cm-activeLineGutter': { opacity: '1' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 6px 0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-fold-marker': { display: 'inline-flex', color: 'var(--md-marker)', opacity: '0', cursor: 'pointer', transition: 'opacity 120ms, transform 120ms' },
  '.cm-fold-marker[data-open="true"]': { transform: 'rotate(90deg)' },
  '.cm-fold-marker[data-open="false"]': { opacity: '1', color: 'var(--color-primary)' },
  '.cm-gutters:hover .cm-fold-marker': { opacity: '1' },
  '.cm-foldPlaceholder': {
    margin: '0 0.35em',
    padding: '0 0.5em',
    border: '1px solid var(--md-rule)',
    borderRadius: '999px',
    background: 'var(--md-inline-bg)',
    color: 'var(--md-dim)',
    fontFamily: mono,
    fontSize: '0.8em',
    cursor: 'pointer',
  },
  // Translucent bands only, so the selection layer (drawn beneath the
  // text) is never covered.
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-text) 3.5%, transparent)', borderRadius: '3px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--color-primary)' },
  '.cm-fat-cursor': { background: 'color-mix(in srgb, var(--color-primary) 80%, transparent) !important', color: 'var(--color-background) !important', borderRadius: '1px' },
  '&:not(.cm-focused) .cm-fat-cursor': { background: 'none !important', outline: '1px solid var(--color-primary) !important' },
  '.cm-selectionLayer .cm-selectionBackground': { background: 'var(--editor-selection-blur) !important' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: 'var(--editor-selection) !important' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-warning) 26%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--color-warning) 55%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected, .cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 34%, transparent)', outlineColor: 'var(--color-primary)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', outline: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-error) 22%, transparent)' },
  '.cm-yank-flash': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 38%, transparent)',
    borderRadius: '2px',
    animation: 'cm-yank-fade 220ms ease-out forwards',
  },
  '@keyframes cm-yank-fade': {
    from: { backgroundColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)' },
    to: { backgroundColor: 'color-mix(in srgb, var(--color-accent) 0%, transparent)' },
  },
  // Collaborators (y-codemirror): a 2px caret in their colour with a
  // glowing head; the name tag shows while they move/type and fades
  // after ~2.5 s idle, the caret dims when idle (app.css keyframes —
  // every move re-creates the widget, restarting both). Hover any
  // caret to see the name again.
  '.cm-ySelection': { borderRadius: '2px', mixBlendMode: 'normal' },
  '.cm-ySelectionCaret': {
    borderLeftWidth: '2px',
    borderRightWidth: '0',
    marginRight: '0',
    animation: 'peer-caret-in var(--spring-glide-ms) var(--spring-glide) both, peer-caret-idle 12s linear forwards',
    // A box, so the glide (a transform, lib/remote-caret-glide.ts) applies.
    display: 'inline-block',
  },
  // Gliding from its previous spot: no re-grow on arrival (that is for
  // a caret that appears); the name tag still pops.
  '.cm-ySelectionCaret.cm-ySelectionCaret-glide': { animation: 'peer-caret-idle 12s linear forwards' },
  '.cm-ySelectionCaretDot': {
    width: '6px',
    height: '6px',
    top: '-4px',
    left: '-4px',
    boxShadow: '0 0 0 2px var(--color-background)',
  },
  '.cm-ySelectionInfo': {
    fontFamily: 'var(--font-sans)',
    fontSize: '10.5px',
    fontWeight: '650',
    letterSpacing: '0.01em',
    lineHeight: '1.5',
    padding: '1px 6px',
    borderRadius: '5px 5px 5px 1px',
    top: '-1.55em',
    left: '-2px',
    // Dark ink on the collaborator's (always mid/light) colour: legible
    // in light and dark themes alike.
    color: 'rgb(14 16 26)',
    boxShadow: '0 2px 8px -2px rgb(0 0 0 / 0.35)',
    opacity: '1',
    transformOrigin: 'bottom left',
    animation: 'peer-label-in var(--spring-bouncy-ms) var(--spring-bouncy) both, peer-label 3.2s linear 0.4s forwards',
  },
  '.cm-ySelectionCaret:hover > .cm-ySelectionInfo': { opacity: '1', animation: 'none' },
  '.cm-panels': {
    background: 'color-mix(in srgb, var(--color-overlay-bg) 70%, var(--color-background))',
    color: 'var(--color-text)',
    fontFamily: mono,
    fontSize: '13px',
  },
  '.cm-panels-bottom': { borderTop: '1px solid var(--hairline)' },
  '.cm-vim-panel': { padding: '0 var(--editor-pad-x, 24px)', minHeight: '30px', alignItems: 'center' },
  '.cm-vim-panel input': { color: 'var(--color-text)', background: 'transparent', font: 'inherit' },
  '.cm-tooltip': {
    background: 'var(--color-background)',
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-pop)',
    overflow: 'hidden',
  },
};
