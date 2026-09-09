// Multi-endpoint Solana RPC connection with automatic failover.
// Ported from pumpkit @pumpkit/core/src/solana/rpc.ts to our serverless layout.
//
// Usage:
//   import { createRpcFallback } from './rpc-fallback.js';
//   const rpc = createRpcFallback({ url: env.SOLANA_RPC_URL, fallbackUrls: [...] });
//   const slot = await rpc.withFallback((c) => c.getSlot());
//
// Rotation policy:
//   - 3 consecutive retryable failures → rotate to next endpoint, prior in 60s cooldown.
//   - 403 / non-retryable errors are re-thrown immediately (auth issues should not
//     burn through fallbacks).

import { Connection } from '@solana/web3.js';
import {
	solanaRpcEndpoints,
	isEndpointCooling,
	markEndpointCooldown,
	makeRotatingFetch,
	normalizeRpcUrl,
	isHttpUrl,
} from './connection.js';

const MAX_CONSECUTIVE_FAILS = 3;
const COOLDOWN_MS = 60_000;

// Recover the upstream HTTP status from a thrown web3.js error so we can size the
// shared per-provider cooldown (a quota 429 parks the provider for hours, a plain
// 429 for minutes). web3.js surfaces 429 bodies verbatim, e.g.
// "429 Too Many Requests: {…-32429…max usage reached…}".
function statusFromErr(err) {
	const m = String((err && err.message) || err).match(/\b(401|403|429|500|502|503|504)\b/);
	return m ? Number(m[1]) : 429;
}

export function deriveWsUrl(httpUrl) {
	return String(httpUrl).replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

function maskUrl(url) {
	try {
		const u = new URL(url);
		if (u.pathname.length > 10) {
			return `${u.protocol}//${u.host}/${u.pathname.slice(1, 8)}…`;
		}
		return `${u.protocol}//${u.host}`;
	} catch {
		return String(url).slice(0, 20) + '…';
	}
}

function isRetryable(err) {
	const msg = String(err && err.message ? err.message : err);
	if (msg.includes('403')) return false;
	return (
		msg.includes('429') ||
		msg.includes('502') ||
		msg.includes('503') ||
		msg.includes('504') ||
		msg.includes('ETIMEDOUT') ||
		msg.includes('ECONNREFUSED') ||
		msg.includes('ECONNRESET') ||
		msg.includes('fetch failed') ||
		// A provider that returns 200 + an empty/garbage body makes web3.js throw a
		// `StructError: Expected the value to satisfy a union of …, but received:`
		// while parsing the response. makeRotatingFetch already catches this at the
		// transport layer, but a single-endpoint Connection (urls.length === 1, no
		// rotating fetch attached) surfaces it here — rotating/cooling is the right
		// response, not bubbling an opaque schema error to the caller.
		msg.includes('StructError') ||
		msg.includes('Expected the value to satisfy')
	);
}

export class RpcFallback {
	constructor({ url, fallbackUrls = [], commitment = 'confirmed' } = {}) {
		// Normalize, then keep only Connection-safe http(s) endpoints. A malformed
		// entry (scheme-less host, ws:// URL, quoted env value, junk) would otherwise
		// reach `new Connection` in getConnection() and throw "Endpoint URL must start
		// with `http:` or `https:`." — the unhandled 500 that hammered /api/pump/curve.
		// Dedupe while preserving priority order.
		const seen = new Set();
		this.urls = [url, ...fallbackUrls]
			.map((u) => normalizeRpcUrl(u))
			.filter((u) => isHttpUrl(u) && !seen.has(u) && seen.add(u));
		if (this.urls.length === 0) {
			throw new Error('RpcFallback: no valid http(s) RPC endpoint configured');
		}
		this.commitment = commitment;
		this.currentIndex = 0;
		this.failCounts = new Array(this.urls.length).fill(0);
		this.cooldownUntil = new Array(this.urls.length).fill(0);
		this.connections = new Array(this.urls.length).fill(null);
	}

	getConnection() {
		if (!this.connections[this.currentIndex]) {
			const url = this.urls[this.currentIndex];
			this.connections[this.currentIndex] = new Connection(url, {
				commitment: this.commitment,
				wsEndpoint: deriveWsUrl(url),
				// Fail fast on 429 so we rotate to the next provider immediately
				// instead of web3.js running its 500/1000/2000/4000ms backoff loop
				// ("Server responded with 429 … Retrying after Nms") on a dead lane.
				disableRetryOnRateLimit: true,
				// Rotate across the WHOLE endpoint set at the fetch layer, sharing the
				// process-wide cooldown map. This is essential for call sites whose fn
				// swallows the RPC error instead of rethrowing it: the sdk-bridge
				// curve/quote reads return null on a 429 rather than throwing, so the
				// withFallback() loop below would never observe a failure, never
				// rotate, never mark a cooldown — and re-hammer a quota-dead provider
				// (Helius -32429 "max usage reached") on every single poll. That was
				// the source of the "[sdk-bridge] … 429" storm. With the rotating
				// fetch the dead endpoint is skipped BEFORE the SDK call runs and is
				// parked in cooldown, so the read transparently lands on a healthy
				// provider and subsequent polls skip the dead lane outright.
				...(this.urls.length > 1 ? { fetch: makeRotatingFetch(this.urls) } : {}),
			});
		}
		return this.connections[this.currentIndex];
	}

	get currentUrl() {
		return this.urls[this.currentIndex];
	}

	reportSuccess() {
		this.failCounts[this.currentIndex] = 0;
	}

	reportFailure() {
		this.failCounts[this.currentIndex]++;
		if (this.failCounts[this.currentIndex] >= MAX_CONSECUTIVE_FAILS) this._rotate();
	}

	async withFallback(fn) {
		const tried = new Set();
		while (tried.size < this.urls.length) {
			// Skip endpoints parked in the shared process-wide cooldown (e.g. Helius
			// after a quota 429) or this instance's local cooldown — don't re-probe a
			// known-dead lane on every call. Count it as tried so the loop still
			// terminates when everything is cooling.
			// Use _advanceSilently() here (no log) — the endpoint was already known-dead
			// from a prior discovery; emitting a "rotated" line for every RPC call that
			// skips a cooling provider flooded the logs with ~20+ identical lines per
			// pump-agent-stats cron tick, all reporting the same known-dead Helius URL.
			if (isEndpointCooling(this.currentUrl) || this.cooldownUntil[this.currentIndex] > Date.now()) {
				tried.add(this.currentIndex);
				this._advanceSilently();
				continue;
			}
			tried.add(this.currentIndex);
			try {
				const result = await fn(this.getConnection());
				this.reportSuccess();
				return result;
			} catch (err) {
				if (isRetryable(err)) {
					const status = statusFromErr(err);
					// Check BEFORE marking so parallel withFallback() calls that race
					// onto the same endpoint only emit the log once: the first caller
					// sees alreadyCooling=false, logs, then marks; every subsequent
					// concurrent caller that resolves afterward sees alreadyCooling=true.
					const alreadyCooling = isEndpointCooling(this.currentUrl);
					const ms = markEndpointCooldown(this.currentUrl, status, String((err && err.message) || err));
					if (!alreadyCooling) {
						// INFO, not WARN: withFallback() keeps trying the remaining
						// endpoints and the call still resolves. Only an exhausted chain
						// (the throw below) is actionable — so this stays out of the
						// `level:warning` view to avoid non-actionable failover chatter.
						console.log(
							'[rpc-fallback] %s %s — cooling %dm, rotating',
							maskUrl(this.currentUrl),
							status,
							Math.round(ms / 60_000),
						);
					}
					this.reportFailure();
				} else {
					throw err;
				}
			}
		}
		// Every endpoint failed or is cooling — the caller gets nothing. This is the
		// actionable condition (the whole failover chain is down), so it warns where
		// the per-endpoint rotations above only log.
		console.warn(`[rpc-fallback] all ${this.urls.length} endpoints exhausted`);
		// Carry the contract fields wrap() looks for. Without them this surfaced to
		// callers as a bare 500 `internal_error` with a support ref, which reads as
		// "the endpoint is broken" when the truth is "every upstream provider is
		// rate limited, retry shortly": a 503 the client and CDN can act on.
		throw Object.assign(new Error('All RPC endpoints exhausted'), {
			status: 503,
			code: 'upstream_unavailable',
			expose: true,
		});
	}

	// Advance to the next endpoint without setting a local cooldown and without
	// logging. Used when the endpoint is already known-cooling from the process-wide
	// map — no new failure was discovered, so no log is warranted.
	_advanceSilently() {
		this.connections[this.currentIndex] = null;
		this.currentIndex = (this.currentIndex + 1) % this.urls.length;
		this.failCounts[this.currentIndex] = 0;
	}

	// Rotate due to a newly discovered consecutive-failure threshold. Sets a local
	// cooldown and logs once so the rotation is visible in the log trail.
	_rotate() {
		this.cooldownUntil[this.currentIndex] = Date.now() + COOLDOWN_MS;
		this.connections[this.currentIndex] = null;
		const prev = this.currentIndex;
		this.currentIndex = (this.currentIndex + 1) % this.urls.length;
		this.failCounts[this.currentIndex] = 0;
		if (this.urls.length > 1) {
			console.info('[rpc-fallback] rotated %s → %s', maskUrl(this.urls[prev]), maskUrl(this.currentUrl));
		}
	}
}

export function createRpcFallback(options) {
	return new RpcFallback(options);
}

// Convenience: build a fallback set from env. solanaRpcEndpoints() is now the
// single source of truth for the whole chain (explicit SOLANA_RPC_URL → Helius →
// Alchemy → dRPC-when-keyed → Ankr-when-keyed → operator SOLANA_RPC_FALLBACK_URLS
// → PublicNode → public), so even with no SOLANA_RPC_URL set the keyed providers
// plus the keyless endpoints give a real deep failover set.
export function rpcFallbackFromEnv({ network = 'mainnet', commitment = 'confirmed' } = {}) {
	const urls = solanaRpcEndpoints(network);
	const [primary, ...fallbackUrls] = urls;
	return new RpcFallback({ url: primary, fallbackUrls, commitment });
}
