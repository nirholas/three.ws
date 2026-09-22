// External fulfillment for human tasks: mirror a task to a third-party
// human-task network when nobody on three.ws has claimed it.
//
// The adapter interface every network implements:
//
//   name                   stable provider id stored on the task and claim
//   configured()           true when its credentials are present
//   mirror(task)           publish the task; returns { ref } (the network's id)
//   withdraw(task)         take a mirrored task down (claimed here, cancelled, expired)
//   verifyCallback(req, raw)  authenticate an inbound status callback; returns the parsed event
//
// Onboarding any specific network is an owner decision, so the one adapter
// shipped here is network-neutral: a signed webhook. A network that agrees to
// the contract below needs only three env vars to go live:
//
//   HUMAN_TASK_EXTERNAL_WEBHOOK_URL     where task.mirrored / task.withdrawn are POSTed
//   HUMAN_TASK_EXTERNAL_WEBHOOK_SECRET  shared HMAC-SHA256 secret, both directions
//   HUMAN_TASK_EXTERNAL_PROVIDER        provider id shown on tasks (default "webhook")
//
// Outbound: JSON body, headers X-Three-Timestamp (unix seconds) and
// X-Three-Signature: sha256=<hex HMAC of "<timestamp>.<body>">.
// Inbound (POST /api/human-tasks/external/callback): same signature scheme;
// events are claim { task_id, worker_ref, payout_address }, submit { task_id,
// worker_ref, notes, photo_urls[] } and release { task_id, worker_ref }.
// Callbacks never move money: an external submission waits for the poster's
// approval (confirm_release) like any other, and the payout address it named is
// shown in that confirmation.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { fetchSafePublicUrlPinned } from '../ssrf-guard.js';

const TOLERANCE_S = 300;
const TIMEOUT_MS = 10_000;

function typed(status, code, message) {
	return Object.assign(new Error(message), { status, code, expose: true });
}

export function sign(secret, timestamp, body) {
	return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Constant-time signature check with a replay window. Pure; exported for tests. */
export function verifySignature({ secret, timestamp, signature, body, now = Date.now() }) {
	if (!secret || !timestamp || !signature) return false;
	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_S) return false;
	const want = Buffer.from(sign(secret, timestamp, body));
	const got = Buffer.from(String(signature));
	return want.length === got.length && timingSafeEqual(want, got);
}

function publicTaskPayload(task, callbackUrl) {
	return {
		id: task.id,
		title: task.title,
		instructions: task.instructions,
		category: task.category,
		proof_requirements: task.proof_requirements || null,
		location: task.location_kind === 'onsite'
			? { kind: 'onsite', label: task.location_label, lat: task.lat, lng: task.lng, radius_m: task.radius_m }
			: { kind: 'remote' },
		deadline_at: new Date(task.deadline_at).toISOString(),
		bounty_usdc: (Number(task.bounty_atomics) / 1e6).toFixed(6).replace(/\.?0+$/, ''),
		chain: 'solana',
		url: `https://three.ws/tasks?task=${task.id}`,
		callback_url: callbackUrl,
	};
}

export const webhookAdapter = {
	get name() {
		return (process.env.HUMAN_TASK_EXTERNAL_PROVIDER || 'webhook').trim().slice(0, 40) || 'webhook';
	},

	configured() {
		return Boolean(process.env.HUMAN_TASK_EXTERNAL_WEBHOOK_URL && process.env.HUMAN_TASK_EXTERNAL_WEBHOOK_SECRET);
	},

	async post(event, payload) {
		const secret = process.env.HUMAN_TASK_EXTERNAL_WEBHOOK_SECRET;
		const body = JSON.stringify({ event, ...payload });
		const timestamp = String(Math.floor(Date.now() / 1000));
		const res = await fetchSafePublicUrlPinned(process.env.HUMAN_TASK_EXTERNAL_WEBHOOK_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-three-timestamp': timestamp,
				'x-three-signature': sign(secret, timestamp, body),
				'content-length': String(Buffer.byteLength(body)),
			},
			body,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		}, { maxBytes: 256 * 1024 });
		const text = await res.text().catch(() => '');
		if (!res.ok) throw typed(502, 'external_rejected', `${this.name} answered ${res.status}: ${text.slice(0, 200)}`);
		try {
			return text ? JSON.parse(text) : {};
		} catch {
			return {};
		}
	},

	async mirror(task) {
		const out = await this.post('task.mirrored', {
			task: publicTaskPayload(task, 'https://three.ws/api/human-tasks/external/callback'),
		});
		return { ref: String(out?.ref || out?.id || task.id).slice(0, 200) };
	},

	async withdraw(task) {
		await this.post('task.withdrawn', { task_id: task.id, ref: task.external_ref || null });
	},

	verifyCallback(req, rawBody) {
		const ok = verifySignature({
			secret: process.env.HUMAN_TASK_EXTERNAL_WEBHOOK_SECRET,
			timestamp: req.headers['x-three-timestamp'],
			signature: req.headers['x-three-signature'],
			body: rawBody,
		});
		if (!ok) throw typed(401, 'bad_signature', 'Callback signature is missing, stale or wrong.');
		let event;
		try {
			event = JSON.parse(rawBody);
		} catch {
			throw typed(400, 'bad_json', 'Callback body is not JSON.');
		}
		if (!event || typeof event.event !== 'string' || typeof event.task_id !== 'string') {
			throw typed(400, 'bad_event', 'Callback needs an event name and a task_id.');
		}
		return event;
	},
};

const ADAPTERS = [webhookAdapter];

/** The adapter that should receive mirrors, or null when none is configured. */
export function activeAdapter() {
	return ADAPTERS.find((a) => a.configured()) || null;
}

export function adapterByName(name) {
	return ADAPTERS.find((a) => a.name === name) || null;
}

/** What the docs and the status tools report about external fulfillment. */
export function externalStatus() {
	const a = activeAdapter();
	return a
		? { enabled: true, provider: a.name }
		: { enabled: false, provider: null, missing: ['HUMAN_TASK_EXTERNAL_WEBHOOK_URL', 'HUMAN_TASK_EXTERNAL_WEBHOOK_SECRET'] };
}
