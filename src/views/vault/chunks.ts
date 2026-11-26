// The book shell's lazy chunks. They are kept out of the boot chunk
// (markdown rendering, mini canvases / boards, the hover card) and
// preloaded once the browser is idle after the first paint, so opening
// a note or the explorer's preview rarely waits on the network.

export const loadPrimaryNote = () => import('./PrimaryNote.svelte');
export const loadNotePane = () => import('../../components/NotePane.svelte');
export const loadHoverCard = () => import('../../components/HoverCard.svelte');
export const loadFxNotePreview = () => import('../../components/explorer/FxNotePreview.svelte');

export function preloadBookChunks(): void {
  void Promise.all([loadPrimaryNote(), loadFxNotePreview(), loadHoverCard()]).catch(() => {
    /* offline or a deploy in between: they load on first use */
  });
}
