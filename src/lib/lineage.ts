// CRDT lineage check for persisted replicas (web offline).
//
// A replica may only be merged into the SAME CRDT history it was
// forked from. Merging into another one (the note was deleted and
// recreated with the same id, the server's CRDT state was reset or
// re-seeded, a restore from an older backup) would duplicate or
// resurrect text: Yjs merges by item ids, and two histories that both
// "contain" the body under different client ids merge as two copies.
//
// `checkLineage` is the ONE place that decides. It is fed by whatever
// the server exposes, strongest signal first:
//
//   1. `epoch` — an explicit server CRDT generation/epoch (assumed
//      contract: an opaque string that changes whenever the server
//      starts a new history for a note id; exposed as `crdt_epoch` on
//      the note metadata, the /snapshot response or the ws-ticket
//      response). When both sides have one, it is authoritative.
//   2. State-vector dominance (needs no server change). Every item this
//      replica holds that was NOT authored on this device came from the
//      server, so the server's state vector must be >= the replica's
//      clock for each such client. A server whose vector is behind lost
//      (or never had) that history → different lineage. Proven same
//      lineage when at least one server-origin client is dominated
//      (client ids are random 32-bit; a collision across re-seeds is
//      negligible).
//   3. `createdAt` — only consulted when the replica holds no
//      server-origin items at all (e.g. a note that was empty at first
//      sync), where (2) has nothing to compare. A recreated note gets a
//      new `created_at`.
//
// Tombstones (GET /changes `deleted`, close code 4404) are handled
// before this function is ever reached: a deleted note's replica is
// turned into a conflict copy (if it had unsent edits) and dropped, so
// a later note with the same id starts from an empty replica.

import type { LineageStamp } from './offline-store.ts';

export type StateVector = Map<number, number>;

export interface LocalLineage {
  stamp: LineageStamp;
  /** State vector of the replica. */
  sv: StateVector;
  /** Client ids that authored edits on this device. */
  localClients: Set<number>;
}

export interface ServerLineage {
  stamp: LineageStamp;
  /** Server state vector (GET /snapshot `vector_clock`), when known. */
  sv: StateVector | null;
}

export type LineageVerdict =
  | { ok: true; basis: 'epoch' | 'state-vector' | 'created-at' | 'nothing-to-protect' | 'unverifiable' }
  | { ok: false; reason: 'epoch' | 'history' | 'recreated' };

export function checkLineage(local: LocalLineage, server: ServerLineage): LineageVerdict {
  // 1. Explicit epoch.
  if (local.stamp.epoch && server.stamp.epoch) {
    return local.stamp.epoch === server.stamp.epoch ? { ok: true, basis: 'epoch' } : { ok: false, reason: 'epoch' };
  }

  // 2. State-vector dominance over server-origin clients.
  let foreign = 0;
  if (server.sv) {
    for (const [client, clock] of local.sv) {
      if (clock <= 0 || local.localClients.has(client)) continue;
      foreign++;
      if ((server.sv.get(client) ?? 0) < clock) return { ok: false, reason: 'history' };
    }
    if (foreign > 0) return { ok: true, basis: 'state-vector' };
  }

  // 3. Nothing server-authored to compare: fall back to created_at.
  if (local.stamp.createdAt && server.stamp.createdAt && local.stamp.createdAt !== server.stamp.createdAt) {
    return { ok: false, reason: 'recreated' };
  }
  let hasAny = false;
  for (const clock of local.sv.values()) if (clock > 0) hasAny = true;
  if (!hasAny) return { ok: true, basis: 'nothing-to-protect' };
  if (local.stamp.createdAt && server.stamp.createdAt) return { ok: true, basis: 'created-at' };
  return { ok: true, basis: 'unverifiable' };
}

export const LINEAGE_REASON: Record<'epoch' | 'history' | 'recreated', string> = {
  epoch: 'o servidor recomeçou o histórico desta nota',
  history: 'o servidor não tem mais o histórico desta cópia (nota recriada ou estado redefinido)',
  recreated: 'a nota foi apagada e criada de novo com o mesmo nome',
};
