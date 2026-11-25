// M3 public publishing (docs/SPEC-ESPELHO-SELADO.md): consent copy and
// scope helpers for the mirror invite, and the per-note flag.

export type PublishScopeChoice = 'flagged' | 'all' | 'folder';

/** Wire scope, or null when "folder" has no usable prefix. */
export function publishScope(choice: PublishScopeChoice, folder: string): string | null {
  if (choice !== 'folder') return choice;
  const f = folder.trim().replace(/^\/+/, '');
  if (!f || f.includes('..')) return null;
  return `folder:${f.endsWith('/') ? f : f + '/'}`;
}

/** The consent the owner must accept before a publishing invite. */
export function publishConsentText(scope: string, index: boolean): string {
  const what =
    scope === 'all'
      ? 'TODAS as notas deste livro, inclusive as que você criar depois,'
      : scope.startsWith('folder:')
        ? `todas as notas da pasta “${scope.slice(7)}”, inclusive as que você criar depois,`
        : 'as notas que você marcar com “Publicar”';
  return (
    `O servidor espelho poderá mostrar ${what} para qualquer pessoa na internet, sem login e sem identificar quem lê (leitura anônima). ` +
    'O conteúdo publicado deixa de ser privado: qualquer um pode copiá-lo, e revogar depois não apaga cópias que outros já fizeram. ' +
    (index ? 'Buscadores (Google etc.) poderão indexar as páginas.' : 'As páginas pedem aos buscadores que não as indexem.')
  );
}

/** Whether the per-note "Publicar" toggle applies (markdown only). */
export function canTogglePublish(o: { path?: string; kind?: string | null; canEdit: boolean }): boolean {
  if (!o.canEdit) return false;
  if (o.kind === 'canvas' || /\.canvas$/i.test(o.path ?? '')) return false;
  return true;
}

export function isPublished(frontmatter: Record<string, unknown> | null | undefined): boolean {
  return frontmatter?.publish === true;
}
