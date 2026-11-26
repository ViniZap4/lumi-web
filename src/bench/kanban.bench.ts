// Kanban parse (lib/kanban/kanban.ts). 480 cards is the "500 cards"
// scale of the wave-2 filter budget (docs/phase3, WP 2.5).
import { bench, describe } from 'vitest';
import { parseKanban } from '../lib/kanban/kanban.ts';
import { kanbanCorpus } from './corpus.ts';

const OPTS = { time: 400, warmupTime: 100 };

for (const [lanes, perLane] of [[4, 20], [8, 60]] as const) {
  const text = kanbanCorpus(lanes, perLane);
  describe(`kanban ${lanes * perLane} cards`, () => {
    bench('parseKanban', () => {
      parseKanban(text);
    }, OPTS);
  });
}
