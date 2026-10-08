// zauthx402 SDK adapter for Vercel serverless.
//
// The upstream `@zauthx402/sdk/middleware` is shaped for Express: it expects
// `req.path`, `req.protocol`, `req.get(name)`, `req.originalUrl`, `req.ip`,
// and patches `res.json/send/end`. Our endpoints run as bare Vercel Node
// handlers (http.IncomingMessage / http.ServerResponse), so we shim the
// missing properties before invoking the middleware once per request.
//
// Disabled cleanly when ZAUTH_API_KEY is unset — `instrument()` becomes a
// no-op so unrelated environments don't pay any cost.
//
// The SDK is loaded lazily via a specifier neither esbuild nor @vercel/nft
// can see (base64, same trick as scripts/fix-zauth-sdk-solana-esm.mjs).
// Reason: this module sits on the _lib/http.js path, which every one of the
// ~800 API routes inlines — a static `import '@zauthx402/sdk'` embedded the
// SDK's viem/ox dependency tree (~2.7 MB of JS) into every route bundle,
// which pushed Vercel's per-function packaging past the 45-minute build
// timeout (deploys three-jo2b1vnto / three-bmb0n9nvt, 2026-07-03). With the
// specifier hidden, the SDK ships in a lambda only if some other code there
// pulls it in; when it is absent (or ZAUTH_API_KEY is unset) instrument()
// stays a no-op — telemetry off, requests unaffected.
//
// When the SDK does load, import the main entry — `zauthProvider` is
// re-exported there. The docs use `@zauthx402/sdk/middleware`, but that
// subpath's conditional exports (import/require split) don't survive
// bundling, so the main entry is the reliable one.

import { env } from './env.js';
import { clientIp } from './rate-limit.js';

let cached;
let _bootLogged = false;
let _initPromise;

// '@zauthx402/sdk' — kept out of source as a literal so static analyzers
// (esbuild inlining, NFT tracing) cannot follow it.
const SDK_SPECIFIER = atob('QHphdXRoeDQwMi9zZGs=');

function initMiddleware() {
	if (!_initPromise) {
		_initPromise = (async () => {
			let sdk = null;
			try {
				sdk = await import(SDK_SPECIFIER);
			} catch (err) {
				console.warn('[zauth] SDK not present in this deployment — telemetry disabled:', err?.message);
			}
			cached = sdk ? buildMiddleware(sdk) : null;
		})();
	}
	return _initPromise;
}

/**
 * Await the lazy SDK init (no-op resolve when ZAUTH_API_KEY is unset).
 * For tests and warmup paths that need `instrument()` active immediately;
 * production callers never need this — instrument() self-initializes.
 */
export function ensureReady() {
	return env.ZAUTH_API_KEY ? initMiddleware() : Promise.resolve();
}

// The SDK submits telemetry with a fire-and-forget `fetch` it never hands back
// a promise for, so on Vercel the function can freeze mid-POST and silently
// drop the event. We wrap `fetch` once (only when monitoring is enabled) to
// track in-flight POSTs to the zauth backend; `drain()` then awaits exactly
// those, capped — reliable delivery instead of a fixed-time guess. Only
// zauth-host requests are ever tracked; all other traffic passes through
// untouched and unobserved.
const ZAUTH_HOST = (process.env.ZAUTH_API_ENDPOINT || 'https://back.zauthx402.com')
	.replace(/^https?:\/\//, '')
	.replace(/\/.*$/, '');
const _inflight = new Set();
let _fetchWrapped = false;

// Circuit breaker for the telemetry collector. From the Vercel runtime the
// collector can be persistently unreachable ("fetch failed"), which both wastes
// drain time on every monitored request and spams a warning per call. After N
// consecutive failed submissions we trip the breaker: instrument() becomes a
// no-op (no POST, no drain) until a cooldown elapses — logged once on trip and
// once on recovery, not per request. State is per-lambda-instance, which is
// correct: it self-heals on expiry and a cold start re-probes.
const _CIRCUIT_THRESHOLD = Number(process.env.ZAUTH_CIRCUIT_FAILURE_THRESHOLD) || 5;
const _CIRCUIT_COOLDOWN_MS = Number(process.env.ZAUTH_CIRCUIT_COOLDOWN_MS) || 300_000;
let _collectorFailures = 0;
let _collectorDownUntil = 0;

function isCollectorDown() {
	return _collectorDownUntil > Date.now();
}

function noteCollectorSuccess() {
	_collectorFailures = 0;
	if (_collectorDownUntil) {
		_collectorDownUntil = 0;
		console.log('[zauth] collector recovered — telemetry resumed');
	}
}

function noteCollectorFailure(err) {
	// Individual failures are only interesting in debug mode; steady-state we want
	// a single line when the breaker trips, not one per request.
	if (env.ZAUTH_DEBUG === '1') console.warn('[zauth] telemetry delivery failed (non-fatal):', err?.message || err);
	if (isCollectorDown()) return;
	_collectorFailures += 1;
	if (_collectorFailures >= _CIRCUIT_THRESHOLD) {
		_collectorDownUntil = Date.now() + _CIRCUIT_COOLDOWN_MS;
		_collectorFailures = 0;
		console.warn(
			`[zauth] collector unreachable — pausing telemetry for ${Math.round(_CIRCUIT_COOLDOWN_MS / 60_000)}m`,
		);
	}
}

// The SDK's flush() early-returns while a previous batch is still submitting
// (`isFlushing`) and nothing ever re-triggers it, so an event queued during
// submission is stranded until some later request happens to queue another
// event on a warm lambda. With flush-per-event batching that hits the
// response event on every monitored request (queued at res.end while the
// request-event batch is in flight) — confirmed in production runtime logs.
// The middleware never hands back its internal client, so capture instances
// at the prototype level; drain() re-flushes any non-empty queue.
const _clients = new Set();
let _clientHooked = false;

function trackZauthClients(ZauthClient) {
	if (_clientHooked || typeof ZauthClient?.prototype?.queueEvent !== 'function') return;
	_clientHooked = true;
	const origQueueEvent = ZauthClient.prototype.queueEvent;
	ZauthClient.prototype.queueEvent = function (event) {
		_clients.add(this);
		return origQueueEvent.call(this, event);
	};
}

function trackZauthFetch() {
	if (_fetchWrapped || typeof globalThis.fetch !== 'function') return;
	_fetchWrapped = true;
	const realFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = (input, init) => {
		const url = typeof input === 'string' ? input : input?.url || '';
		const promise = realFetch(input, init);
		if (url.includes(ZAUTH_HOST)) {
			_inflight.add(promise);
			promise.then(
				() => {
					_inflight.delete(promise);
					noteCollectorSuccess();
					if (env.ZAUTH_DEBUG === '1') console.log('[zauth] Batch submitted');
				},
				// Telemetry is fire-and-forget: a transient blip reaching the collector
				// (or the lambda freezing mid-POST) is not a request failure. Feed the
				// circuit breaker, which logs once when the collector is sustainedly
				// down rather than once per request.
				(err) => {
					_inflight.delete(promise);
					noteCollectorFailure(err);
				},
			);
		}
		return promise;
	};
}

// The deploy environment reported to the Provider Hub dashboard. The SDK
// defaults to 'development'; without this, production telemetry would be
// mislabeled. VERCEL_ENV is 'production' | 'preview' | 'development' on Vercel.
function resolveEnvironment() {
	if (env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production') return 'production';
	return env.VERCEL_ENV || 'development';
}

function buildMiddleware(sdk) {
	const apiKey = env.ZAUTH_API_KEY;
	if (!apiKey) {
		if (env.ZAUTH_DEBUG === '1' && !_bootLogged) {
			console.log('[zauth] disabled: ZAUTH_API_KEY not set');
			_bootLogged = true;
		}
		return null;
	}
	try {
		// Vercel serverless freezes the function the moment res.end returns,
		// killing the SDK's default 5-second batch timer (and any in-flight
		// POST to back.zauthx402.com). Force flush-per-event so submission
		// starts immediately; the `drain()` helper below keeps the lambda
		// alive long enough for that POST to complete.
		const includeBodies = env.ZAUTH_INCLUDE_BODIES === '1';
		const evmKey = env.ZAUTH_REFUND_PRIVATE_KEY || undefined;
		const solKey = env.ZAUTH_SOLANA_PRIVATE_KEY || undefined;
		const refundEnabled = Boolean(evmKey || solKey);

		trackZauthClients(sdk.ZauthClient);
		const mw = sdk.zauthProvider(apiKey, {
			environment: resolveEnvironment(),
			shouldMonitor: shouldMonitorReq,
			debug: env.ZAUTH_DEBUG === '1',
			batching: { maxBatchSize: 1, maxBatchWaitMs: 0, retry: false },
			// Validate responses so the dashboard has health signal beyond status
			// codes. Our paid routes return JSON objects — reject empty collections
			// and bodies that only contain error fields.
			validation: {
				minResponseSize: 2,
				rejectEmptyCollections: true,
				errorFields: ['error', 'error_description'],
			},
			// Auto-refund callers who pay and then hit a genuine server-side
			// failure (5xx) or a timeout — NOT a valid empty result (see triggers).
			// Enabled only when at least one refund keypair is present. Caps are
			// set above our highest tool price ($0.05) with conservative daily/
			// monthly ceilings; all three are overridable via env without a deploy.
			refund: {
				enabled: refundEnabled,
				privateKey: evmKey,
				solanaPrivateKey: solKey,
				maxRefundUsd: Number(process.env.ZAUTH_REFUND_MAX_USD) || 0.1,
				dailyCapUsd: Number(process.env.ZAUTH_REFUND_DAILY_CAP_USD) || 25.0,
				monthlyCapUsd: Number(process.env.ZAUTH_REFUND_MONTHLY_CAP_USD) || 250.0,
				triggers: {
					serverError: true,
					// Anti-griefing: a valid empty result (search with zero matches, empty
					// claims window) is a normal billable outcome; auto-refunding it let
					// an attacker farm refunds up to the daily cap with empty-result
					// calls. Genuine failures still refund via serverError (5xx)/timeout.
					emptyResponse: false,
					timeout: true,
					schemaValidation: false,
				},
				onRefund: (r) => {
					console.log(
						`[zauth] refund executed: $${r.amountUsd} → ${r.recipient} on ${r.network} tx:${r.txHash}`,
					);
				},
				onRefundError: (e) => {
					console.error(`[zauth] refund failed for ${e.url}: ${e.error}`);
				},
			},
			// Privacy: the monitored routes are payment and MCP endpoints. Ship
			// status/timing/validation telemetry, but NOT the request/response
			// bodies (payment payloads, tool args) unless explicitly opted in.
			// The SDK validates responses locally and only reports the verdict,
			// so health classification is unaffected when bodies are withheld.
			telemetry: {
				includeRequestBody: includeBodies,
				includeResponseBody: includeBodies,
				// redactHeaders replaces (not merges) the SDK default list, so we
				// restate its entries and add every header that can carry a payment
				// proof, session, or secret on these routes.
				redactHeaders: [
					'authorization',
					'cookie',
					'set-cookie',
					'x-api-key',
					'x-api-secret',
					'x-payment',
					'x-payment-intent',
					'x-payment-signature',
					'x-payment-response',
					'payment-signature',
					'sign-in-with-x',
				],
			},
		});
		trackZauthFetch();
		if (!_bootLogged) {
			console.log(`[zauth] monitoring enabled (refunds:${refundEnabled ? 'on' : 'off'})`);
			_bootLogged = true;
		}
		return mw;
	} catch (err) {
		console.error('[zauth] failed to build middleware:', err.message);
		return null;
	}
}

// Paid x402 surfaces, by path. Two groups:
//   1. MCP servers + payer/dispatcher routes (each one settles x402 payments).
//   2. Agent payment routes (delegated x402 calls + invoice payments).
//
// /api/x402/* paid services are deliberately NOT path-monitored. Every x402
// buyer flow starts with an unpaid request that gets the mandatory 402
// challenge — a body whose first field is `error`, which the SDK's response
// validation records as a failed call. Path-monitoring those routes therefore
// reported protocol-correct discovery traffic as downtime on the Provider Hub
// (success rates of 0–60% on endpoints that were healthy). Those routes are
// instead reported via the payment-header condition below: a request that
// actually attempts payment is monitored end-to-end, so genuine post-payment
// failures (and verification rejections of real payment attempts) still
// reach the dashboard.
const MONITORED_SERVERS =
	/\/api\/(wk-x402|mcp|mcp-3d|mcp-agent|mcp-bazaar|pump-fun-mcp|ibm-mcp|x402-pay)(\/|$)/;
const MONITORED_AGENTS =
	/\/api\/agents\/x402\/|\/api\/agents\/[^/]+\/x402\/|\/api\/agents\/payments\//;

function shouldMonitorReq(req) {
	const h = req.headers || {};
	if (h['x-payment-intent'] || h['x-payment'] || h['payment-signature']) return true;
	const p = req.path || '';
	if (MONITORED_SERVERS.test(p)) return true;
	return MONITORED_AGENTS.test(p);
}

/**
 * Diagnostic snapshot — does not invoke the middleware. Returns whether the
 * SDK initialized successfully and a key prefix safe to surface in responses.
 * Kicks off the lazy SDK init so a status probe (or first request) warms it;
 * `initialized` reads false until that async init settles.
 */
export function status() {
	const apiKey = env.ZAUTH_API_KEY;
	if (apiKey && cached === undefined) void initMiddleware();
	return {
		initialized: cached != null,
		hasKey: Boolean(apiKey),
		keyPrefix: apiKey ? apiKey.slice(0, 14) : null,
		environment: resolveEnvironment(),
		debug: env.ZAUTH_DEBUG === '1',
		refunds: {
			enabled: Boolean(env.ZAUTH_REFUND_PRIVATE_KEY || env.ZAUTH_SOLANA_PRIVATE_KEY),
			evm: Boolean(env.ZAUTH_REFUND_PRIVATE_KEY),
			solana: Boolean(env.ZAUTH_SOLANA_PRIVATE_KEY),
		},
	};
}

function shimResponse(res) {
	// The Express middleware does `res.json.bind(res)` / `res.send.bind(res)`
	// up-front, even if the handler never calls them. Provide Express-shaped
	// no-op fallbacks (delegating to `res.end`) so binding works. Our handlers
	// only call `res.end` directly, so these patched versions are never run.
	if (typeof res.json !== 'function') {
		res.json = function (body) {
			if (!res.getHeader('content-type')) {
				res.setHeader('content-type', 'application/json; charset=utf-8');
			}
			res.end(JSON.stringify(body));
		};
	}
	if (typeof res.send !== 'function') {
		res.send = function (body) {
			res.end(typeof body === 'string' ? body : JSON.stringify(body));
		};
	}
}

function shimRequest(req) {
	const url = req.url || '/';
	const qIdx = url.indexOf('?');
	const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
	const xfProto = req.headers['x-forwarded-proto'];
	const protocol = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || 'https';
	const ip = clientIp(req);

	if (!('path' in req)) Object.defineProperty(req, 'path', { value: path });
	if (!('originalUrl' in req)) Object.defineProperty(req, 'originalUrl', { value: url });
	if (!('protocol' in req)) Object.defineProperty(req, 'protocol', { value: protocol });
	if (!('ip' in req)) Object.defineProperty(req, 'ip', { value: ip });
	if (typeof req.get !== 'function') {
		req.get = (name) => {
			const v = req.headers[String(name).toLowerCase()];
			return Array.isArray(v) ? v[0] : v;
		};
	}
	// `req.body` is undefined on raw Vercel handlers; the SDK only reads it
	// for an optional byte-size estimate, so leaving it undefined is fine.
}

/**
 * Run the zauth middleware once for this request. Safe to call on every
 * request — internal `shouldMonitor` filters non-x402 traffic. Returns
 * `true` if this request will be reported (caller should `await drain()`
 * after `res.end` to keep the lambda alive long enough to flush).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean}
 */
export function instrument(req, res) {
	// Fast path: no key, no SDK load, no monitoring — the common case in every
	// environment where zauth isn't configured.
	if (!env.ZAUTH_API_KEY) return false;
	// First keyed request kicks off the async SDK load; monitoring starts once
	// it settles (requests during init go unmonitored, which telemetry can
	// tolerate — request handling never waits on the import).
	if (cached === undefined) {
		void initMiddleware();
		return false;
	}
	const mw = cached;
	if (!mw) return false;
	// Collector circuit breaker tripped: skip monitoring entirely (no POST, no
	// drain await) until the cooldown elapses. Returning false means the caller
	// won't await drain() for this request.
	if (isCollectorDown()) return false;
	// Idempotency: dispatcher routes (wk.js, x402/service.js) run wrap() at the
	// top level AND invoke paidEndpoint-built handlers (also wrap()-ed) inside —
	// without this guard the SDK middleware would observe and report the same
	// request twice.
	if (req.__zauthInstrumented) return req.__zauthMonitored === true;
	req.__zauthInstrumented = true;
	try {
		shimRequest(req);
		shimResponse(res);
		const monitored = shouldMonitorReq(req);
		mw(req, res, () => {});
		req.__zauthMonitored = monitored;
		return monitored;
	} catch (err) {
		console.error('[zauth] middleware error:', err.message);
		return false;
	}
}

/**
 * Hold the lambda open until the SDK's telemetry actually reaches the zauth
 * backend, so Vercel doesn't freeze the function mid-flush and drop events.
 * Awaits the tracked in-flight POSTs AND re-flushes any event the SDK
 * stranded in its queue while a previous batch was submitting (its flush()
 * early-returns on `isFlushing` and never reschedules). Capped by
 * ZAUTH_DRAIN_MAX_MS (default 1500ms) so a hung backend can never stall the
 * response runtime. Only call this on requests where `instrument()` returned
 * true.
 */
export async function drain() {
	const capMs = Number(process.env.ZAUTH_DRAIN_MAX_MS) || 1500;
	const deadline = Date.now() + capMs;
	// The first POST may be scheduled on the next microtask; give it a beat
	// to register before deciding there is nothing to wait for.
	if (_inflight.size === 0) await beat(50);
	while (Date.now() < deadline) {
		if (_inflight.size > 0) {
			// A settling batch can strand an event queued meanwhile (see
			// trackZauthClients) — loop back and re-check the queues after.
			await settleInflight(deadline - Date.now());
			continue;
		}
		const stranded = [..._clients].filter((c) => c.eventQueue?.length && !c.isFlushing);
		if (stranded.length > 0) {
			await Promise.race([
				Promise.allSettled(stranded.map((c) => c.flush())),
				beat(deadline - Date.now()),
			]);
			continue;
		}
		// Queues empty; if a flush is mid-flight without its fetch registered
		// yet, give it a beat — otherwise everything is delivered.
		if ([..._clients].some((c) => c.isFlushing)) {
			await beat(25);
			continue;
		}
		return;
	}
}

function beat(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function settleInflight(capMs) {
	const pending = Promise.allSettled([..._inflight]);
	return Promise.race([pending, beat(capMs)]);
}
