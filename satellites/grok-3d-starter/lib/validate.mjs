// Input checks for POST /api/chat and the per-address rate limit. The server
// spends the owner's xAI and three.ws credits, so it accepts only bounded,
// well-formed requests and only a few per minute from each address.

import { badInput } from './errors.mjs';

export const LIMITS = Object.freeze({ body: 16 * 1024, message: 1200, glbUrl: 2048, label: 300, responseId: 200 });

const RESPONSE_ID = /^[\w-]{1,200}$/;

function httpsUrl(value) {
	if (typeof value !== 'string' || value.length > LIMITS.glbUrl) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

/**
 * { message, previousResponseId?, stage?: { glbUrl, label? } } or a thrown bad_input AppError.
 * `stage` is the model currently on the page, so "make it chrome" refines that one.
 */
export function validateChatInput(body) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) throw badInput('The request body must be a JSON object.');
	const message = typeof body.message === 'string' ? body.message.replace(/\u0000/g, '').trim() : '';
	if (!message) throw badInput('Type a message first.');
	if (message.length > LIMITS.message) throw badInput(`Messages are limited to ${LIMITS.message} characters; this one has ${message.length}.`);

	let previousResponseId = null;
	if (body.previousResponseId != null && body.previousResponseId !== '') {
		if (typeof body.previousResponseId !== 'string' || !RESPONSE_ID.test(body.previousResponseId)) throw badInput('The conversation id is malformed. Start a new chat.');
		previousResponseId = body.previousResponseId;
	}

	let stage = null;
	if (body.stage != null) {
		if (typeof body.stage !== 'object' || Array.isArray(body.stage)) throw badInput('The stage field must be an object.');
		const glbUrl = httpsUrl(body.stage.glbUrl);
		if (!glbUrl) throw badInput('The model on the stage must have an https GLB link.');
		const label = typeof body.stage.label === 'string' ? body.stage.label.trim().slice(0, LIMITS.label) : '';
		stage = { glbUrl, label };
	}

	return { message, previousResponseId, stage };
}

/** Read a request body as JSON, refusing anything over the size cap. */
export async function readJsonBody(req, limit = LIMITS.body) {
	const declared = Number.parseInt(req.headers['content-length'] ?? '', 10);
	if (Number.isFinite(declared) && declared > limit) throw badInput(`The request is larger than ${limit} bytes.`);
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw badInput(`The request is larger than ${limit} bytes.`);
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
	} catch {
		throw badInput('The request body is not valid JSON.');
	}
}

/**
 * A fixed-window counter per key, held in memory. One process, one window
 * per address: enough to stop one visitor from draining the keys. Behind a
 * load balancer with several instances each instance counts on its own.
 */
export function createRateLimiter({ limit, windowMs = 60_000, now = Date.now } = {}) {
	const windows = new Map();
	return {
		check(key) {
			const t = now();
			if (windows.size > 10_000) {
				for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
			}
			let w = windows.get(key);
			if (!w || t - w.start >= windowMs) {
				w = { start: t, count: 0 };
				windows.set(key, w);
			}
			if (w.count >= limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
			w.count += 1;
			return { ok: true, remaining: limit - w.count };
		},
	};
}

/**
 * The caller's address. With TRUST_PROXY=1 (Cloud Run, or behind your own
 * proxy) it is the last X-Forwarded-For entry, the one the trusted proxy
 * appended; earlier entries are whatever the client sent and are ignored.
 */
export function clientAddress(req, trustProxy = false) {
	if (trustProxy) {
		const forwarded = String(req.headers['x-forwarded-for'] || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (forwarded.length) return forwarded[forwarded.length - 1];
	}
	return req.socket?.remoteAddress || 'unknown';
}
