import { getEnv } from '@/lib/env';
import { json, route } from '@/lib/http';
import { spendSince } from '@/lib/db';
import { pricing } from '@/lib/generations';
import { resolveProviderId } from '@/lib/providers';
import { authConfig, authMode } from '@/lib/auth';

// Pricing table, provider mode and this month's estimated spend (UTC month).
export const GET = route(async () => {
  const env = await getEnv();
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const month = await spendSince(env.DB, monthStart);
  return json({
    provider: resolveProviderId(env),
    hasApiKey: !!env.GEMINI_API_KEY,
    auth: authMode(authConfig(env)),
    pricing,
    month: { start: monthStart, total: month.total, count: month.count, currency: pricing.currency },
  });
});
