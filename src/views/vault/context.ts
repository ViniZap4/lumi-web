// Typed context for the book workspace (the controllers behind
// VaultHomeView). Child components of the shell read the workspace
// from here instead of a long prop list.

import { getContext, setContext } from 'svelte';
import type { Workspace } from './workspace.svelte.ts';

const KEY = Symbol('lumi.workspace');

export function provideWorkspace(ws: Workspace): Workspace {
  return setContext(KEY, ws);
}

export function useWorkspace(): Workspace {
  const ws = getContext<Workspace | undefined>(KEY);
  if (!ws) throw new Error('useWorkspace() outside a VaultHomeView');
  return ws;
}
