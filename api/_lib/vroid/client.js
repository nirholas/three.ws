// VRoid Hub API client: PKCE helpers, token exchange/refresh, and the
// authenticated GET used to list and fetch character models.
//
// Response envelope confirmed live: an authenticated GET without a valid
// bearer answers 401 {"data":{},"error":{"code":"COMMON_SIGNED_IN_REQUIRED"},
// "_links":{},"rand":"..."}. Every successful call uses the same envelope
// with `data` populated.

import { randomToken, sha256Base64Url } from '../crypto.js';
import { fetchUpstream, fetchUpstreamJson } from '../upstream-fetch.js';
import { API_BASE, API_VERSION, clientId, clientSecret, redirectUri } from './config.js';

export async function createPkcePair() {
	const verifier = randomToken(32);
	const challenge = await sha256Base64Url(verifier);
	return { verifier, challenge };
}

function authHeaders(extra = {}) {
	return { 'X-Api-Version': API_VERSION, accept: 'application/json', ...extra };
}

/** Exchange an authorization code for an access/refresh token pair. */
export async function exchangeCode(code, codeVerifier) {
	const res = await fetchUpstream(
		`${API_BASE}/oauth/token`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeaders() },
			body: JSON.stringify({
				grant_type: 'authorization_code',
				client_id: clientId(),
				client_secret: clientSecret(),
				code,
				redirect_uri: redirectUri(),
				code_verifier: codeVerifier,
			}),
		},
		{ name: 'vroid-hub', timeoutMs: 15_000, attempts: 1, okWhen: () => true },
	);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		const err = new Error(body.error_description || body.error || `token exchange failed: ${res.status}`);
		err.status = 502;
		throw err;
	}
	return body; // { access_token, refresh_token, token_type, expires_in, scope, created_at }
}

export async function refreshToken(refreshTokenValue) {
	const res = await fetchUpstream(
		`${API_BASE}/oauth/token`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeaders() },
			body: JSON.stringify({
				grant_type: 'refresh_token',
				client_id: clientId(),
				client_secret: clientSecret(),
				refresh_token: refreshTokenValue,
			}),
		},
		{ name: 'vroid-hub', timeoutMs: 15_000, attempts: 1, okWhen: () => true },
	);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		const err = new Error(body.error_description || body.error || `token refresh failed: ${res.status}`);
		err.status = 502;
		throw err;
	}
	return body;
}

function unwrapEnvelope(body) {
	if (body?.error?.code) {
		const err = new Error(body.error.message || body.error.code);
		err.code = body.error.code;
		err.status = body.error.code === 'COMMON_SIGNED_IN_REQUIRED' ? 401 : 502;
		throw err;
	}
	return body?.data ?? body;
}

/** Authenticated GET against the Hub API, unwrapping the {data,error} envelope. */
export async function hubGet(path, accessToken, { query } = {}) {
	const url = new URL(path, API_BASE);
	if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
	const body = await fetchUpstreamJson(
		url.toString(),
		{ headers: authHeaders({ authorization: `Bearer ${accessToken}` }) },
		{ name: 'vroid-hub', timeoutMs: 15_000, attempts: 2, okWhen: (res) => res.status < 500 },
	);
	return unwrapEnvelope(body);
}

/** Authenticated POST against the Hub API, unwrapping the {data,error} envelope. */
export async function hubPost(path, accessToken, payload) {
	const body = await fetchUpstreamJson(
		new URL(path, API_BASE).toString(),
		{
			method: 'POST',
			headers: authHeaders({ authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }),
			body: JSON.stringify(payload || {}),
		},
		{ name: 'vroid-hub', timeoutMs: 15_000, attempts: 1, okWhen: (res) => res.status < 500 },
	);
	return unwrapEnvelope(body);
}

export const ACCOUNT_MODELS_PATH = '/api/account/character_models';
export const HEARTS_PATH = '/api/hearts';
export const CHARACTER_MODEL_PATH = (id) => `/api/character_models/${encodeURIComponent(id)}`;
export const DOWNLOAD_LICENSES_PATH = '/api/download_licenses';
export const DOWNLOAD_LICENSE_DOWNLOAD_PATH = (licenseId) => `/api/download_licenses/${encodeURIComponent(licenseId)}/download`;

/**
 * The documented two-step download flow (developer.vroid.com/en/api/load-character.html):
 * mint a DownloadLicense for a character_model, then resolve it to the S3
 * presigned URL that actually serves the bytes. The second call 302s rather
 * than answering JSON, so it is handled with a manual-redirect fetch here
 * instead of hubGet's envelope-unwrapping JSON path.
 */
export async function issueDownloadLicense(characterModelId, accessToken) {
	return hubPost(DOWNLOAD_LICENSES_PATH, accessToken, { character_model_id: characterModelId });
}

export async function resolveDownloadUrl(licenseId, accessToken) {
	const res = await fetchUpstream(
		new URL(DOWNLOAD_LICENSE_DOWNLOAD_PATH(licenseId), API_BASE).toString(),
		{ redirect: 'manual', headers: authHeaders({ authorization: `Bearer ${accessToken}` }) },
		{ name: 'vroid-hub', timeoutMs: 15_000, attempts: 1, okWhen: () => true },
	);
	const location = res.headers.get('location');
	if (!(res.status >= 300 && res.status < 400) || !location) {
		const err = new Error(`download license did not redirect to a file (HTTP ${res.status})`);
		err.status = 502;
		throw err;
	}
	return location;
}
