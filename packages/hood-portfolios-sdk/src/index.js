/**
 * @three-ws/hood-portfolios-sdk
 *
 * A typed-by-JSDoc client for the Robinhood Chain portfolios API, plus the one
 * piece of logic a client genuinely needs locally: canonical manifest
 * serialisation.
 *
 * Zero dependencies, and no network at import time. Every method maps to one
 * free, keyless endpoint on https://three.ws.
 */

export const DEFAULT_BASE_URL = 'https://three.ws';
export const CHAIN_ID = 4663;

/** The asset classes a constituent can be tagged with. */
export const ASSET_CLASSES = /** @type {const} */ ([
	'rwa-equity',
	'crypto-major',
	'crypto-native',
	'stablecoin',
]);

/** Thrown for any non-2xx response, carrying the API's own error code. */
export class HoodPortfoliosError extends Error {
	/**
	 * @param {string} message
	 * @param {{ status?: number, code?: string }} [meta]
	 */
	constructor(message, meta = {}) {
		super(message);
		this.name = 'HoodPortfoliosError';
		this.status = meta.status;
		this.code = meta.code;
	}
}

/**
 * Canonical JSON: object keys sorted at every depth, no insignificant whitespace.
 *
 * This is the exact serialisation whose keccak256 `PortfolioRegistry.publish`
 * commits on-chain, so it is reproduced here rather than fetched. `JSON.stringify`
 * follows insertion order, which differs between the generator and any client
 * that round-tripped the document through a file, a URL or a database, and a
 * different byte string hashes to a different commitment.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalise(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
	const record = /** @type {Record<string, unknown>} */ (value);
	const keys = Object.keys(record).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(record[k])}`).join(',')}}`;
}

/**
 * Client for the Robinhood Chain portfolios API.
 *
 * @example
 * import { HoodPortfolios } from '@three-ws/hood-portfolios-sdk';
 *
 * const hood = new HoodPortfolios();
 * const equities = await hood.universe({ assetClass: 'rwa-equity', limit: 5 });
 * console.log(equities.tokens.map((t) => `${t.symbol} $${t.priceUsd}`));
 */
export class HoodPortfolios {
	/**
	 * @param {{ baseUrl?: string, fetch?: typeof globalThis.fetch, timeoutMs?: number }} [options]
	 */
	constructor(options = {}) {
		this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
		this.fetch = options.fetch || globalThis.fetch;
		this.timeoutMs = options.timeoutMs ?? 60_000;
		if (typeof this.fetch !== 'function') {
			throw new HoodPortfoliosError('no fetch implementation available; pass one as options.fetch');
		}
	}

	/** @private */
	async _request(path, { method = 'GET', body = null, query = null } = {}) {
		const url = new URL(`${this.baseUrl}/api/v1/hood-portfolios${path}`);
		for (const [k, v] of Object.entries(query || {})) {
			if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
		}

		const res = await this.fetch(url.toString(), {
			method,
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		let payload = null;
		try {
			payload = await res.json();
		} catch {
			payload = null;
		}
		if (!res.ok) {
			throw new HoodPortfoliosError(
				payload?.error_description || payload?.error || `request failed with HTTP ${res.status}`,
				{ status: res.status, code: payload?.error },
			);
		}
		return payload?.data ?? payload;
	}

	/**
	 * Every token a portfolio may hold, re-priced live on each call.
	 *
	 * @param {{ assetClass?: string|string[], minLiquidityUsd?: number, limit?: number, selectableOnly?: boolean }} [options]
	 */
	async universe(options = {}) {
		const assetClass = Array.isArray(options.assetClass) ? options.assetClass.join(',') : options.assetClass;
		return this._request('/universe', {
			query: {
				class: assetClass,
				minLiquidity: options.minLiquidityUsd,
				limit: options.limit,
				selectable: options.selectableOnly ? '1' : undefined,
			},
		});
	}

	/**
	 * Screen the universe against a sentence and return a validated basket plus
	 * its manifest and the hash that manifest commits to.
	 *
	 * @param {string} prompt
	 */
	async generate(prompt) {
		if (!prompt || !String(prompt).trim()) {
			throw new HoodPortfoliosError('a prompt is required');
		}
		return this._request('/generate', { method: 'POST', body: { prompt: String(prompt).trim() } });
	}

	/**
	 * Backtest a basket, and compare it against the same basket never rebalanced.
	 *
	 * Coverage is reported rather than assumed: a constituent with no price
	 * history is excluded and named, and `coveredWeightBps` says how much of the
	 * portfolio the result actually describes.
	 *
	 * @param {{ constituents: Array<{ address: string, weightBps: number }>, rebalanceDays?: number, days?: number }} request
	 */
	async backtest(request) {
		const constituents = request?.constituents || [];
		if (constituents.length < 2) {
			throw new HoodPortfoliosError('supply at least two constituents as [{ address, weightBps }]');
		}
		return this._request('/backtest', {
			method: 'POST',
			body: {
				constituents,
				rebalanceDays: request.rebalanceDays ?? 30,
				days: request.days ?? 90,
			},
		});
	}

	/**
	 * Canonicalise a manifest server-side and return the hash it commits to.
	 *
	 * Use this to check a manifest you were given against what is on-chain. To
	 * hash locally instead, `canonicalise()` from this package produces the exact
	 * bytes; keccak256 them with any library (`viem`'s `keccak256(toHex(bytes))`).
	 *
	 * @param {Record<string, unknown>} manifest
	 */
	async manifestHash(manifest) {
		return this._request('/manifest', { method: 'POST', body: { manifest } });
	}

	/** Whether the chain is answering, and how fresh the universe snapshot is. */
	async health() {
		return this._request('/health');
	}
}

export default HoodPortfolios;
