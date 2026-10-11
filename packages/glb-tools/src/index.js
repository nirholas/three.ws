// @three-ws/glb-tools — inspect, theme, and bake GLB models from the shell or CI.
// Thin client over three live three.ws endpoints: structural model inspection
// (/api/x402/model-check), token-themed mesh synthesis (/api/x402/mint-to-mesh),
// and server-side appearance baking (/api/avatars/:id). See README.md for the
// full reference.

import { createHttp, ThreeWsError } from './http.js';

export { ThreeWsError, PaymentRequiredError, DEFAULT_BASE_URL } from './http.js';

// Loose Solana base58 sanity check, mirrors BASE58_RE in api/x402/mint-to-mesh.js
// so theme() rejects obvious garbage before paying for a network round trip.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Create a glb-tools client bound to a base URL, fetch, and optional auth.
 * For most callers the default exports `inspect()` / `theme()` / `bake()` are
 * enough; use this when you want to reuse configuration (a payment-aware fetch
 * for the x402 lanes, an owner bearer token for baking, a custom origin) across
 * many calls.
 */
export function createGlbTools(options = {}) {
	const request = createHttp(options);

	/** Fetch a public glTF/GLB by URL and return its structure + optimization advice. */
	async function inspect(url, opts = {}) {
		if (!url || typeof url !== 'string') {
			throw new ThreeWsError('inspect() needs a GLB/glTF url string.', { code: 'invalid_input' });
		}
		const res = await request('/api/x402/model-check', {
			query: { url },
			headers: payHeaders(opts),
			signal: opts.signal,
		});
		return shapeInspect(res);
	}

	/** Synthesize a themed GLB for a Solana fungible-token mint. */
	async function theme(mint, opts = {}) {
		if (!mint || typeof mint !== 'string') {
			throw new ThreeWsError('theme() needs a base58 SPL mint string.', { code: 'invalid_input' });
		}
		if (!BASE58_RE.test(mint)) {
			throw new ThreeWsError('mint must be a base58 SPL address (32–44 chars).', { code: 'invalid_mint' });
		}
		const res = await request('/api/x402/mint-to-mesh', {
			query: { mint },
			headers: payHeaders(opts),
			signal: opts.signal,
		});
		return shapeTheme(res);
	}

	/** Bake an appearance into a three.ws avatar's GLB (owner-authenticated). */
	async function bake(avatarId, appearance, opts = {}) {
		if (!avatarId || typeof avatarId !== 'string') {
			throw new ThreeWsError('bake() needs an avatar id string.', { code: 'invalid_input' });
		}
		if (appearance !== null && (typeof appearance !== 'object' || Array.isArray(appearance))) {
			throw new ThreeWsError('bake() appearance must be an object or null to clear it.', { code: 'invalid_input' });
		}
		// A per-call owner token wins over the client-level apiKey.
		const headers = opts.token ? { authorization: `Bearer ${opts.token}` } : opts.headers;
		const res = await request(`/api/avatars/${encodeURIComponent(avatarId)}`, {
			method: 'PATCH',
			body: { appearance: appearance ?? null },
			headers,
			signal: opts.signal,
		});
		return shapeBake(res);
	}

	return { inspect, theme, bake };
}

// `payWith` is a billing-lane hint the x402 facilitator reads off the request.
// The http core already turns a 402 into a PaymentRequiredError carrying the
// x402 challenge; pass a payment-aware fetch (e.g. @three-ws/x402-fetch) to
// settle it automatically.
function payHeaders(opts) {
	const h = { ...(opts.headers || {}) };
	if (opts.payWith) h['x-pay-with'] = opts.payWith;
	return Object.keys(h).length ? h : undefined;
}

// A module-level default client for the zero-config path: `import { inspect }`.
let shared = null;
function defaultClient() {
	return (shared ||= createGlbTools());
}

/** Inspect a public glTF/GLB by URL — exact stats, no viewer. */
export function inspect(url, opts) {
	return defaultClient().inspect(url, opts);
}
/** Turn a Solana mint into a renderable, themed GLB. */
export function theme(mint, opts) {
	return defaultClient().theme(mint, opts);
}
/** Bake a customized appearance into an avatar's GLB (owner-authenticated). */
export function bake(avatarId, appearance, opts) {
	return defaultClient().bake(avatarId, appearance, opts);
}

// buildLodChain is Node.js-only (gltf-transform's NodeIO, meshoptimizer's WASM
// simplifier) and the one real dependency this otherwise zero-dependency
// package carries. It's dynamically imported here so a browser bundle that
// only calls inspect()/theme()/bake() never pulls gltf-transform into its
// graph; a Node-only caller can also import '@three-ws/glb-tools/lod' directly.
/**
 * Build a real multi-level LOD chain for a GLB (Node.js only). See
 * README.md#buildlodchain for the levels/MSFT_lod contract.
 */
export async function buildLodChain(glb, options) {
	const { buildLodChain: impl } = await import('./lod.js');
	return impl(glb, options);
}

// ── Response shaping ─────────────────────────────────────────────────────────

// The inspect endpoint already returns camelCase JSON (it ships the isomorphic
// inspector's output verbatim), so we pass the structure through and only
// guarantee the documented shape exists.
function shapeInspect(res) {
	if (!res || typeof res !== 'object') {
		throw new ThreeWsError('Unexpected empty response from /api/x402/model-check.', { code: 'bad_response' });
	}
	return {
		url: res.url ?? null,
		fetchedBytes: res.fetchedBytes ?? 0,
		model: res.model ?? null,
		suggestions: Array.isArray(res.suggestions) ? res.suggestions : [],
		raw: res,
	};
}

// The theme endpoint returns the GLB base64-encoded under glb.base64; decode it
// into `bytes` for the caller and keep glb.bytes as the size.
function shapeTheme(res) {
	if (!res || typeof res !== 'object' || !res.glb) {
		throw new ThreeWsError('Unexpected response from /api/x402/mint-to-mesh — no glb.', { code: 'bad_response' });
	}
	const t = res.theme || {};
	return {
		mint: res.mint ?? null,
		theme: {
			name: t.name ?? null,
			symbol: t.symbol ?? null,
			color: Array.isArray(t.color) ? t.color : null,
			imageUrl: t.imageUrl ?? null,
			hasImage: Boolean(t.hasImage),
		},
		bytes: decodeBase64(res.glb.base64),
		glb: {
			mimeType: res.glb.mimeType ?? 'model/gltf-binary',
			bytes: res.glb.bytes ?? 0,
		},
		raw: res,
	};
}

// The PATCH endpoint returns `{ avatar }`. When the appearance was bakeable, the
// avatar carries `baked_storage_key` + `appearance_hash`; when it was empty /
// cleared, both are null (the base GLB is served again). `size_bytes` is exposed
// by the synchronous baker on the bake result and echoed when present.
function shapeBake(res) {
	const avatar = res?.avatar;
	if (!avatar || typeof avatar !== 'object') {
		throw new ThreeWsError('Unexpected response from PATCH /api/avatars/:id — no avatar.', { code: 'bad_response' });
	}
	return {
		avatarId: avatar.id ?? null,
		bakedStorageKey: avatar.baked_storage_key ?? null,
		appearanceHash: avatar.appearance_hash ?? null,
		sizeBytes: avatar.size_bytes ?? null,
		cleared: avatar.baked_storage_key == null,
		bakeError: avatar.bake_error ?? null,
		raw: res,
	};
}

// Base64 → Uint8Array, isomorphic: Buffer in Node, atob in the browser.
function decodeBase64(b64) {
	if (typeof b64 !== 'string' || !b64) return new Uint8Array(0);
	if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
		const buf = Buffer.from(b64, 'base64');
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
