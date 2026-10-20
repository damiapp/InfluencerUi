// Finalise unfinished jobs nobody is polling. Called by the Worker cron
// trigger (worker.js) and by the gallery when it loads.

import { listUnfinishedGenerations, getGenerationRow, updateGeneration } from './db.js';
import { refreshGeneration } from './generations.js';

// A synchronous image request that never recorded a result (crashed worker).
const STUCK_WITHOUT_JOB_MS = 15 * 60 * 1000;

export async function sweepUnfinished(env, { limit = 20 } = {}) {
  const ids = await listUnfinishedGenerations(env.DB, limit);
  const results = [];
  for (const id of ids) {
    try {
      const row = await getGenerationRow(env.DB, id);
      if (!row.interaction_id) {
        if (Date.now() - row.created_at > STUCK_WITHOUT_JOB_MS) {
          await updateGeneration(env.DB, id, { status: 'failed', error: 'The request was interrupted before the provider answered.' });
        }
        continue;
      }
      const generation = await refreshGeneration(env, id);
      results.push({ id, status: generation.status });
    } catch (error) {
      console.error(`sweep ${id} failed`, error);
    }
  }
  return results;
}
