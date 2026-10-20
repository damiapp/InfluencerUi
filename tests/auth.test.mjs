import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, authMode, createSessionToken, safeEqual, verifyAccessJwt, verifySessionToken } from '../lib/auth.js';

test('session tokens verify, expire and reject tampering', async () => {
  const token = await createSessionToken('secret');
  assert.equal(await verifySessionToken('secret', token), true);
  assert.equal(await verifySessionToken('other', token), false);
  const [v, exp, sig] = token.split('.');
  assert.equal(await verifySessionToken('secret', `${v}.${Number(exp) + 1}.${sig}`), false);
  assert.equal(await verifySessionToken('secret', token, Date.now() + 31 * 86400_000), false);
  assert.equal(await verifySessionToken('secret', ''), false);
  assert.equal(await verifySessionToken('', token), false);
});

test('auth config and modes', () => {
  assert.deepEqual(authMode(authConfig({})), []);
  assert.deepEqual(authMode(authConfig({ APP_PASSWORD: 'x' })), ['password']);
  assert.equal(authConfig({ APP_PASSWORD: 'x' }).secret, 'pw:x');
  assert.equal(authConfig({ APP_PASSWORD: 'x', SESSION_SECRET: 's' }).secret, 's');
  assert.deepEqual(authMode(authConfig({ CF_ACCESS_TEAM_DOMAIN: 'https://me.cloudflareaccess.com/', CF_ACCESS_AUD: 'aud' })), ['access']);
});

test('safeEqual', async () => {
  assert.equal(await safeEqual('abc', 'abc'), true);
  assert.equal(await safeEqual('abc', 'abd'), false);
});

const b64url = (data) => Buffer.from(data).toString('base64url');

test('Cloudflare Access JWT verification', async () => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
  const teamDomain = 'me.cloudflareaccess.com';
  const fetchImpl = async (url) => {
    assert.equal(url, `https://${teamDomain}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [jwk] }));
  };
  const sign = async (payload, kid = 'k1') => {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
    const body = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  };
  const good = { aud: ['aud1'], iss: `https://${teamDomain}`, exp: Math.floor(Date.now() / 1000) + 60 };
  const opts = { teamDomain, aud: 'aud1' };
  assert.equal(await verifyAccessJwt(await sign(good), opts, { fetchImpl }), true);
  assert.equal(await verifyAccessJwt(await sign({ ...good, aud: ['other'] }), opts, { fetchImpl }), false);
  assert.equal(await verifyAccessJwt(await sign({ ...good, iss: 'https://evil.example' }), opts, { fetchImpl }), false);
  assert.equal(await verifyAccessJwt(await sign({ ...good, exp: 1 }), opts, { fetchImpl }), false);
  assert.equal(await verifyAccessJwt(await sign(good, 'unknown'), opts, { fetchImpl }), false);
  const token = await sign(good);
  assert.equal(await verifyAccessJwt(token.slice(0, -4) + 'AAAA', opts, { fetchImpl }), false);
  assert.equal(await verifyAccessJwt(null, opts, { fetchImpl }), false);
});
