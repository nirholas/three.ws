// @ts-check
// Distributed tracing for the API process, exported to Google Cloud Trace.
//
// Deliberately dependency-free. The OpenTelemetry JS SDK plus auto-instrumentation
// is a ~50 MB tree with a cold-start cost (see sentry.js, which avoids it for the
// same reason), so this module speaks the two open formats directly: W3C
// `traceparent` for propagation and OTLP/HTTP JSON to
// https://telemetry.googleapis.com/v1/traces for export. Spans from the Python
// workers (workers/<w>/tracing.py) use the same wire formats, so one Forge
// request is one trace across the API and every worker it fans out to.
//
// Cost model:
// - Not sampled (the default for most requests): ids are minted and propagated so
//   a downstream worker can still join the trace, but nothing is recorded, no
//   timer is armed and no network call is ever made.
// - Sampled: finished spans are buffered and flushed in batches off the request
//   path. Export failure is logged once a minute and never reaches a caller.
//
// Configuration (all optional):
//   TRACE_SAMPLE_RATE   0..1 share of root requests to record. Default 0.05 on
//                       Cloud Run (K_SERVICE set), 0 elsewhere so a dev box and
//                       the test suite never export.
//   TRACE_PROJECT       Cloud project that owns the traces (default
//                       GOOGLE_CLOUD_PROJECT, then aerial-vehicle-466722-p5).
//   TRACE_ENDPOINT      OTLP traces URL (default the Google Telemetry API).
// An inbound `traceparent` with the sampled flag set is always recorded, which is
// how a worker-initiated or hand-forced trace (curl with `-01`) is captured.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

const DEFAULT_PROJECT = 'aerial-vehicle-466722-p5';
const DEFAULT_ENDPOINT = 'https://telemetry.googleapis.com/v1/traces';
const FLUSH_MS = 5_000;
const MAX_BATCH = 100;
const MAX_QUEUE = 2_000;
const WARN_EVERY_MS = 60_000;

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** @typedef {{ traceId: string, spanId: string, sampled: boolean }} SpanContext */

/** @type {AsyncLocalStorage<Span>} */
const als = new AsyncLocalStorage();

/** Parse a W3C traceparent header. Returns null for anything malformed or all-zero. */
export function parseTraceparent(value) {
	if (typeof value !== 'string') return null;
	const m = TRACEPARENT.exec(value.trim().toLowerCase());
	if (!m || m[1] === 'ff') return null;
	if (/^0+$/.test(m[2]) || /^0+$/.test(m[3])) return null;
	return { traceId: m[2], spanId: m[3], sampled: (parseInt(m[4], 16) & 1) === 1 };
}

/** @param {SpanContext} ctx */
export function formatTraceparent(ctx) {
	return `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;
}

export const newTraceId = () => randomBytes(16).toString('hex');
export const newSpanId = () => randomBytes(8).toString('hex');

function readEnv(name) {
	const v = process.env[name];
	return v && v.trim() ? v.trim() : null;
}

export function sampleRate() {
	const raw = readEnv('TRACE_SAMPLE_RATE');
	if (raw != null) {
		const n = Number(raw);
		return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
	}
	return readEnv('K_SERVICE') ? 0.05 : 0;
}

/** Coarse client class for the root span, never the raw user-agent. */
export function userAgentClass(ua) {
	const s = String(ua || '').toLowerCase();
	if (!s) return 'none';
	if (/bot|crawler|spider|slurp|facebookexternalhit|preview/.test(s)) return 'bot';
	if (/curl|wget|python|node|go-http|axios|undici|okhttp|httpie/.test(s)) return 'cli';
	if (/mozilla|safari|chrome|firefox/.test(s)) return 'browser';
	return 'other';
}

class Span {
	/**
	 * @param {{ name: string, kind: number, traceId: string, parentSpanId: string | null, sampled: boolean, attrs?: Record<string, any> }} init
	 */
	constructor(init) {
		this.name = init.name;
		this.kind = init.kind;
		this.traceId = init.traceId;
		this.spanId = newSpanId();
		this.parentSpanId = init.parentSpanId;
		this.sampled = init.sampled;
		this.attrs = { ...(init.attrs || {}) };
		this.startMs = Date.now();
		this.startHr = process.hrtime.bigint();
		this.endNs = null;
		this.error = null;
		this.ended = false;
	}

	/** @param {string} key @param {any} value */
	setAttribute(key, value) {
		if (this.sampled && value != null) this.attrs[key] = value;
	}

	/** @param {unknown} err */
	recordError(err) {
		if (!this.sampled || err == null) return;
		this.error = String(/** @type {any} */ (err)?.message || err).slice(0, 300);
	}

	get context() {
		return { traceId: this.traceId, spanId: this.spanId, sampled: this.sampled };
	}

	end() {
		if (this.ended) return;
		this.ended = true;
		if (!this.sampled) return;
		this.endNs = process.hrtime.bigint();
		enqueue(this);
	}
}

export const SPAN_KIND_INTERNAL = 1;
export const SPAN_KIND_SERVER = 2;
export const SPAN_KIND_CLIENT = 3;

/** The span active in this async context, if any. */
export function currentSpan() {
	return als.getStore() || null;
}

/**
 * Start the root span for an inbound request. Honours an inbound traceparent
 * (same trace id, its span becomes the parent) and its sampled flag; otherwise
 * decides by sampleRate().
 * @param {string} name
 * @param {{ traceparent?: string | string[] | undefined, attrs?: Record<string, any>, random?: () => number }} [opts]
 */
export function startRootSpan(name, opts = {}) {
	const header = Array.isArray(opts.traceparent) ? opts.traceparent[0] : opts.traceparent;
	const inbound = parseTraceparent(header);
	const rand = opts.random || Math.random;
	const sampled = inbound ? inbound.sampled || rand() < sampleRate() : rand() < sampleRate();
	return new Span({
		name,
		kind: SPAN_KIND_SERVER,
		traceId: inbound ? inbound.traceId : newTraceId(),
		parentSpanId: inbound ? inbound.spanId : null,
		sampled,
		attrs: opts.attrs,
	});
}

/** Run `fn` with `span` as the active span of the async context. */
export function runWithSpan(span, fn) {
	return als.run(span, fn);
}

/**
 * Start a child of the active span. Without an active span (a cron, a script, a
 * test) this returns a non-recording span so call sites need no branch.
 * @param {string} name
 * @param {Record<string, any>} [attrs]
 * @param {number} [kind]
 */
export function startChildSpan(name, attrs, kind = SPAN_KIND_INTERNAL) {
	const parent = als.getStore();
	return new Span({
		name,
		kind,
		traceId: parent ? parent.traceId : newTraceId(),
		parentSpanId: parent ? parent.spanId : null,
		sampled: parent ? parent.sampled : false,
		attrs,
	});
}

/**
 * Run `fn` inside a child span that is active for the duration of the call.
 * @template T
 * @param {string} name
 * @param {Record<string, any> | null} attrs
 * @param {(span: Span) => Promise<T> | T} fn
 * @param {number} [kind]
 * @returns {Promise<T>}
 */
export async function withSpan(name, attrs, fn, kind = SPAN_KIND_INTERNAL) {
	const span = startChildSpan(name, attrs || undefined, kind);
	try {
		return await als.run(span, () => fn(span));
	} catch (err) {
		span.recordError(err);
		throw err;
	} finally {
		span.end();
	}
}

/** Headers to add to an outbound call so the callee joins this trace. */
export function injectTraceHeaders(span = als.getStore(), headers = {}) {
	if (span) headers.traceparent = formatTraceparent(span.context);
	return headers;
}

// ── export ──────────────────────────────────────────────────────────────

/** @type {Span[]} */
let queue = [];
let timer = null;
let lastWarn = 0;
/** @type {null | ((resourceSpans: object) => Promise<void>)} */
let exporterOverride = null;

/** Test hook: replace the network exporter. Pass null to restore. */
export function _setExporter(fn) {
	exporterOverride = fn;
}

/** Test hook: drop buffered spans and the timer. */
export function _resetTracing() {
	queue = [];
	if (timer) clearTimeout(timer);
	timer = null;
	exporterOverride = null;
	lastWarn = 0;
}

export function pendingSpanCount() {
	return queue.length;
}

function warn(msg) {
	const now = Date.now();
	if (now - lastWarn < WARN_EVERY_MS) return;
	lastWarn = now;
	console.warn(`[tracing] ${msg}`);
}

function enqueue(span) {
	if (queue.length >= MAX_QUEUE) queue.shift();
	queue.push(span);
	if (queue.length >= MAX_BATCH) {
		void flushSpans();
	} else if (!timer) {
		timer = setTimeout(() => {
			timer = null;
			void flushSpans();
		}, FLUSH_MS);
		timer.unref?.();
	}
}

function attrValue(v) {
	if (typeof v === 'boolean') return { boolValue: v };
	if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
	return { stringValue: String(v).slice(0, 256) };
}

function toOtlp(spans) {
	const project = readEnv('TRACE_PROJECT') || readEnv('GOOGLE_CLOUD_PROJECT') || DEFAULT_PROJECT;
	const baseNs = BigInt(Date.now()) * 1_000_000n;
	const nowHr = process.hrtime.bigint();
	return {
		resource: {
			attributes: [
				{ key: 'gcp.project_id', value: { stringValue: project } },
				{ key: 'service.name', value: { stringValue: readEnv('K_SERVICE') || 'three-ws-api' } },
			],
		},
		scopeSpans: [
			{
				scope: { name: 'three.ws/api-tracing' },
				spans: spans.map((s) => {
					const startNs = baseNs - (nowHr - s.startHr);
					const endNs = baseNs - (nowHr - (s.endNs ?? nowHr));
					return {
						traceId: s.traceId,
						spanId: s.spanId,
						...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
						name: s.name,
						kind: s.kind,
						startTimeUnixNano: String(startNs),
						endTimeUnixNano: String(endNs),
						attributes: Object.entries(s.attrs).map(([key, value]) => ({ key, value: attrValue(value) })),
						status: s.error ? { code: 2, message: s.error } : { code: 1 },
					};
				}),
			},
		],
	};
}

async function networkExport(resourceSpans) {
	const { getGcpAccessToken } = await import('./gcp-auth.js');
	const token = await getGcpAccessToken();
	const project = readEnv('TRACE_PROJECT') || readEnv('GOOGLE_CLOUD_PROJECT') || DEFAULT_PROJECT;
	const res = await fetch(readEnv('TRACE_ENDPOINT') || DEFAULT_ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
			'x-goog-user-project': project,
		},
		body: JSON.stringify({ resourceSpans: [resourceSpans] }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) throw new Error(`trace export http ${res.status}`);
}

/** Flush buffered spans now. Never throws. */
export async function flushSpans() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	if (!queue.length) return;
	const batch = queue.splice(0, queue.length);
	try {
		await (exporterOverride || networkExport)(toOtlp(batch));
	} catch (err) {
		warn(`export failed, dropped ${batch.length} span(s): ${/** @type {any} */ (err)?.message || err}`);
	}
}

// ── Express ─────────────────────────────────────────────────────────────

/** Collapse ids so span names group: /api/forge/9f2c... becomes /api/forge/:id. */
export function routeName(pathname) {
	return String(pathname || '/')
		.split('/')
		.slice(0, 4)
		.map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d{4,}$/.test(seg) ? ':id' : seg))
		.join('/');
}

/** Express middleware: one SERVER span per /api/* request, active for the handler. */
export function tracingMiddleware() {
	return (req, res, next) => {
		const path = req.path || String(req.url || '').split('?')[0];
		if (!path.startsWith('/api/')) return next();
		const route = routeName(path);
		const span = startRootSpan(`${req.method} ${route}`, {
			traceparent: req.headers?.traceparent,
			attrs: {
				'http.request.method': req.method,
				'http.route': route,
				'user_agent.class': userAgentClass(req.headers?.['user-agent']),
			},
		});
		let done = false;
		const finish = (aborted) => {
			if (done) return;
			done = true;
			span.setAttribute('http.response.status_code', res.statusCode);
			if (aborted) span.recordError('client closed the connection before the response finished');
			else if (res.statusCode >= 500) span.recordError(`http ${res.statusCode}`);
			span.end();
		};
		res.on('finish', () => finish(false));
		res.on('close', () => finish(!res.writableFinished));
		runWithSpan(span, next);
	};
}
