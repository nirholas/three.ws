// Every owner credential a Forge request carries, shared by each endpoint that
// has to decide "is this caller the maker of this creation".
//
// The three credentials are a hashed browser id (x-forge-client), the
// signed-in account, and a per-creation manage token (x-forge-manage-token).
// The client key is dropped when it hashes to the shared anon bucket, so a
// caller who sends `anon` or nothing can never be mistaken for an owner. None of
// these is ever trusted without isCreationOwner / the store's own ownership
// predicate matching it to the row.

import { getSessionUser } from './auth.js';
import { hashClient, ownerClientKey } from './forge-store.js';

export function header(req, name) {
	const raw = req.headers[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return typeof value === 'string' && value ? value : null;
}

// `lazySession` skips the session lookup when the request carries no identity at
// all, so an anonymous public GET stays one query; writes always resolve it (a
// bearer-token session has no cookie).
export async function ownerCredentials(req, res, { lazySession = false } = {}) {
	const clientHeader = header(req, 'x-forge-client');
	const manageToken = header(req, 'x-forge-manage-token') ?? undefined;
	const clientKey = clientHeader ? ownerClientKey(hashClient(clientHeader)) : null;
	const hasIdentity = Boolean(clientHeader || manageToken || req.headers.cookie || req.headers.authorization);
	const user = !lazySession || hasIdentity ? await getSessionUser(req, res).catch(() => null) : null;
	const creds = { clientKey, userId: user?.id ?? null };
	if (manageToken) creds.manageToken = manageToken;
	return creds;
}
