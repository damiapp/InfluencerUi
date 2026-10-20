import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['studio'],
};

// Gives `next dev` local D1/R2 bindings (persisted in .wrangler/state) via wrangler.
if (process.env.NODE_ENV !== 'production') {
  initOpenNextCloudflareForDev();
}

export default nextConfig;
