import { existsSync, readFileSync } from 'node:fs';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['studio'],
};

if (process.env.NODE_ENV !== 'production') {
  // Gives `next dev` local D1/R2 bindings (persisted in .wrangler/state) via wrangler.
  initOpenNextCloudflareForDev();

  // Route handlers read .dev.vars through the Cloudflare context, but
  // proxy.js only sees process.env, so mirror the file there too.
  if (existsSync('.dev.vars')) {
    for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export default nextConfig;
