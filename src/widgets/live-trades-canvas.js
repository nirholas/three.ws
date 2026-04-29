/**
 * Live Trades Canvas Widget
 *
 * Polls getTokenTrades via /api/pump-fun-mcp and renders each new trade as a
 * 2D canvas particle. Buys are green, sells are red. Particle radius scales
 * with log(USD value) so a $10k trade is visually distinct from a $10 trade.
 * Particles drift and fade over 5–10 seconds, then are removed.
 *
 * Config (validated in widget-types.js):
 *   - mint     (required) solana base58 mint address
 *   - chain    'solana' (v1 only)
 *   - bg       background hex color (default '#0a0a0a')
 *   - minUsd   filter: skip trades below this USD value (default 0)
 */

const POLL_MS = 6_000;
const FADE_MS = 8_000;
const MIN_RADIUS = 6;
const MAX_RADIUS = 48;
const MCP_ENDPOINT = '/api/pump-fun-mcp';

/**
 * Fetch recent trades for a mint via the in-house pump-fun MCP endpoint.
 * Returns an array of normalized trade objects or null on error.
 *
 * @param {string} mint
 * @param {number} limit
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Array<{signature:string,isBuy:boolean,solAmount:number,usdValue:number,timestamp:number}>|null>}
 */
export async function fetchTrades(mint, limit = 20, fetchImpl = globalThis.fetch) {
	let res;
	try {
		res = await fetchImpl(MCP_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'getTokenTrades', arguments: { mint, limit } },
			}),
		});
	} catch {
		return null;
	}
	if (!res.ok) return null;
	let body;
	try {
		body = await res.json();
	} catch {
		return null;
	}
	const content = body?.result?.content;
	if (!Array.isArray(content) || !content.length) return null;
	let data;
	try {
		data = typeof content[0].text === 'string' ? JSON.parse(content[0].text) : content[0];
	} catch {
		return null;
	}
	const rawTrades = data?.trades ?? data?.items ?? (Array.isArray(data) ? data : null);
	if (!rawTrades) return null;
	return rawTrades.map((t) => ({
		signature: t.signature ?? t.tx ?? String(Math.random()),
		isBuy: t.is_buy ?? t.isBuy ?? t.direction === 'buy' ?? true,
		solAmount: Number(t.sol_amount ?? t.solAmount ?? 0),
		usdValue: Number(t.usd_value ?? t.usdValue ?? t.sol_amount ?? 0),
		timestamp: t.timestamp ?? t.block_time ?? Date.now() / 1000,
	}));
}

/**
 * Compute new trades that weren't in the previous set.
 *
 * @param {Array} incoming   freshly fetched trades (newest-first expected)
 * @param {Set<string>} seen  signatures already shown
 * @param {number} minUsd     filter threshold
 * @returns {Array}
 */
export function filterNewTrades(incoming, seen, minUsd = 0) {
	if (!Array.isArray(incoming)) return [];
	return incoming.filter((t) => {
		if (seen.has(t.signature)) return false;
		if (t.usdValue < minUsd) return false;
		return true;
	});
}

function particleRadius(usdValue) {
	if (!usdValue || usdValue <= 0) return MIN_RADIUS;
	const r = MIN_RADIUS + Math.log10(Math.max(1, usdValue)) * 4;
	return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));
}

/**
 * Mount the live-trades canvas widget inside `rootEl`.
 *
 * @param {HTMLElement} rootEl   container element (position:relative expected)
 * @param {object}      opts
 * @param {string}      opts.mint
 * @param {string}      [opts.chain]
 * @param {string}      [opts.bg]
 * @param {number}      [opts.minUsd]
 * @param {typeof fetch} [opts.fetchImpl]   injectable for tests
 * @returns {{ destroy(): void }}
 */
export function mountLiveTradesCanvas(rootEl, opts = {}) {
	const mint = opts.mint || '';
	const bg = opts.bg || '#0a0a0a';
	const minUsd = Number(opts.minUsd ?? 0);
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

	const canvas = document.createElement('canvas');
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
	rootEl.style.position = 'relative';
	rootEl.appendChild(canvas);

	const ctx2d = canvas.getContext('2d');

	let particles = [];
	const seen = new Set();
	let rafId = null;
	let pollTimer = null;
	let destroyed = false;

	function resize() {
		const w = rootEl.clientWidth || 400;
		const h = rootEl.clientHeight || 300;
		const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		ctx2d.scale(dpr, dpr);
	}

	let ro = null;
	if (typeof ResizeObserver !== 'undefined') {
		ro = new ResizeObserver(() => resize());
		ro.observe(rootEl);
	}
	resize();

	function spawnParticle(trade) {
		const w = rootEl.clientWidth || 400;
		const h = rootEl.clientHeight || 300;
		const r = particleRadius(trade.usdValue);
		particles.push({
			x: r + Math.random() * (w - r * 2),
			y: r + Math.random() * (h - r * 2),
			vx: (Math.random() - 0.5) * 1.2,
			vy: (Math.random() - 0.5) * 1.2,
			r,
			isBuy: trade.isBuy,
			born: performance.now(),
		});
	}

	function draw(now) {
		if (destroyed) return;
		const w = rootEl.clientWidth || 400;
		const h = rootEl.clientHeight || 300;

		ctx2d.clearRect(0, 0, w, h);
		ctx2d.fillStyle = bg;
		ctx2d.fillRect(0, 0, w, h);

		particles = particles.filter((p) => {
			const age = now - p.born;
			return age < FADE_MS;
		});

		for (const p of particles) {
			const age = now - p.born;
			const alpha = Math.max(0, 1 - age / FADE_MS);

			p.x += p.vx;
			p.y += p.vy;
			p.vx *= 0.99;
			p.vy *= 0.99;

			ctx2d.globalAlpha = alpha;
			ctx2d.beginPath();
			ctx2d.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx2d.fillStyle = p.isBuy ? '#22c55e' : '#ef4444';
			ctx2d.fill();

			ctx2d.globalAlpha = alpha * 0.35;
			ctx2d.strokeStyle = p.isBuy ? '#86efac' : '#fca5a5';
			ctx2d.lineWidth = 1.5;
			ctx2d.stroke();
		}
		ctx2d.globalAlpha = 1;

		rafId = requestAnimationFrame(draw);
	}

	async function poll() {
		if (destroyed || !mint) return;
		const trades = await fetchTrades(mint, 20, fetchImpl);
		const fresh = filterNewTrades(trades, seen, minUsd);
		for (const t of fresh) {
			seen.add(t.signature);
			spawnParticle(t);
		}
		// keep seen set bounded
		if (seen.size > 500) {
			const arr = [...seen];
			arr.splice(0, arr.length - 200).forEach((s) => seen.delete(s));
		}
	}

	poll();
	pollTimer = setInterval(poll, POLL_MS);
	rafId = requestAnimationFrame(draw);

	return {
		destroy() {
			destroyed = true;
			if (rafId !== null) cancelAnimationFrame(rafId);
			if (pollTimer !== null) clearInterval(pollTimer);
			ro?.disconnect();
			canvas.remove();
		},
	};
}
