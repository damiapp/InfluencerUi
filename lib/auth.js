// Single-user auth helpers. Uses only Web Crypto so it runs in proxy.js
// (edge runtime), route handlers and Workers alike.
//
// Two independent gates, both optional, at least one required in production:
//   APP_PASSWORD (+ SESSION_SECRET)        password login, HMAC-signed cookie
//   CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD  verify the Cloudflare Access JWT

export const SESSION_COOKIE = 'studio_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function authConfig(source = process.env) {
  return {
    password: source.APP_PASSWORD || '',
    // Without SESSION_SECRET, sessions are signed with a key derived from the
    // password, so changing the password logs everyone out.
    secret: source.SESSION_SECRET || (source.APP_PASSWORD ? `pw:${source.APP_PASSWORD}` : ''),
    accessTeamDomain: (source.CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    accessAud: source.CF_ACCESS_AUD || '',
  };
}

export function authMode(config) {
  const modes = [];
  if (config.accessTeamDomain && config.accessAud) modes.push('access');
  if (config.password) modes.push('password');
  return modes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionToken(secret, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${expires}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${base64url(signature)}`;
}

export async function verifySessionToken(secret, token, now = Date.now()) {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(parts[2]), encoder.encode(`v1.${expires}`));
  } catch {
    return false;
  }
}

/** Constant-time string comparison (hash both sides first). */
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(a))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(b))),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ── Cloudflare Access ──────────────────────────────────────────────────────

let jwksCache = { domain: null, keys: null, fetchedAt: 0 };

async function accessKeys(teamDomain, fetchImpl = fetch) {
  const fresh = Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000;
  if (jwksCache.domain === teamDomain && jwksCache.keys && fresh) return jwksCache.keys;
  const response = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Could not load Cloudflare Access keys (${response.status})`);
  const { keys } = await response.json();
  jwksCache = { domain: teamDomain, keys, fetchedAt: Date.now() };
  return keys;
}

/** Verify the Cf-Access-Jwt-Assertion header (RS256, aud, iss, exp). */
export async function verifyAccessJwt(token, { teamDomain, aud }, { fetchImpl, now = Date.now() } = {}) {
  if (!token || !teamDomain || !aud) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
    if (header.alg !== 'RS256') return false;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return false;
    if (payload.iss !== `https://${teamDomain}`) return false;
    if (!payload.exp || payload.exp * 1000 < now) return false;
    const jwk = (await accessKeys(teamDomain, fetchImpl)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}
