// Cross-instance fan-out for the signed internal webhooks.
//
// /internal/notify, /internal/stage and /internal/announce are each answered by
// ONE Cloud Run instance, but the socket, the StageRoom or the walk rooms they
// target may live on another. With the Redis presence wired (REDIS_URI) every
// instance subscribes to one shared channel here: the instance that received
// the webhook handles it locally, publishes it, and every peer handles it
// against its own sockets/rooms and answers on a per-request ack channel. The
// caller waits a short, bounded time for acks so the webhook response still
// says whether the event was delivered somewhere.
//
// Without Redis presence there is exactly one instance and nothing to fan out:
// request() resolves to an empty list immediately and no channel is opened.

import crypto from 'node:crypto';

const CHANNEL = 'three-ws:fanout';
const ackChannel = (id) => `${CHANNEL}:ack:${id}`;

export const DEFAULT_ACK_WAIT_MS = 300;

export function createFanout({ presence, handlers, instanceId = crypto.randomUUID(), ackWaitMs = DEFAULT_ACK_WAIT_MS }) {
	if (!presence) {
		return { enabled: false, instanceId, request: async () => [], dispose: async () => {} };
	}

	const onMessage = async (msg) => {
		if (!msg || msg.origin === instanceId || typeof msg.id !== 'string') return;
		const handler = handlers[msg.kind];
		if (typeof handler !== 'function') return;
		let result;
		try {
			result = await handler(msg.payload);
		} catch (err) {
			result = { error: String(err?.message || err) };
		}
		try {
			await presence.publish(ackChannel(msg.id), { origin: instanceId, result });
		} catch (err) {
			console.warn('[fanout] ack publish failed:', err?.message || err);
		}
	};
	presence.subscribe(CHANNEL, onMessage);

	/**
	 * Publish `kind` to every peer and collect their results.
	 * `until(results)` lets the caller stop waiting early (e.g. first delivered).
	 * Resolves to the acks received within ackWaitMs; never rejects.
	 */
	async function request(kind, payload, { until, waitMs = ackWaitMs } = {}) {
		const id = crypto.randomUUID();
		const results = [];
		let done;
		const finished = new Promise((resolve) => { done = resolve; });
		const onAck = (ack) => {
			if (!ack || ack.origin === instanceId) return;
			results.push(ack.result);
			if (typeof until === 'function' && until(results)) done();
		};
		const timer = setTimeout(done, waitMs);
		try {
			await presence.subscribe(ackChannel(id), onAck);
			await presence.publish(CHANNEL, { id, origin: instanceId, kind, payload });
			await finished;
		} catch (err) {
			console.warn(`[fanout] ${kind} publish failed:`, err?.message || err);
		} finally {
			clearTimeout(timer);
			try { await presence.unsubscribe(ackChannel(id), onAck); } catch { /* connection closing */ }
		}
		return results;
	}

	return {
		enabled: true,
		instanceId,
		request,
		async dispose() { try { await presence.unsubscribe(CHANNEL, onMessage); } catch { /* connection closing */ } },
	};
}
