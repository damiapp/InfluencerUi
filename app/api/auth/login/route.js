import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, authConfig, createSessionToken, safeEqual } from '@/lib/auth';
import { readJson, route } from '@/lib/http';

export const POST = route(async (request) => {
  const config = authConfig();
  if (!config.password) {
    return NextResponse.json({ error: 'Password login is not enabled (APP_PASSWORD is not set).' }, { status: 400 });
  }
  const { password } = await readJson(request);
  if (!(await safeEqual(password || '', config.password))) {
    // Slow down guessing a little.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(config.secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
});
