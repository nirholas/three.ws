// agent-sniper — HTTP API face (sniper-as-a-service).
//
// Exposes the engine over HTTP so other agents/users can pay to arm strategies
// and trigger snipes. Reads are free; the three MUTATING endpoints (arm a
// strategy, fire a snipe, disarm a strategy) are gated behind x402 USDC
// micropayments via @three-ws/x402-server's `paid()` middleware — verify the
// X-PAYMENT header against the facilitator, run the work, settle on-chain, emit
// the receipt. The same verify → dispatch → settle order the platform enforces.
//
//   import { createSniperApi, serve } from '@three-ws/agent-sniper/api';
//   await serve({ payTo: { solana: '<merchant>' } }, { port: 8787 });
//
// Zero three.ws backend imports — only local package files, express (optional),
// and the published @three-ws/x402-server SDK.

import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paid } from '@three-ws/x402-server';
import { presets, createMemoryStore } from '../index.js';

// The web console is a single self-contained HTML file shipped with the package.
// Read it once, lazily, and cache it — a serve() that never gets a browser hit
// pays nothing; one that does serves from memory.
const CONSOLE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'console.html');
let _consoleHtml = null;
function consoleHtml() {
	if (_consoleHtml == null) {
		try { _consoleHtml = readFileSync(CONSOLE_PATH, 'utf8'); }
		catch { _consoleHtml = ''; }
	}
	return _consoleHtml;
}

// Constant-time string compare for the admin token — avoids leaking length/prefix
// through response timing.
function safeEqual(a, b) {
	const ab = Buffer.from(String(a));
	const bb = Buffer.from(String(b));
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

// 1 SOL = 1e9 lamports. The wire takes human SOL amounts; the engine + store
// speak lamports (string-encoded BigInt, mirroring the Strategy contract).
const LAMPORTS_PER_SOL = 1_000_000_000n;

// Default per-endpoint prices in USDC atomic units (6 decimals): 10000 = $0.01,
// 50000 = $0.05, 5000 = $0.005. Overridable via deps.prices.
const DEFAULT_PRICES = {
	arm: '10000',     // POST /strategies      → $0.01
	snipe: '50000',   // POST /snipe           → $0.05
	disarm: '5000',   // POST /strategies/:id/disarm → $0.005
	close: '5000',    // POST /positions/:id/close   → $0.005
};

/**
 * Lazily resolve express (an optional dependency). A deployment that never
 * mounts the HTTP face shouldn't have to install it; one that does gets a clear
 * instruction instead of an opaque module-not-found.
 */
async function loadExpress() {
	try {
		const mod = await import('express');
		return mod.default || mod;
	} catch {
		throw new Error('express is required for the HTTP API face — install it');
	}
}

// Convert a human SOL amount (number|string) into a lamports BigInt string.
// Returns null on anything non-finite/negative so the caller can 400 cleanly.
function solToLamportsString(sol) {
	const n = Number(sol);
	if (!Number.isFinite(n) || n < 0) return null;
	// Carry 9 decimals of precision, then drop the fraction — lamports are integer.
	const lamports = (BigInt(Math.round(n * 1e9)) * LAMPORTS_PER_SOL) / 1_000_000_000n;
	return lamports.toString();
}

/**
 * Build the Express router that mounts every sniper endpoint. Free reads mount
 * directly; the three mutating routes are wrapped in `paid()` when payTo is
 * configured, or a 503 guard when it is not (so the server still boots for
 * local/dev without payment config).
 *
 * @param {object} deps
 * @param {ReturnType<import('../engine.js').createSniper>} [deps.sniper]  started/unstarted handle; built from presets.local when omitted.
 * @param {import('../types.js').Store} [deps.store]  defaults to sniper-bound memory store.
 * @param {{ solana?: string, base?: string }} [deps.payTo]  merchant wallet(s); env fallback X402_PAY_TO_SOLANA / X402_PAY_TO_BASE.
 * @param {Record<string,string>} [deps.prices]  per-endpoint USDC atomic prices ({ arm, snipe, disarm }).
 * @param {string} [deps.facilitatorUrl]  x402 facilitator base URL for /verify + /settle.
 * @param {string} [deps.feePayer]  Solana facilitator sponsor fee-payer; env fallback X402_FEE_PAYER_SOLANA. The Solana lane self-disables without it.
 * @param {string} [deps.adminToken]  operator token; env fallback SNIPER_ADMIN_TOKEN. A request carrying it (Authorization: Bearer / X-Admin-Token) bypasses x402 — the owner's own console mutates free while external agents still pay.
 */
export async function createSniperApiRouter(deps = {}) {
	const express = await loadExpress();

	const sniper = deps.sniper || (await presets.local());
	// Reuse the sniper's own store when the caller didn't pass one. presets.local
	// builds a memory store and hands it to createSniper, but doesn't surface it —
	// so an omitted store means an omitted sniper too, where we fall back to a
	// fresh memory store that shares nothing. Prefer an explicit deps.store.
	const store = deps.store || createMemoryStore();

	const payTo = {
		solana: deps.payTo?.solana || process.env.X402_PAY_TO_SOLANA || null,
		base: deps.payTo?.base || process.env.X402_PAY_TO_BASE || null,
	};
	// PayAI's Solana facilitator rejects an accept without a sponsor fee-payer, and
	// paid() throws a 500 at challenge time if asked to advertise a Solana lane it
	// can't honor. Resolve the fee-payer first so we can actually self-disable the
	// Solana lane when it's absent — dropping to the Base lane (or the 503 guard)
	// instead of 500-ing every paid request.
	const feePayer = deps.feePayer || process.env.X402_FEE_PAYER_SOLANA || undefined;

	const lanes = {};
	if (payTo.solana && feePayer) {
		lanes.solana = payTo.solana;
	} else if (payTo.solana && !feePayer) {
		console.warn(
			'[agent-sniper] X402_PAY_TO_SOLANA is set but X402_FEE_PAYER_SOLANA is not — ' +
			'the Solana lane needs a facilitator sponsor fee-payer and has been disabled. ' +
			'Set X402_FEE_PAYER_SOLANA to enable it; the Base lane (if configured) is unaffected.',
		);
	}
	if (payTo.base) lanes.base = payTo.base;
	const x402Configured = Object.keys(lanes).length > 0;

	const prices = { ...DEFAULT_PRICES, ...(deps.prices || {}) };
	const facilitator = deps.facilitatorUrl || process.env.X402_FACILITATOR_URL || undefined;

	// Operator token. When set, a request presenting it bypasses the x402 gate —
	// the owner's own web console can arm/snipe/disarm without paying itself, while
	// unauthenticated external agents still hit the paid path.
	const adminToken = deps.adminToken || process.env.SNIPER_ADMIN_TOKEN || null;
	const isAdmin = (req) => {
		if (!adminToken) return false;
		const auth = req.headers.authorization;
		const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
		const hdr = typeof req.headers['x-admin-token'] === 'string' ? req.headers['x-admin-token'].trim() : null;
		const provided = bearer || hdr;
		return Boolean(provided) && safeEqual(provided, adminToken);
	};

	const router = express.Router();
	router.use(express.json({ limit: '64kb' }));

	// Permissive CORS so any agent/browser can call the service; preflight is
	// answered here before any route runs.
	router.use((req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT, Authorization, X-Admin-Token');
		res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, X-PAYMENT-RESPONSE');
		if (req.method === 'OPTIONS') return res.status(204).end();
		return next();
	});

	// Wrap a mutating handler behind access control. Three paths, checked per request:
	//   1. admin token present  → run the handler directly (operator bypass);
	//   2. x402 configured       → require an x402 payment via paid();
	//   3. neither               → 503 (server still boots for local/dev).
	function gate(priceKey, handler) {
		const runDirect = (req, res) =>
			Promise.resolve(handler(req, res, { admin: true })).catch(req._onError);

		const paidPath = x402Configured
			? paid(
				{
					price: prices[priceKey],
					asset: 'usdc',
					payTo: lanes,
					facilitator,
					feePayer,
					description: 'agent-sniper paid endpoint',
					serviceName: 'agent-sniper',
				},
				// paid()'s node adapter invokes (req, res, payment); our handlers are
				// async and own the response. Boundary errors are caught here and
				// forwarded to the error handler via the captured `next`.
				(req, res, payment) => Promise.resolve(handler(req, res, payment)).catch(req._onError),
			)
			: (req, res) => res.status(503).json({
				error: adminToken
					? 'payment required: send the admin token (Authorization: Bearer / X-Admin-Token) or configure x402 (X402_PAY_TO_SOLANA).'
					: 'x402 not configured: set payTo.solana or X402_PAY_TO_SOLANA (or SNIPER_ADMIN_TOKEN for an operator console).',
			});

		return (req, res, next) => {
			if (isAdmin(req)) return runDirect(req, res);
			return paidPath(req, res, next);
		};
	}

	// Capture express's `next` for the paid handlers (paid()'s node adapter calls
	// the handler with (req, res, payment) and no next), so a thrown boundary
	// error still reaches the shared error handler.
	router.use((req, res, next) => {
		req._onError = next;
		next();
	});

	// ── Web console ───────────────────────────────────────────────────────────────
	// The operator dashboard, served from the same origin as the API it drives.
	// GET / and GET /console both return it; every fetch it makes is same-origin.
	const serveConsole = (req, res) => {
		const html = consoleHtml();
		if (!html) return res.status(404).json({ error: 'web console asset not found' });
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.setHeader('Cache-Control', 'no-cache');
		return res.send(html);
	};
	router.get('/', serveConsole);
	router.get('/console', serveConsole);

	// ── Free reads ──────────────────────────────────────────────────────────────

	// What the console needs to render the right controls: is there a paid lane,
	// and is an operator token configured (so mutations are reachable at all).
	const capabilities = () => ({ paid: x402Configured, adminAuth: Boolean(adminToken), prices });

	// GET /health — liveness + a snapshot of network/mode/stats.
	router.get('/health', (req, res) => {
		res.json({
			ok: true,
			network: sniper.config.network,
			mode: sniper.config.mode,
			stats: sniper.stats(),
			capabilities: capabilities(),
		});
	});

	// GET /status — full stats plus the immutable runtime config.
	router.get('/status', (req, res) => {
		res.json({ stats: sniper.stats(), config: sniper.config, capabilities: capabilities() });
	});

	// GET /activity?limit= — recent engine screen events (newest last) for the feed.
	router.get('/activity', (req, res) => {
		const limit = Math.max(1, Math.min(Number(req.query.limit) || 60, 250));
		const events = typeof sniper.activity === 'function' ? sniper.activity(limit) : [];
		res.json({ events });
	});

	// GET /strategies — the armed strategy set the engine is evaluating.
	router.get('/strategies', (req, res) => {
		res.json({ strategies: sniper.strategies() });
	});

	// GET /positions?agentId=&status= — list positions from the store.
	router.get('/positions', (req, res, next) => {
		const query = {};
		if (typeof req.query.agentId === 'string') query.agentId = req.query.agentId;
		if (typeof req.query.status === 'string') query.status = req.query.status;
		Promise.resolve(
			typeof store.listPositions === 'function'
				? store.listPositions(query)
				: [],
		)
			.then((positions) => res.json({ positions }))
			.catch(next);
	});

	// ── Paid mutations ───────────────────────────────────────────────────────────

	// POST /strategies — arm a new strategy. SOL budgets convert to lamports; a
	// stop-loss is mandatory (the engine refuses to arm without one).
	router.post('/strategies', gate('arm', async (req, res) => {
		const body = req.body || {};
		if (body.stop_loss_pct == null) {
			return res.status(400).json({ error: 'stop_loss_pct is required — the engine will not arm a strategy without a stop-loss.' });
		}
		const perTrade = solToLamportsString(body.per_trade_sol);
		const dailyBudget = solToLamportsString(body.daily_budget_sol);
		if (perTrade == null || dailyBudget == null) {
			return res.status(400).json({ error: 'per_trade_sol and daily_budget_sol must be non-negative numbers.' });
		}

		const strategy = {
			...body,
			id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `strat_${randomUUID()}`,
			agent_id: typeof body.agent_id === 'string' && body.agent_id ? body.agent_id : `agent_${randomUUID().slice(0, 8)}`,
			enabled: body.enabled !== false,
			network: body.network === 'devnet' ? 'devnet' : 'mainnet',
			per_trade_lamports: perTrade,
			daily_budget_lamports: dailyBudget,
			stop_loss_pct: Number(body.stop_loss_pct),
		};
		// Drop the human-facing SOL fields — the stored row speaks lamports.
		delete strategy.per_trade_sol;
		delete strategy.daily_budget_sol;

		const stored = await store.addStrategy(strategy);
		return res.status(201).json({ strategy: stored });
	}));

	// POST /snipe — force a snipe on { mint, symbol?, agentId? }. Bypasses the
	// scorer (force:true) so every armed strategy attempts the buy immediately.
	router.post('/snipe', gate('snipe', async (req, res) => {
		const body = req.body || {};
		const mint = typeof body.mint === 'string' ? body.mint.trim() : '';
		if (!mint) {
			return res.status(400).json({ error: 'mint is required.' });
		}
		const candidate = { mint };
		if (typeof body.symbol === 'string' && body.symbol) candidate.symbol = body.symbol;
		if (typeof body.agentId === 'string' && body.agentId) candidate.agent_id = body.agentId;

		sniper.submitCandidate(candidate, { force: true });
		return res.status(202).json({ ok: true, queued: true, mint });
	}));

	// POST /strategies/:id/disarm — flip a strategy off (enabled=false). The
	// engine drops it on the next strategy-cache refresh.
	router.post('/strategies/:id/disarm', gate('disarm', async (req, res) => {
		const id = req.params.id;
		if (typeof store.disableStrategy === 'function') {
			const ok = await store.disableStrategy(id);
			return res.status(ok ? 200 : 404).json(ok ? { ok: true, id, enabled: false } : { error: 'strategy not found' });
		}
		// Memory store: re-add the row with enabled=false (addStrategy upserts by id).
		const current = sniper.strategies().find((s) => s.id === id);
		if (!current && typeof store.removeStrategy !== 'function') {
			return res.status(404).json({ error: 'strategy not found' });
		}
		if (typeof store.addStrategy === 'function' && current) {
			await store.addStrategy({ ...current, enabled: false });
			return res.status(200).json({ ok: true, id, enabled: false });
		}
		return res.status(404).json({ error: 'strategy not found' });
	}));

	// POST /positions/:id/close — schedule an exit. Flips the position's kill switch;
	// the next position sweep sells it through the normal exit path (same as the MCP
	// close_position tool), so the response is { scheduled: true } — the sell lands shortly.
	router.post('/positions/:id/close', gate('close', async (req, res) => {
		if (typeof store.listPositions !== 'function' || typeof store.updatePosition !== 'function') {
			return res.status(501).json({ error: 'store does not support closing positions' });
		}
		const id = req.params.id;
		const all = await store.listPositions({ network: sniper.config.network });
		const pos = all.find((p) => p.id === id);
		if (!pos) return res.status(404).json({ error: 'position not found' });
		if (pos.status === 'closed' || pos.status === 'failed') {
			return res.status(200).json({ ok: true, scheduled: false, id, status: pos.status, note: 'position already terminal' });
		}
		await store.updatePosition(id, { kill_switch: true });
		return res.status(202).json({ ok: true, scheduled: true, id });
	}));

	return router;
}

/**
 * Build a complete Express app exposing the sniper API. Mounts the router at the
 * root and attaches a JSON error handler.
 *
 * @param {Parameters<typeof createSniperApiRouter>[0]} [deps]
 */
export async function createSniperApi(deps = {}) {
	const express = await loadExpress();
	const app = express();
	app.disable('x-powered-by');

	const router = await createSniperApiRouter(deps);
	app.use(router);

	// 404 for anything unmatched.
	app.use((req, res) => {
		res.status(404).json({ error: 'not found' });
	});

	// Boundary error handler: map known x402/facilitator statuses, default 500.
	// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity (4 args).
	app.use((err, req, res, next) => {
		const status = Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
		if (!res.headersSent) {
			res.status(status).json({ error: err?.message || 'internal error' });
		}
	});

	// Stash the resolved handle so serve() can start it without rebuilding.
	app.locals.sniper = deps.sniper;
	return app;
}

/**
 * Build the app, start the sniper if it isn't running, and listen.
 *
 * @param {Parameters<typeof createSniperApiRouter>[0]} [deps]
 * @param {object} [opts]
 * @param {number} [opts.port]
 */
export async function serve(deps = {}, { port = Number(process.env.PORT) || 8787 } = {}) {
	// Resolve the sniper once so the API and the start() call share one handle.
	const sniper = deps.sniper || (await presets.local());
	const app = await createSniperApi({ ...deps, sniper });

	// Start the trade loop if it isn't already running. The handle is idempotent-
	// safe to call once; a double start would double-subscribe the feed, so we
	// track it with a flag on the handle.
	if (!sniper.__started) {
		await sniper.start();
		sniper.__started = true;
	}

	return await new Promise((resolve) => {
		const server = app.listen(port, () => {
			// eslint-disable-next-line no-console -- this is a server entry point.
			console.log(`[agent-sniper] HTTP API + console on http://localhost:${port}  (${sniper.config.network}/${sniper.config.mode})`);
			resolve({ app, server, sniper });
		});
	});
}

// Runnable as an entry point: `node src/faces/api.js`. The pathToFileURL compare
// is the ESM equivalent of `require.main === module` — true only when this file
// is the process entry, not when it's imported.
const isProcessEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isProcessEntryPoint) {
	serve().catch((err) => {
		console.error(`[agent-sniper] failed to start HTTP API: ${err?.message || err}`);
		process.exitCode = 1;
	});
}

export default { createSniperApi, createSniperApiRouter, serve };
