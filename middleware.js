import { NextResponse } from 'next/server';
import { SESSION_COOKIE, authConfig, authMode, verifyAccessJwt, verifySessionToken } from './lib/auth.js';

// Reachable without a session.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

function addSecurityHeaders(response) {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // All media is served from our own origin (R2 via /api/media), so nothing
    // needs to talk to third-party hosts from the browser.
    response.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:;"
    );
    return response;
}

function deny(request, status, message) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
        return addSecurityHeaders(NextResponse.json({ error: message }, { status }));
    }
    if (status === 401) {
        const url = new URL('/login', request.url);
        url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
        return addSecurityHeaders(NextResponse.redirect(url));
    }
    return addSecurityHeaders(new NextResponse(message, { status }));
}

export async function middleware(request) {
    const { pathname } = request.nextUrl;
    const config = authConfig();
    const modes = authMode(config);

    if (modes.includes('access')) {
        const ok = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
            teamDomain: config.accessTeamDomain,
            aud: config.accessAud,
        });
        if (!ok) return deny(request, 403, 'Cloudflare Access authentication required');
    }

    if (PUBLIC_PATHS.includes(pathname)) return addSecurityHeaders(NextResponse.next());

    if (modes.includes('password')) {
        const ok = await verifySessionToken(config.secret, request.cookies.get(SESSION_COOKIE)?.value);
        if (!ok) return deny(request, 401, 'Not signed in');
    } else if (!modes.length && process.env.NODE_ENV === 'production') {
        // Fail closed: every generation costs money.
        return deny(request, 503, 'Authentication is not configured. Set APP_PASSWORD (and SESSION_SECRET) or Cloudflare Access.');
    }

    return addSecurityHeaders(NextResponse.next());
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
