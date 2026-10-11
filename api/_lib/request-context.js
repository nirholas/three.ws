// Per-request context the API handlers can read from anywhere in the call
// tree, without threading `req` through every helper.
//
// server/index.mjs opens a context around every API dispatch and records the
// request. Deep helpers that only receive a token (authenticateBearer is the
// one that matters: 270 call sites hand it a bare string) can still apply
// per-request rules such as a key's IP allowlist. Outside a request (tests,
// scripts, crons) the store is empty and every reader gets null.
//
// Kept free of imports so the server can load it at boot without pulling in
// the database or Redis clients.

import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/** Run `fn` with `ctx` visible to every async continuation inside it. */
export function runWithRequestContext(ctx, fn) {
	return store.run(ctx, fn);
}

/** The current request's context, or null outside one. */
export function requestContext() {
	return store.getStore() ?? null;
}

/** The request being served, or null outside one. */
export function currentRequest() {
	return store.getStore()?.req ?? null;
}
