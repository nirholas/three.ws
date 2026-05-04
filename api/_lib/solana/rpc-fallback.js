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

const MAX_CONSECUTIVE_FAILS = 3;
const COOLDOWN_MS = 60_000;

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
		msg.includes('fetch failed')
	);
}

export class RpcFallback {
	constructor({ url, fallbackUrls = [], commitment = 'confirmed' } = {}) {
		if (!url) throw new Error('RpcFallback: primary url is required');
		this.urls = [url, ...fallbackUrls];
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
			if (this.cooldownUntil[this.currentIndex] > Date.now()) {
				this._rotate();
				if (tried.has(this.currentIndex)) break;
				continue;
			}
			tried.add(this.currentIndex);
			try {
				const result = await fn(this.getConnection());
				this.reportSuccess();
				return result;
			} catch (err) {
				if (isRetryable(err)) {
					console.warn('[rpc-fallback] %s rotated: %s', maskUrl(this.currentUrl), String(err).slice(0, 120));
					this.reportFailure();
				} else {
					throw err;
				}
			}
		}
		throw new Error('All RPC endpoints exhausted');
	}

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

// Convenience: build a fallback set from env. Honors:
//   SOLANA_RPC_URL              — primary
//   SOLANA_RPC_FALLBACK_URLS    — comma-separated alternates (optional)
export function rpcFallbackFromEnv({ network = 'mainnet', commitment = 'confirmed' } = {}) {
	const primary = network === 'devnet'
		? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com')
		: (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
	const fallbacks = (process.env.SOLANA_RPC_FALLBACK_URLS || '')
		.split(',').map((s) => s.trim()).filter(Boolean);
	return new RpcFallback({ url: primary, fallbackUrls: fallbacks, commitment });
}
