// Browser client for Modly, the local image-to-3D desktop app.
//
// Adapted from Modly (https://github.com/lightningpixel/modly), MIT License, Copyright (c) 2026 Lightning Pixel
//
// The HTTP contract below is taken from Modly's FastAPI backend (api/main.py and
// api/routers/{model,workflow_runs,generation,export,optimize}.py), and the
// workspace-path rules and the run-then-export flow follow its own agent CLI
// (tools/modly-cli/agent.py). Modly listens on http://localhost:8765 with
// CORS `allow_origins=["*"]`, so a page on https://three.ws can talk to it
// directly: every request here is a CORS "simple" request (GET, or a POST with
// a multipart or JSON body that FastAPI accepts), credentials are never sent,
// and nothing leaves the user's machine except the page's own fetches.
//
// Nothing in this module runs on import. Probing loopback triggers Chrome's
// Local Network Access prompt, so callers must only probe after a user gesture.

/** Where Modly's installer lives. Shown in the "not detected" state. */
export const MODLY_INSTALL_URL = 'https://modly3d.app/';

/** Modly's documented default port, on both loopback spellings. */
export const MODLY_DEFAULT_ORIGINS = Object.freeze(['http://127.0.0.1:8765', 'http://localhost:8765']);

const OVERRIDE_KEY = 'tws:modly-origin';
const DEFAULT_PROBE_TIMEOUT_MS = 2500;
const DEFAULT_POLL_INTERVAL_MS = 2000;
// Modly's own CLI waits 30 minutes for a run; big models on small GPUs need it.
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const GLB_MAGIC = 0x46546c67; // "glTF", little-endian

/**
 * Typed failure from the Modly client. `code` is stable and safe to branch on:
 *   NOT_RUNNING      no Modly answered at the origin
 *   BLOCKED          the browser refused the loopback request (see `reason`)
 *   BAD_ORIGIN       a user-supplied origin is not an http(s) URL
 *   BAD_INPUT        the caller passed an unusable argument
 *   BAD_REQUEST      Modly rejected the request (HTTP 400), `message` is Modly's text
 *   UNKNOWN_MODEL    the model id is not installed in Modly
 *   NOT_FOUND        Modly answered 404 (unknown run, op, or file)
 *   UNAVAILABLE      Modly answered 503 (mesh op dependency missing or failed)
 *   HTTP             any other non-2xx answer
 *   RUN_LOST         Modly forgot the run (it was restarted mid-generation)
 *   GENERATION_FAILED the model raised; `message` is the exception line, `detail` the traceback
 *   CANCELLED        the run was cancelled (by our signal or inside Modly)
 *   TIMEOUT          the run outlived `timeoutMs`
 *   BAD_PATH         Modly reported a workspace path that escapes the workspace
 *   NOT_GLB          the exported file is not a binary glTF
 *   UPLOAD_UNSUPPORTED Modly has no endpoint that accepts mesh bytes
 */
export class ModlyError extends Error {
	constructor(code, message, { status = 0, detail = '', reason = '', cause } = {}) {
		super(message, cause ? { cause } : undefined);
		this.name = 'ModlyError';
		this.code = code;
		this.status = status;
		this.detail = detail;
		this.reason = reason;
	}
}

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

function readOverride() {
	try {
		return globalThis.localStorage?.getItem(OVERRIDE_KEY) || '';
	} catch {
		return '';
	}
}

/**
 * Normalize something a person typed ("localhost:9000", "http://10.0.0.5:8765/")
 * into a bare origin. Throws BAD_ORIGIN for anything that is not http(s).
 */
export function normalizeModlyOrigin(input) {
	const raw = String(input ?? '').trim();
	if (!raw) throw new ModlyError('BAD_ORIGIN', 'Enter the address Modly is listening on, for example http://localhost:8765.');
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
	let url;
	try {
		url = new URL(withScheme);
	} catch {
		throw new ModlyError('BAD_ORIGIN', `"${raw}" is not a valid address.`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ModlyError('BAD_ORIGIN', 'Modly is reached over http or https.');
	}
	return url.origin;
}

function buildOrigins(override) {
	const list = [];
	if (override) {
		try {
			list.push(normalizeModlyOrigin(override));
		} catch {
			// A corrupt stored value is ignored; the defaults still apply.
		}
	}
	for (const o of MODLY_DEFAULT_ORIGINS) if (!list.includes(o)) list.push(o);
	return list;
}

/**
 * Origins probed in order: the user's saved override first (if any), then the
 * two loopback defaults. This array is live: setModlyOriginOverride updates it
 * in place, so importers holding a reference always see the current list.
 */
export const MODLY_ORIGINS = buildOrigins(readOverride());

/** The saved custom origin, or '' when none is set. */
export function getModlyOriginOverride() {
	const stored = readOverride();
	if (!stored) return '';
	try {
		return normalizeModlyOrigin(stored);
	} catch {
		return '';
	}
}

/**
 * Save (or with a falsy value, clear) a custom Modly origin and refresh
 * MODLY_ORIGINS. Returns the normalized origin, or '' when cleared.
 */
export function setModlyOriginOverride(origin) {
	const normalized = origin ? normalizeModlyOrigin(origin) : '';
	try {
		if (normalized) globalThis.localStorage?.setItem(OVERRIDE_KEY, normalized);
		else globalThis.localStorage?.removeItem(OVERRIDE_KEY);
	} catch {
		// Storage can be blocked (private mode); the in-memory list still updates.
	}
	MODLY_ORIGINS.splice(0, MODLY_ORIGINS.length, ...buildOrigins(normalized));
	return normalized;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

// One controller that aborts when the caller's signal does or when the timeout
// fires, whichever comes first. `dispose` must run when the request settles.
function linkSignal(signal, timeoutMs) {
	const ctrl = new AbortController();
	let timer = null;
	const onAbort = () => ctrl.abort(signal.reason);
	if (signal) {
		if (signal.aborted) ctrl.abort(signal.reason);
		else signal.addEventListener('abort', onAbort, { once: true });
	}
	if (timeoutMs > 0) timer = setTimeout(() => ctrl.abort(new ModlyError('TIMEOUT', 'Modly did not answer in time.')), timeoutMs);
	return {
		signal: ctrl.signal,
		dispose() {
			if (timer) clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		},
	};
}

function cancelledError(cause) {
	return new ModlyError('CANCELLED', 'The Modly generation was cancelled.', { cause });
}

// FastAPI errors are `{"detail": "..."}` for HTTPException and
// `{"detail": [{loc, msg, type}]}` for request validation (422).
function detailText(body) {
	const d = body?.detail;
	if (typeof d === 'string') return d;
	if (Array.isArray(d)) {
		return d
			.map((e) => [Array.isArray(e?.loc) ? e.loc.filter((p) => p !== 'body').join('.') : '', e?.msg].filter(Boolean).join(': '))
			.filter(Boolean)
			.join('; ');
	}
	return '';
}

async function errorFromResponse(res) {
	let text = '';
	try {
		const raw = await res.text();
		try {
			text = detailText(JSON.parse(raw)) || raw;
		} catch {
			text = raw;
		}
	} catch {
		text = '';
	}
	text = String(text || '').trim().slice(0, 2000);
	const status = res.status;
	if (status === 404) return new ModlyError('NOT_FOUND', text || 'Modly could not find that resource.', { status });
	if (status === 400 && /unknown model/i.test(text)) return new ModlyError('UNKNOWN_MODEL', text, { status });
	if (status === 400 || status === 422) return new ModlyError('BAD_REQUEST', text || 'Modly rejected the request.', { status });
	if (status === 503) return new ModlyError('UNAVAILABLE', text || 'Modly could not run that operation.', { status });
	return new ModlyError('HTTP', text || `Modly answered HTTP ${status}.`, { status });
}

// fetch against Modly. A network-level failure (connection refused, blocked by
// the browser) becomes NOT_RUNNING; aborts surface as CANCELLED or TIMEOUT.
async function modlyFetch(origin, path, { signal, timeoutMs = 0, ...init } = {}) {
	const link = linkSignal(signal, timeoutMs);
	try {
		const res = await fetch(`${origin}${path}`, {
			...init,
			mode: 'cors',
			credentials: 'omit',
			cache: 'no-store',
			signal: link.signal,
		});
		if (!res.ok) throw await errorFromResponse(res);
		return res;
	} catch (err) {
		if (err instanceof ModlyError) throw err;
		if (link.signal.aborted) {
			const reason = link.signal.reason;
			if (reason instanceof ModlyError) throw reason;
			throw cancelledError(err);
		}
		throw new ModlyError('NOT_RUNNING', `Could not reach Modly at ${origin}.`, { cause: err });
	} finally {
		link.dispose();
	}
}

async function modlyJson(origin, path, opts) {
	const res = await modlyFetch(origin, path, opts);
	try {
		return await res.json();
	} catch (err) {
		throw new ModlyError('HTTP', `Modly sent an unreadable answer for ${path}.`, { status: res.status, cause: err });
	}
}

function postJson(body) {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	};
}

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(cancelledError(signal.reason));
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(cancelledError(signal.reason));
		}
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isSafari() {
	const ua = globalThis.navigator?.userAgent || '';
	return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android)\//.test(ua);
}

// Chrome's Local Network Access permission. Older builds name it
// 'loopback-network'; browsers without it throw on query, which means "no gate".
async function localNetworkPermission() {
	const perms = globalThis.navigator?.permissions;
	if (!perms?.query) return 'unsupported';
	for (const name of ['local-network-access', 'loopback-network']) {
		try {
			const status = await perms.query({ name });
			if (status?.state) return status.state;
		} catch {
			// Unknown permission name in this browser; try the next spelling.
		}
	}
	return 'unsupported';
}

/**
 * Why a failed probe failed, as far as the page can tell. A refused connection
 * and a browser block look identical to fetch, so this reads the signals the
 * browser does expose: Safari blocks http loopback from an https page as mixed
 * content, and Chrome reports a denied Local Network Access permission.
 */
async function blockReason() {
	const permission = await localNetworkPermission();
	if (permission === 'denied') return 'lna-denied';
	const pageIsHttps = globalThis.location?.protocol === 'https:';
	if (pageIsHttps && isSafari()) return 'mixed-content';
	return '';
}

async function pingHealth(origin, { signal, timeoutMs }) {
	const body = await modlyJson(origin, '/health', { signal, timeoutMs });
	if (body?.status !== 'ok') throw new ModlyError('NOT_RUNNING', `${origin} answered, but it is not Modly.`);
	return true;
}

/**
 * Probe every origin in MODLY_ORIGINS (or `origins`) for a running Modly and
 * explain the outcome. Never throws.
 *
 * @returns {Promise<{status:'connected'|'not-running'|'blocked', origin:string|null,
 *   models:Array, reason:string, error?:ModlyError}>}
 *   `reason` is 'lna-denied' or 'mixed-content' when blocked.
 */
export async function probeModly({ signal, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, origins = MODLY_ORIGINS } = {}) {
	let lastError = null;
	for (const origin of origins) {
		if (signal?.aborted) break;
		try {
			await pingHealth(origin, { signal, timeoutMs });
		} catch (err) {
			lastError = err;
			continue;
		}
		try {
			const models = await listModlyModels(origin, { signal });
			return { status: 'connected', origin, models, reason: '' };
		} catch (err) {
			// Modly is up but the model list failed: still report it, the caller
			// can show Modly's own error text.
			return { status: 'connected', origin, models: [], reason: '', error: err };
		}
	}
	const reason = await blockReason();
	if (reason) return { status: 'blocked', origin: null, models: [], reason, error: lastError || undefined };
	return { status: 'not-running', origin: null, models: [], reason: '', error: lastError || undefined };
}

/**
 * Find a running Modly. Resolves `{ origin, models }`, or `null` when none is
 * reachable (including when the browser blocks loopback). Never throws.
 */
export async function detectModly({ signal, timeoutMs } = {}) {
	try {
		const probe = await probeModly({ signal, timeoutMs });
		return probe.status === 'connected' ? { origin: probe.origin, models: probe.models } : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// Modly's ParamSchema (src/shared/types/electron.d.ts), kept in Modly's own
// field names so a consumer can render it exactly as Modly does.
function normalizeParam(p) {
	if (!p || typeof p !== 'object' || !p.id) return null;
	const out = {
		id: String(p.id),
		label: String(p.label || p.id),
		type: String(p.type || 'string'),
		default: p.default,
	};
	if (Array.isArray(p.options)) {
		out.options = p.options.map((o) => (o && typeof o === 'object' ? { value: o.value, label: String(o.label ?? o.value) } : { value: o, label: String(o) }));
	}
	for (const k of ['min', 'max', 'step']) if (typeof p[k] === 'number') out[k] = p[k];
	if (p.tooltip) out.tooltip = String(p.tooltip);
	if (p.show_if && typeof p.show_if === 'object') out.show_if = p.show_if;
	return out;
}

/** Normalize one `/model/all` entry. Exported for tests and other consumers. */
export function normalizeModlyModel(m, paramsSchema = []) {
	return {
		id: String(m.id),
		name: String(m.name || m.id),
		description: String(m.description || ''),
		version: String(m.version || ''),
		vramGb: typeof m.vram_gb === 'number' ? m.vram_gb : null,
		tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
		downloaded: !!m.downloaded,
		loaded: !!m.loaded,
		active: !!m.active,
		// /model/all does not carry these; Modly's registry defaults a manifest
		// without them to an image-in, mesh-out generator.
		input: String(m.input || 'image'),
		output: String(m.output || 'mesh'),
		paramsSchema: (Array.isArray(paramsSchema) ? paramsSchema : []).map(normalizeParam).filter(Boolean),
	};
}

/** GET /model/params?model_id=... normalized. Resolves [] for a model with no params. */
export async function getModlyModelParams(origin, modelId, { signal } = {}) {
	const list = await modlyJson(origin, `/model/params?model_id=${encodeURIComponent(modelId)}`, { signal });
	return (Array.isArray(list) ? list : []).map(normalizeParam).filter(Boolean);
}

/**
 * Every generator installed in Modly, with its parameter schema.
 * @returns {Promise<Array<{id,name,downloaded,input,output,paramsSchema,description,version,vramGb,tags,loaded,active}>>}
 */
export async function listModlyModels(origin, { signal } = {}) {
	const raw = await modlyJson(origin, '/model/all', { signal });
	const models = (Array.isArray(raw) ? raw : []).filter((m) => m && m.id);
	return Promise.all(
		models.map(async (m) => {
			let params = [];
			try {
				params = await getModlyModelParams(origin, m.id, { signal });
			} catch (err) {
				if (err?.code === 'CANCELLED') throw err;
				// A generator that cannot describe its params still generates with defaults.
			}
			return normalizeModlyModel(m, params);
		}),
	);
}

/** Default param values from a model's schema, as Modly's own UI seeds them. */
export function defaultModlyParams(paramsSchema = []) {
	const out = {};
	for (const p of paramsSchema) if (p && p.id && p.default !== undefined) out[p.id] = p.default;
	return out;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Validate a workspace-relative path Modly reported: relative, no `..`, no
 * drive letter, no URL scheme. Same rules as Modly's CLI.
 */
export function validateModlyWorkspacePath(value) {
	const s = String(value ?? '');
	const parts = s.replace(/\\/g, '/').split('/');
	const bad =
		!s ||
		s.startsWith('/') ||
		s.startsWith('\\') ||
		/^[a-z][a-z0-9+.-]*:/i.test(s) ||
		parts.some((p) => p === '..') ||
		parts.some((p) => p.length >= 2 && /[a-z]/i.test(p[0]) && p[1] === ':');
	if (bad) throw new ModlyError('BAD_PATH', `Modly reported an invalid workspace path: ${s}`);
	return s;
}

/** The workspace path of a finished run (scene_candidate first, then output_url). */
export function modlyRunWorkspacePath(status) {
	const candidate = status?.scene_candidate?.workspace_path;
	if (candidate) return validateModlyWorkspacePath(candidate);
	const url = String(status?.output_url || '');
	if (!url) throw new ModlyError('BAD_PATH', 'Modly finished without reporting an output file.');
	let path = url;
	try {
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) path = new URL(url).pathname;
	} catch {
		path = url;
	}
	const prefix = '/workspace/';
	if (path.startsWith(prefix)) path = path.slice(prefix.length);
	try {
		path = decodeURIComponent(path);
	} catch {
		throw new ModlyError('BAD_PATH', `Modly reported an invalid workspace path: ${url}`);
	}
	return validateModlyWorkspacePath(path);
}

/**
 * Modly stores the full Python traceback as a run's error. Lift the final
 * exception line ("RuntimeError: CUDA out of memory") for display; the whole
 * text stays on `detail`.
 */
export function summarizeModlyError(text) {
	const lines = String(text || '')
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (!lines.length) return 'Modly reported a failure without details.';
	const last = lines[lines.length - 1];
	const m = /^(?:[\w.]+(?:Error|Exception|Exit|Interrupt|Cancelled)|\w+Error):\s*(.+)$/.exec(last);
	return (m ? m[1] : last).slice(0, 400);
}

const IMAGE_SIGNATURES = [
	{ type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
	{ type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
	{ type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
	{ type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
];

function matchAt(view, offset, bytes) {
	if (view.length < offset + bytes.length) return false;
	return bytes.every((b, i) => view[offset + i] === b);
}

// Modly rejects any upload whose content type is not image/*. A Blob with no
// type (a canvas export, a fetched object URL) is sniffed rather than guessed.
async function asTypedImage(image) {
	if (!(image instanceof Blob)) throw new ModlyError('BAD_INPUT', 'Pass the image as a Blob or File.');
	if (image.size === 0) throw new ModlyError('BAD_INPUT', 'The image is empty.');
	if (image.type && image.type.startsWith('image/')) return image;
	const head = new Uint8Array(await image.slice(0, 16).arrayBuffer());
	const sig = IMAGE_SIGNATURES.find((s) => matchAt(head, 0, s.bytes) && (!s.extra || matchAt(head, s.extra.offset, s.extra.bytes)));
	if (!sig) throw new ModlyError('BAD_INPUT', 'Modly needs a PNG, JPEG, WebP, or GIF image.');
	return new Blob([image], { type: sig.type });
}

function imageFilename(image, typed) {
	if (typeof image.name === 'string' && image.name) return image.name;
	const ext = (typed.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
	return `image.${ext}`;
}

async function startRun(origin, { image, modelId, params, collection, signal }) {
	const typed = await asTypedImage(image);
	const filename = imageFilename(image, typed);
	const form = () => {
		const fd = new FormData();
		fd.append('image', typed, filename);
		fd.append('model_id', modelId);
		fd.append('params', JSON.stringify(params || {}));
		if (collection) fd.append('collection', collection);
		return fd;
	};
	try {
		const body = await modlyJson(origin, '/workflow-runs/from-image', { method: 'POST', body: form(), signal });
		if (!body?.run_id) throw new ModlyError('HTTP', 'Modly did not return a run id.');
		return { id: String(body.run_id), api: 'workflow-runs' };
	} catch (err) {
		// Builds that predate /workflow-runs only expose the legacy route.
		if (!(err instanceof ModlyError) || (err.status !== 404 && err.status !== 405)) throw err;
	}
	const body = await modlyJson(origin, '/generate/from-image', { method: 'POST', body: form(), signal });
	if (!body?.job_id) throw new ModlyError('HTTP', 'Modly did not return a job id.');
	return { id: String(body.job_id), api: 'legacy' };
}

function statusPath(run) {
	const id = encodeURIComponent(run.id);
	return run.api === 'legacy' ? `/generate/status/${id}` : `/workflow-runs/${id}`;
}

function cancelPath(run) {
	const id = encodeURIComponent(run.id);
	return run.api === 'legacy' ? `/generate/cancel/${id}` : `/workflow-runs/${id}/cancel`;
}

/**
 * Ask Modly to cancel a run. Resolves true when Modly confirmed, false when it
 * could not be reached or no longer knows the run. Never throws.
 */
export async function cancelModlyRun(origin, runId, { api = 'workflow-runs' } = {}) {
	try {
		const body = await modlyJson(origin, cancelPath({ id: runId, api }), { method: 'POST', timeoutMs: 5000 });
		return body?.cancelled === true;
	} catch {
		return false;
	}
}

/** GET /export/glb for a workspace path, verified to be a binary glTF. */
export async function downloadModlyGlb(origin, workspacePath, { signal } = {}) {
	const path = validateModlyWorkspacePath(workspacePath);
	const res = await modlyFetch(origin, `/export/glb?path=${encodeURIComponent(path)}`, { signal });
	const buf = await res.arrayBuffer();
	if (buf.byteLength < 12 || new DataView(buf).getUint32(0, true) !== GLB_MAGIC) {
		throw new ModlyError('NOT_GLB', `Modly's output "${path.split('/').pop()}" is not a GLB mesh, so it cannot open in this viewer.`);
	}
	const filename = path.split('/').pop() || 'modly.glb';
	return { blob: new Blob([buf], { type: 'model/gltf-binary' }), filename: /\.glb$/i.test(filename) ? filename : `${filename}.glb` };
}

/**
 * Run an image-to-3D generation on the user's own GPU through Modly.
 *
 * Posts to /workflow-runs/from-image (falling back to the legacy
 * /generate/from-image on Modly builds without it), polls the run every
 * `pollIntervalMs`, reports `onProgress(percent, stepLabel, state)` from Modly's
 * own progress, step text and run status ('pending' | 'running' | 'done'),
 * then downloads the result via /export/glb.
 * Aborting `signal` calls Modly's cancel endpoint before rejecting with
 * ModlyError CANCELLED.
 *
 * @param {string} origin  a connected Modly origin (from detectModly)
 * @param {object} opts
 * @param {Blob|File} opts.image
 * @param {string} opts.modelId
 * @param {object} [opts.params]       model params (see defaultModlyParams)
 * @param {string} [opts.collection]   Modly workspace folder to file the output in
 * @param {(pct:number, step:string, state:string)=>void} [opts.onProgress]
 * @param {(info:{runId:string, api:string})=>void} [opts.onStarted]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{blob:Blob, filename:string, jobId:string, modelId:string, workspacePath:string, api:string}>}
 */
export async function generateWithModly(
	origin,
	{ image, modelId, params = {}, collection, onProgress, onStarted, signal, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, timeoutMs = DEFAULT_RUN_TIMEOUT_MS } = {},
) {
	if (!origin) throw new ModlyError('BAD_INPUT', 'Connect to Modly first.');
	if (!modelId) throw new ModlyError('BAD_INPUT', 'Pick a Modly model.');
	if (signal?.aborted) throw cancelledError(signal.reason);
	const report = (pct, step, state) => {
		try {
			onProgress?.(Math.max(0, Math.min(100, Math.round(Number(pct) || 0))), step || '', state);
		} catch {
			// A throwing progress callback must not break the run.
		}
	};

	report(0, 'Sending image to Modly', 'pending');
	const run = await startRun(origin, { image, modelId, params, collection, signal });
	try {
		onStarted?.({ runId: run.id, api: run.api });
	} catch {
		// Observer only.
	}

	let cancelSent = false;
	const sendCancel = () => {
		if (cancelSent) return;
		cancelSent = true;
		cancelModlyRun(origin, run.id, { api: run.api });
	};
	signal?.addEventListener('abort', sendCancel, { once: true });

	try {
		const deadline = Date.now() + timeoutMs;
		let status;
		for (;;) {
			try {
				status = await modlyJson(origin, statusPath(run), { signal, timeoutMs: 15000 });
			} catch (err) {
				if (err.code === 'NOT_FOUND') {
					throw new ModlyError('RUN_LOST', 'Modly no longer knows this generation. It may have restarted. Try again.', { status: 404 });
				}
				// One slow status answer is not a failure; keep polling until the deadline.
				if (err.code !== 'TIMEOUT') throw err;
			}
			if (status) {
				const s = status.status;
				if (s === 'done') break;
				if (s === 'error') {
					throw new ModlyError('GENERATION_FAILED', summarizeModlyError(status.error), { detail: String(status.error || '') });
				}
				if (s === 'cancelled') throw cancelledError();
				report(status.progress, status.step, s);
			}
			if (Date.now() >= deadline) {
				sendCancel();
				throw new ModlyError('TIMEOUT', `Modly did not finish within ${Math.round(timeoutMs / 60000)} minutes.`);
			}
			await sleep(pollIntervalMs, signal);
		}

		const workspacePath = modlyRunWorkspacePath(status);
		report(100, 'Fetching the mesh from Modly', 'done');
		const { blob, filename } = await downloadModlyGlb(origin, workspacePath, { signal });
		return { blob, filename, jobId: run.id, modelId, workspacePath, api: run.api };
	} catch (err) {
		if (signal?.aborted) {
			sendCancel();
			throw err instanceof ModlyError && err.code === 'CANCELLED' ? err : cancelledError(err);
		}
		throw err;
	} finally {
		signal?.removeEventListener('abort', sendCancel);
	}
}

// ---------------------------------------------------------------------------
// Mesh operations
// ---------------------------------------------------------------------------

/** GET /optimize/ops: Modly's mesh operations with their param schemas. */
export async function listModlyMeshOps(origin, { signal } = {}) {
	const ops = await modlyJson(origin, '/optimize/ops', { signal });
	return (Array.isArray(ops) ? ops : [])
		.filter((o) => o && o.id)
		.map((o) => ({
			id: String(o.id),
			label: String(o.label || o.id),
			category: String(o.category || ''),
			destructive: !!o.destructive,
			undoable: !!o.undoable,
			paramsSchema: (Array.isArray(o.params_schema) ? o.params_schema : []).map(normalizeParam).filter(Boolean),
		}));
}

/**
 * Run one of Modly's mesh operations (POST /optimize/op/{op}) and fetch the result.
 *
 * Limit: Modly's mesh ops read and write files inside Modly's own workspace,
 * and Modly exposes no endpoint that accepts mesh bytes over HTTP (its import
 * route takes an absolute path on the user's disk). So `glb` must name a mesh
 * already in that workspace: a workspace-relative path string, or a result
 * object from generateWithModly / modlyMeshOp (anything with `workspacePath`).
 * Passing a Blob rejects with ModlyError UPLOAD_UNSUPPORTED; run browser-side
 * mesh processing on a Blob instead.
 *
 * @param {string} origin
 * @param {object} opts
 * @param {string|{workspacePath:string}|Blob} opts.glb
 * @param {string} opts.op       an id from listModlyMeshOps, e.g. 'decimate'
 * @param {object} [opts.params]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{blob:Blob, filename:string, workspacePath:string, details:object}>}
 */
export async function modlyMeshOp(origin, { glb, op, params = {}, signal } = {}) {
	if (!origin) throw new ModlyError('BAD_INPUT', 'Connect to Modly first.');
	if (!op) throw new ModlyError('BAD_INPUT', 'Name the mesh operation to run.');
	if (glb instanceof Blob) {
		throw new ModlyError(
			'UPLOAD_UNSUPPORTED',
			'Modly can only process meshes in its own workspace, and it has no upload endpoint. Use a mesh Modly generated.',
		);
	}
	const inputPath = validateModlyWorkspacePath(typeof glb === 'string' ? glb : glb?.workspacePath);
	const body = await modlyJson(origin, `/optimize/op/${encodeURIComponent(op)}`, { ...postJson({ path: inputPath, params }), signal });
	// An output Modly wrote outside its workspace comes back as an absolute
	// path with no url; it cannot be exported over HTTP.
	if (!body?.url) throw new ModlyError('BAD_PATH', 'Modly wrote this result outside its workspace, so it cannot be downloaded.');
	const workspacePath = validateModlyWorkspacePath(body.path);
	const { path: _p, url: _u, ...details } = body;
	const { blob, filename } = await downloadModlyGlb(origin, workspacePath, { signal });
	return { blob, filename, workspacePath, details };
}
