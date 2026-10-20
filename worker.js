// Custom Worker entry: the OpenNext app plus a cron handler that copies
// finished videos to R2 even when no browser is polling.
// See https://opennext.js.org/cloudflare/howtos/custom-worker

// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from './.open-next/worker.js';
import { sweepUnfinished } from './lib/sweep.js';

export default {
  fetch: handler.fetch,

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      sweepUnfinished(env).then(
        (results) => results.length && console.log('sweep', JSON.stringify(results)),
        (error) => console.error('sweep failed', error),
      ),
    );
  },
};
