// Submit tickets: a job handle that exists before the job does.
//
// Why: /api/gpt-forge answers a text submit only after it has painted the
// reference image, and with Vertex Imagen billing-denied that paint falls
// through a ladder of providers. Measured on production 2026-09-30, text submits
// took 30 to 42 s. ChatGPT drops any tool call still open at 60 s, so the
// ChatGPT surface bounds every call (CHATGPT_CALL_BUDGET_MS) and aborts a submit
// that runs past it. The server finished those submits anyway and created real
// jobs, but the caller never learned their ids: the tool answered "Generation is
// taking longer than expected" and the model was orphaned. Test cases 1 and 2 of
// the OpenAI App Directory resubmission failed exactly this way.
//
// The fix hands the caller a handle up front. The client mints a ticket and
// sends it with the submit (x-forge-ticket). The server marks the ticket
// `submitting` before it starts work and records the submit's response under it
// when it answers, whether or not the caller is still listening. A caller whose
// submit ran out of time returns the ticket handle (`t1.<ticket>`) as its
// pending job id, and polling that handle on /api/gpt-forge resolves it to the
// real job once the submit lands. check_job and the viewer widget need no
// changes: they already poll whatever handle they were given.
//
// Stored in the shared cache (Redis, with per-instance memory as its degraded
// fallback), keyed by a hash of the ticket so the raw value never appears in a
// key listing.

import { createHash, randomUUID } from 'node:crypto';
import { cacheGetFresh, cacheSet } from './cache.js';

export const TICKET_HEADER = 'x-forge-ticket';
export const TICKET_PREFIX = 't1.';
// Outlives any client's collection loop, matching the done-frame cache.
export const TICKET_TTL_S = 6 * 3600;
// A submit that has not reported back in this long died with the instance that
// was running it. The slowest measured submit is 42 s; five minutes is far past
// any live one, so a ticket this old is reported as failed rather than left to
// spin forever.
export const TICKET_STALE_MS = 5 * 60_000;

// A poll can reach the cache before the server's `submitting` mark is visible
// to it (the mark is written when the submit arrives, and the cache degrades to
// per-instance memory when Redis is unhealthy). A ticket younger than this with
// no record yet is still being submitted, not unknown.
export const TICKET_MARK_GRACE_MS = 90_000;

const TICKET_RE = /^[A-Za-z0-9-]{16,64}$/;

// `<mint time base36>-<uuid>`: the mint time lets a poll tell a ticket that has
// not been marked yet from one that never existed. It carries nothing else.
export function newTicket(now = Date.now()) {
	return `${now.toString(36)}-${randomUUID()}`;
}

/** When a ticket was minted (epoch ms), or null for a ticket without a mint time. */
export function ticketMintedAt(ticket) {
	const m = /^([0-9a-z]{6,11})-/.exec(String(ticket || ''));
	if (!m) return null;
	const at = parseInt(m[1], 36);
	return Number.isFinite(at) ? at : null;
}

export function isValidTicket(ticket) {
	return typeof ticket === 'string' && TICKET_RE.test(ticket);
}

export function ticketHandle(ticket) {
	return `${TICKET_PREFIX}${ticket}`;
}

/** The ticket inside a `t1.` handle, or null when the handle is an ordinary job id. */
export function ticketFromHandle(jobId) {
	const s = String(jobId || '');
	if (!s.startsWith(TICKET_PREFIX)) return null;
	const ticket = s.slice(TICKET_PREFIX.length);
	return isValidTicket(ticket) ? ticket : null;
}

/** The ticket a submit request carries, or null. */
export function ticketFromRequest(req) {
	const raw = req?.headers?.[TICKET_HEADER];
	const ticket = Array.isArray(raw) ? raw[0] : raw;
	return isValidTicket(ticket) ? ticket : null;
}

export function ticketKey(ticket) {
	return `forge:ticket:${createHash('sha256').update(String(ticket)).digest('hex').slice(0, 40)}`;
}

export async function markTicketSubmitting(ticket, now = Date.now()) {
	await cacheSet(ticketKey(ticket), { state: 'submitting', at: now }, TICKET_TTL_S);
}

export async function recordTicketOutcome(ticket, status, body, now = Date.now()) {
	await cacheSet(ticketKey(ticket), { state: 'settled', status, body: body ?? null, at: now }, TICKET_TTL_S);
}

export async function recallTicket(ticket) {
	// Fresh read: a poll is waiting for this exact record to change.
	return cacheGetFresh(ticketKey(ticket)).catch(() => null);
}

/**
 * Record whatever the handler answers under the ticket before the response
 * leaves. `end` is deferred by one cache write so the record exists by the time
 * any poll can ask for it, and it stays idempotent so a second send behaves
 * exactly as it would have without the capture.
 */
export function captureTicketOutcome(res, ticket) {
	const end = res.end.bind(res);
	let captured = false;
	res.end = (chunk, ...rest) => {
		if (captured) return end(chunk, ...rest);
		captured = true;
		let body = null;
		try {
			if (chunk != null) body = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
		} catch {
			body = null;
		}
		recordTicketOutcome(ticket, res.statusCode, body)
			.catch((err) => console.warn(`[forge] submit ticket record failed: ${err?.message || err}`))
			.finally(() => end(chunk, ...rest));
		return res;
	};
}

const START_AGAIN = 'Start a new generation.';

/**
 * Pure: what a poll of a ticket handle should answer, given its record (and
 * the ticket itself, whose mint time covers the moment before it is marked).
 *   unknown     no record: a mistyped or expired handle.
 *   submitting  the submit is still running server-side.
 *   job         the submit was accepted; poll `jobId` for the model.
 *   done        the submit finished the model outright; `body` is its frame.
 *   failed      the submit was refused, errored, or died; `message` says why.
 */
export function resolveTicket(record, now = Date.now(), ticket = null) {
	if (!record || typeof record !== 'object') {
		const mintedAt = ticketMintedAt(ticket);
		if (mintedAt != null && now - mintedAt >= 0 && now - mintedAt < TICKET_MARK_GRACE_MS) {
			return { kind: 'submitting', elapsedMs: now - mintedAt };
		}
		return { kind: 'unknown' };
	}
	if (record.state === 'submitting') {
		const elapsedMs = Math.max(0, now - Number(record.at || now));
		if (elapsedMs > TICKET_STALE_MS) {
			return { kind: 'failed', message: `The generation request never completed. ${START_AGAIN}` };
		}
		return { kind: 'submitting', elapsedMs };
	}
	const status = Number(record.status);
	const body = record.body && typeof record.body === 'object' ? record.body : {};
	if (status >= 200 && status < 300) {
		if (body.status === 'done' && body.glb_url) return { kind: 'done', body };
		if (typeof body.job_id === 'string' && body.job_id) return { kind: 'job', jobId: body.job_id };
	}
	const reason = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : 'The generation could not start.';
	return { kind: 'failed', message: /start a new generation/i.test(reason) ? reason : `${reason.replace(/[.\s]*$/, '.')} ${START_AGAIN}` };
}
