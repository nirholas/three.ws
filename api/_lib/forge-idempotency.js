// Idempotency-Key for the forge's create calls (POST /api/forge and
// POST /api/forge?action=rig).
//
// Both start GPU work. A client that loses the response and retries the same
// request, whether from an SDK retry policy, a dropped mobile connection or a
// proxy timeout, must get the first call's job back instead of starting a
// second generation.
// The record lives in the shared 24-hour store the v1 agents API and the MCP
// studio already use (./idempotency.js), scoped to the forge, the action and
// the caller, so one key never crosses surfaces or callers.
//
// Outcomes for a request carrying `Idempotency-Key`:
//   • first call      runs; a 2xx JSON answer is stored and returned as usual
//   • repeat, done    the stored answer, with `Idempotent-Replayed: true`
//   • repeat, running 409 idempotency_in_progress with Retry-After
//   • different body  422 idempotency_key_reused
//   • first call fails (non-2xx) the key is released so the retry can run
// A request without the header is untouched.

import { json, readJson } from './http.js';
import {
	IDEMPOTENCY_KEY_MAX,
	IDEMPOTENCY_TTL_S,
	claimIdempotent,
	fingerprint,
	idempotencyStoreKey,
	normalizeIdempotencyKey,
	readIdempotent,
	releaseIdempotent,
	sha256Hex,
	writeIdempotent,
} from './idempotency.js';

// A running claim outlives the slowest synchronous forge hold, and expires on
// its own if the instance dies mid-run so the key is never stuck.
const RUNNING_TTL_S = 300;
const BODY_LIMIT = 8_000;

function storeKeyFor(scope, caller, key) {
	return idempotencyStoreKey('forge', sha256Hex(caller).slice(0, 32), `${scope}:${key}`);
}

function answerExisting(res, record, bodyHash) {
	if (record.bodyHash !== bodyHash) {
		return json(res, 422, {
			error: 'idempotency_key_reused',
			message: 'This Idempotency-Key was already used with a different request body. Use a new key for a new request.',
		});
	}
	if (record.state === 'done') {
		return json(res, record.status, record.body, { 'idempotent-replayed': 'true' });
	}
	return json(
		res,
		409,
		{
			error: 'idempotency_in_progress',
			message: 'A request with this Idempotency-Key is still running. Retry shortly to collect its result.',
			retry_after: 2,
		},
		{ 'retry-after': '2' },
	);
}

// Capture what the wrapped handler writes, so a 2xx JSON answer can be stored
// verbatim. The response still goes to the client exactly as written.
function captureEnd(res) {
	const original = res.end;
	const captured = { chunk: undefined };
	res.end = function capturingEnd(chunk, ...rest) {
		if (chunk !== undefined && typeof chunk !== 'function') captured.chunk = chunk;
		return original.call(this, chunk, ...rest);
	};
	return {
		restore() {
			res.end = original;
		},
		json() {
			if (captured.chunk === undefined) return undefined;
			try {
				return JSON.parse(Buffer.isBuffer(captured.chunk) ? captured.chunk.toString('utf8') : String(captured.chunk));
			} catch {
				return undefined;
			}
		},
	};
}

/**
 * Run a forge create handler at most once per (caller, scope, Idempotency-Key).
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @param {import('http').ServerResponse} res
 * @param {{ scope: string, caller: string | (() => Promise<string>), run: () => Promise<unknown> }} opts
 *   `caller` may be a function so a request without the header never pays to resolve it.
 */
export async function withForgeIdempotency(req, res, { scope, caller, run }) {
	let key;
	try {
		key = normalizeIdempotencyKey(req.headers?.['idempotency-key']);
	} catch {
		return json(res, 400, {
			error: 'invalid_idempotency_key',
			message: `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX} characters.`,
		});
	}
	if (!key) return run();

	// Read the body once and leave it on req.body: readBody() rebuilds the same
	// bytes from req.body, so the wrapped handler's own readJson sees it intact.
	const body = await readJson(req, BODY_LIMIT).catch(() => null);
	if (body === null || typeof body !== 'object') return run();
	req.body = body;

	const who = typeof caller === 'function' ? await caller() : caller;
	const storeKey = storeKeyFor(scope, who, key);
	const bodyHash = fingerprint(body);

	const existing = await readIdempotent(storeKey);
	if (existing) return answerExisting(res, existing, bodyHash);

	const won = await claimIdempotent(storeKey, { state: 'running', bodyHash }, RUNNING_TTL_S);
	if (!won) {
		const record = await readIdempotent(storeKey);
		if (record) return answerExisting(res, record, bodyHash);
	}

	const capture = captureEnd(res);
	try {
		await run();
	} catch (err) {
		await releaseIdempotent(storeKey).catch(() => {});
		throw err;
	} finally {
		capture.restore();
	}

	const status = res.statusCode;
	const answer = capture.json();
	if (status >= 200 && status < 300 && answer !== undefined) {
		await writeIdempotent(storeKey, { state: 'done', bodyHash, status, body: answer }, IDEMPOTENCY_TTL_S).catch(() => {});
	} else {
		await releaseIdempotent(storeKey).catch(() => {});
	}
}
