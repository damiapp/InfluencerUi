import { NextResponse } from 'next/server';

import { HttpError } from './errors.js';

export { HttpError, newId } from './errors.js';

export function json(data, init) {
  return NextResponse.json(data, init);
}

/** Wrap a route handler so thrown errors become JSON responses. */
export function route(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status >= 500) console.error(error);
      return NextResponse.json({ error: error.message || 'Internal error' }, { status });
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
