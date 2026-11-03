// OAuth for an external MCP server, with three.ws as the client.
//
// The MCP SDK implements the protocol (RFC 9728 and 8414 discovery, RFC 7591
// dynamic client registration, PKCE, code exchange, refresh). This module is
// the storage side of it: an OAuthClientProvider whose state lives in the
// connection's encrypted credentials document, so a code exchange that
// finishes on a different Cloud Run instance than the one that started the
// flow still finds its verifier and registered client.
//
//   startOAuth   discover, register if the server allows it, build the
//                authorization URL, remember the state hash.
//   finishOAuth  exchange the code, store the tokens.
//   authProviderFor  the provider a live session uses; the SDK refreshes an
//                expired token through it and saveTokens persists the result.
//
// Every request goes through createSafeFetch, so discovery and token endpoints
// cannot be pointed at a private address either.

import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { env } from '../env.js';
import { createSafeFetch } from './safe-fetch.js';
import { getCatalogEntry, platformClientConfigured } from './catalog.js';
import { newState, readCredentials, writeCredentials, setOAuthState } from './store.js';

export const CALLBACK_PATH = '/api/mcp-connections/callback';
export const REFRESH_SKEW_MS = 90_000;

export function callbackUrl(origin = env.APP_ORIGIN) {
	return new URL(CALLBACK_PATH, origin).href;
}

function expiryOf(tokens) {
	return tokens?.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null;
}

/** The client the platform holds for a `registration: platform` entry, or null. */
export function platformClient(entry, e = process.env) {
	if (entry?.auth?.registration !== 'platform') return null;
	const prefix = entry.auth.clientEnv;
	const client_id = e[`${prefix}_CLIENT_ID`];
	if (!client_id) return null;
	const client_secret = e[`${prefix}_CLIENT_SECRET`];
	return client_secret ? { client_id, client_secret } : { client_id };
}

class StoredOAuthProvider {
	/**
	 * @param {object} o
	 * @param {string} o.connId
	 * @param {object} o.creds mutable credentials document; saved on every change
	 * @param {object|null} o.entry catalog entry, null for a custom server
	 * @param {string} o.redirectUrl
	 * @param {string} [o.state]
	 */
	constructor({ connId, creds, entry, redirectUrl, state }) {
		this.connId = connId;
		this.creds = creds;
		this.entry = entry;
		this._redirectUrl = redirectUrl;
		this._state = state;
		this.authorizationUrl = null;
	}

	get redirectUrl() {
		return this._redirectUrl;
	}

	get clientMetadata() {
		const fixed = platformClient(this.entry);
		const scopes = this.entry?.auth?.scopes;
		return {
			client_name: 'three.ws',
			client_uri: 'https://three.ws',
			redirect_uris: [this._redirectUrl],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: fixed?.client_secret ? 'client_secret_post' : 'none',
			...(scopes?.length ? { scope: scopes.join(' ') } : {}),
		};
	}

	state() {
		return this._state;
	}

	clientInformation() {
		return platformClient(this.entry) || this.creds.client || undefined;
	}

	async saveClientInformation(info) {
		this.creds.client = info;
		await writeCredentials(this.connId, this.creds);
	}

	tokens() {
		return this.creds.tokens || undefined;
	}

	async saveTokens(tokens) {
		this.creds.tokens = tokens;
		await writeCredentials(this.connId, this.creds, { tokenExpiresAt: expiryOf(tokens) });
	}

	redirectToAuthorization(url) {
		this.authorizationUrl = url.href;
	}

	async saveCodeVerifier(verifier) {
		this.creds.verifier = verifier;
		await writeCredentials(this.connId, this.creds);
	}

	codeVerifier() {
		if (!this.creds.verifier) throw new Error('no code verifier stored for this connection');
		return this.creds.verifier;
	}

	async invalidateCredentials(scope) {
		if (scope === 'all' || scope === 'tokens') delete this.creds.tokens;
		if (scope === 'all' || scope === 'client') delete this.creds.client;
		if (scope === 'all' || scope === 'verifier') delete this.creds.verifier;
		await writeCredentials(this.connId, this.creds);
	}
}

/** The provider a live session uses for a connection that signs in with OAuth. */
export async function authProviderFor(row) {
	const creds = await readCredentials(row.id);
	const provider = new StoredOAuthProvider({
		connId: row.id,
		creds,
		entry: row.catalog_id ? getCatalogEntry(row.catalog_id) : null,
		redirectUrl: callbackUrl(),
	});
	return provider;
}

/**
 * Begin the authorization-code flow. Returns the URL to send the owner to, or
 * null when the stored tokens were still good (the SDK refreshed them).
 */
export async function startOAuth(row, { returnTo }) {
	const entry = row.catalog_id ? getCatalogEntry(row.catalog_id) : null;
	if (entry && !platformClientConfigured(entry)) {
		const err = new Error(`${entry.name} sign-in is not configured on this deployment (${entry.auth.clientEnv}_CLIENT_ID is unset). Use an access token instead.`);
		err.code = 'oauth_unavailable';
		throw err;
	}
	const state = newState();
	const creds = await readCredentials(row.id);
	delete creds.tokens;
	const provider = new StoredOAuthProvider({ connId: row.id, creds, entry, redirectUrl: callbackUrl(), state });
	const result = await auth(provider, {
		serverUrl: row.server_url,
		scope: entry?.auth?.scopes?.join(' '),
		fetchFn: createSafeFetch(),
	});
	if (result === 'AUTHORIZED') return null;
	if (!provider.authorizationUrl) throw new Error('the server did not provide an authorization URL');
	await setOAuthState(row.id, state, returnTo);
	return provider.authorizationUrl;
}

/** Exchange the authorization code. Throws if the server refuses it. */
export async function finishOAuth(row, { code }) {
	const entry = row.catalog_id ? getCatalogEntry(row.catalog_id) : null;
	const creds = await readCredentials(row.id);
	const provider = new StoredOAuthProvider({ connId: row.id, creds, entry, redirectUrl: callbackUrl() });
	const result = await auth(provider, { serverUrl: row.server_url, authorizationCode: code, fetchFn: createSafeFetch() });
	if (result !== 'AUTHORIZED') throw new Error('the server did not accept the authorization code');
	delete creds.verifier;
	await writeCredentials(row.id, creds);
}

/**
 * Refresh the access token before a call when it is about to lapse. Returns
 * false when it cannot be refreshed without the owner (no refresh token, or the
 * server refused it).
 */
export async function ensureFreshToken(row) {
	const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
	if (!expiresAt || expiresAt - Date.now() > REFRESH_SKEW_MS) return true;
	const provider = await authProviderFor(row);
	if (!provider.tokens()?.refresh_token) return false;
	try {
		return (await auth(provider, { serverUrl: row.server_url, fetchFn: createSafeFetch() })) === 'AUTHORIZED';
	} catch {
		return false;
	}
}
