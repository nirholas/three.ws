// three.ws 3D Studio (free): jobs an agent can trust across retries.
//
// A text-to-3D job can outlast one tool call, and a scheduled agent (Grok Bot,
// a cron, a CI step) retries a call that timed out. Three pieces make that safe:
//
//   jobFields       one status vocabulary for every job result: status,
//                   progress, eta_seconds, elapsed_seconds. get_job and
//                   check_job return it, and so does every pending result.
//   withIdempotency a generation tool called with `idempotency_key` runs once
//                   per caller and key for 24 hours. A repeat gets the first
//                   call's job (its current state, or the finished model)
//                   instead of starting a second generation. The record lives
//                   in the shared store the HTTP `Idempotency-Key` uses
//                   (../_lib/idempotency.js).
//   progressReporter turns status frames into MCP `notifications/progress` for
//                   a client that sent a progressToken (./handler.js streams
//                   them).
//
// The caller is who the studio's rate limits charge (./handler.js
// studioCaller): an install token, a ChatGPT user, a Grok MCP session, else the
// IP. A different caller with the same key gets its own job.

import {
	claimIdempotent,
	fingerprint,
	IDEMPOTENCY_KEY_MAX,
	idempotencyStoreKey,
	normalizeIdempotencyKey,
	readIdempotent,
	releaseIdempotent,
	sha256Hex,
	writeIdempotent,
} from '../_lib/idempotency.js';
import { newTicket, ticketHandle } from '../_lib/forge-submit-ticket.js';
import { clientIp } from '../_lib/rate-limit.js';

/** The optional argument every generation tool accepts. */
export const IDEMPOTENCY_KEY_PROP = {
	type: 'string',
	minLength: 1,
	maxLength: IDEMPOTENCY_KEY_MAX,
	description:
		'Optional: any string you choose (up to 200 characters) that names this one generation, such as a task id. ' +
		'Calling again with the same key within 24 hours returns the original job instead of starting a new one, ' +
		'so a retry after a timeout never generates twice. Use a new key for a new model.',
};

// Past the lane's typical duration a job is late, not finished; progress holds
// here until the frame says done rather than claiming a completion it lacks.
const PROGRESS_CEILING = 0.95;

function seconds(v) {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * The status fields every job result carries, read off a /api/gpt-forge status
 * frame. `progress` is 0 to 1, estimated from the job's elapsed time over its
 * lane's typical duration (null when the server reports neither); `eta_seconds`
 * is the time the server expects is left, absent once a job runs past its
 * estimate.
 * @param {object} frame
 */
export function jobFields(frame = {}) {
	const raw = String(frame?.status || '');
	const status = raw === 'done' ? 'done' : raw === 'failed' ? 'failed' : 'pending';
	// queued (waiting for a worker or a container boot), submitting (the request
	// is still being accepted), running (rendering), or the terminal status.
	const phase = status !== 'pending' ? status : frame?.stage === 'submit' ? 'submitting' : raw === 'queued' ? 'queued' : 'running';
	const elapsed = seconds(frame?.elapsed_seconds);
	const typical = seconds(frame?.eta_seconds);
	const remaining = seconds(frame?.eta_remaining_seconds);
	let progress = null;
	if (status === 'done') progress = 1;
	else if (status === 'pending' && elapsed != null && typical) progress = Math.min(PROGRESS_CEILING, Math.round((elapsed / typical) * 100) / 100);
	return {
		status,
		phase,
		progress,
		eta_seconds: status === 'pending' ? remaining : status === 'done' ? 0 : null,
		elapsed_seconds: elapsed,
	};
}

/**
 * A function that turns status frames into `notifications/progress` messages
 * and hands each to `send`. `progress` is the seconds this call has run, so it
 * always increases across stages (a rig job's clock restarts; this one does
 * not); `total` is that plus the server's remaining estimate when it has one.
 * @param {string|number} progressToken
 * @param {(notification: object) => void} send
 */
export function progressReporter(progressToken, send, now = () => Date.now()) {
	const started = now();
	let last = -1;
	return function report(frame = {}, label = '') {
		const progress = Math.round((now() - started) / 100) / 10;
		if (!(progress > last)) return;
		last = progress;
		const f = jobFields(frame);
		const total = f.eta_seconds ? Math.round((progress + f.eta_seconds) * 10) / 10 : null;
		send({
			jsonrpc: '2.0',
			method: 'notifications/progress',
			params: { progressToken, progress, ...(total ? { total } : {}), message: progressMessage(f, label) },
		});
	};
}

function progressMessage(f, label) {
	const what = label || 'job';
	if (f.phase === 'submitting') return `Submitting the ${what}.`;
	if (f.phase === 'queued') return `The ${what} is queued; the GPU worker is picking it up.`;
	if (f.phase === 'done') return `The ${what} is done.`;
	const eta = f.eta_seconds ? `, about ${f.eta_seconds}s left` : '';
	const pct = f.progress != null ? ` (${Math.round(f.progress * 100)}%)` : '';
	return `Rendering the ${what}${pct}${eta}.`;
}

/** Who an idempotency key belongs to on this call. */
export function idempotencyCaller(auth, req, ctx = {}) {
	if (ctx.caller) return ctx.caller;
	if (auth?.userId) return `user:${auth.userId}`;
	return `ip:${clientIp(req)}`;
}

// The caller is hashed too: it can be an IP or an install token id, and
// neither belongs in a key listing.
function studioStoreKey(caller, key) {
	return idempotencyStoreKey('mcp-studio', sha256Hex(caller).slice(0, 32), key);
}

/**
 * Is this tools/call a repeat of a key its caller already used? A repeat never
 * starts a generation, so ./handler.js does not charge it to the generation
 * quota.
 * @param {object} msg a JSON-RPC message
 * @param {string} caller
 */
export async function isIdempotentRepeat(msg, caller) {
	let key;
	try {
		key = normalizeIdempotencyKey(msg?.params?.arguments?.idempotency_key);
	} catch {
		return false;
	}
	if (!key || !caller) return false;
	return Boolean(await readIdempotent(studioStoreKey(caller, key)));
}

function reusedKey(tool) {
	const message =
		`This idempotency_key was already used with different arguments (by ${tool}). ` +
		'Keys name one generation: use a new key for a new request.';
	return {
		content: [{ type: 'text', text: message }],
		structuredContent: { error: true, message, reason: 'idempotency_key_reused', status: 'failed' },
		isError: true,
	};
}

function withKeyFields(result, key, replayed) {
	if (!result || typeof result !== 'object') return result;
	const sc = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : {};
	const out = { ...result, structuredContent: { ...sc, idempotency_key: key, idempotent_replay: replayed } };
	if (replayed && Array.isArray(result.content) && result.content[0]?.type === 'text') {
		out.content = [
			{
				...result.content[0],
				text:
					'Same idempotency_key as an earlier call: this is that call\'s job, and nothing new was started.\n' +
					result.content[0].text,
			},
			...result.content.slice(1),
		];
	}
	return out;
}

/**
 * Make a generation handler idempotent on `args.idempotency_key`.
 *
 * The first call claims the key together with a submit ticket's handle in one
 * atomic write, before anything is submitted, so a repeat that arrives a
 * millisecond later already has a job id to follow. The handler reports each
 * job it submits through `ctx.onJob(jobId, shape)`; `shape` says how to render
 * that job when it finishes (kind, prompt, rigged, refine lineage). When the
 * call ends the record keeps its outcome: the finished result, the pending
 * job, or the failure. A call that never got a job accepted (a refused prompt,
 * a busy generator) gives the key back, so retrying it can still run.
 *
 * `replay(record, { save, release, req, ctx })` renders a repeat from the record.
 *
 * @param {string} tool
 * @param {(args: object, auth: object, req: object, ctx: object) => Promise<object>} handler
 * @param {{ replay: (record: object, opts: object) => Promise<object> }} opts
 */
export function withIdempotency(tool, handler, { replay }) {
	return async function idempotent(args = {}, auth, req, ctx = {}) {
		const { idempotency_key: rawKey, ...rest } = args || {};
		let key;
		try {
			key = normalizeIdempotencyKey(rawKey);
		} catch (err) {
			return invalidKey(err.message);
		}
		if (!key) return handler(rest, auth, req, ctx);

		const storeKey = studioStoreKey(idempotencyCaller(auth, req, ctx), key);
		const print = fingerprint({ tool, args: rest });
		const ticket = newTicket();
		const first = {
			v: 1,
			tool,
			fingerprint: print,
			state: 'running',
			job_id: ticketHandle(ticket),
			accepted: false,
			shape: {},
			created_at: new Date().toISOString(),
		};
		// Two tries: a record can expire between a lost claim and the read.
		for (let attempt = 0; attempt < 2; attempt++) {
			if (await claimIdempotent(storeKey, first)) return runClaimed();
			const prior = await readIdempotent(storeKey);
			if (!prior) continue;
			if (prior.fingerprint !== print) return reusedKey(prior.tool || tool);
			const save = (patch) => writeIdempotent(storeKey, { ...prior, ...patch }).catch(() => {});
			const release = () => releaseIdempotent(storeKey).catch(() => {});
			return withKeyFields(await replay(prior, { save, release, req, ctx }), key, true);
		}
		// The store refused both ways: run the call rather than refuse it.
		return withKeyFields(await handler(rest, auth, req, ctx), key, false);

		async function runClaimed() {
			let record = first;
			const save = (patch) => {
				record = { ...record, ...patch };
				return writeIdempotent(storeKey, record).catch(() => {});
			};
			const onJob = (jobId, shape = {}) => save({ job_id: jobId, accepted: true, shape: { ...record.shape, ...shape } });
			let result;
			try {
				result = await handler(rest, auth, req, { ...ctx, ticket, onJob });
			} catch (err) {
				if (!record.accepted) await releaseIdempotent(storeKey).catch(() => {});
				throw err;
			}
			const sc = result?.structuredContent || {};
			if (sc.status === 'pending' && sc.jobId) {
				await save({ state: 'pending', job_id: sc.jobId, accepted: true });
			} else if (result?.isError) {
				if (record.accepted) await save({ state: 'failed', message: result.content?.[0]?.text || 'Generation failed.' });
				else await releaseIdempotent(storeKey).catch(() => {});
			} else {
				result = stampDone(result, record.job_id);
				await save({ state: 'done', result });
			}
			return withKeyFields(result, key, false);
		}
	};
}

// A finished keyed result names its job, so a repeat and the first call carry
// the same job_id whichever state each of them saw.
function stampDone(result, jobId) {
	const sc = result?.structuredContent;
	if (!sc || typeof sc !== 'object') return result;
	return { ...result, structuredContent: { ...sc, status: sc.status || 'done', job_id: sc.job_id || jobId } };
}

function invalidKey(message) {
	const text = `${message}. Shorten the idempotency_key.`;
	return {
		content: [{ type: 'text', text }],
		structuredContent: { error: true, message: text, reason: 'invalid_idempotency_key' },
		isError: true,
	};
}
