// Fire-and-forget usage event logging. Failures must never impact the request.

import { sql } from './db.js';

export function recordEvent(evt) {
	// Intentionally not awaited in callers; we swallow errors here.
	queueMicrotask(async () => {
		try {
			await sql`
				insert into usage_events (user_id, api_key_id, client_id, avatar_id, agent_id, kind, tool, status, bytes, latency_ms, meta)
				values (
					${evt.userId ?? null},
					${evt.apiKeyId ?? null},
					${evt.clientId ?? null},
					${evt.avatarId ?? null},
					${evt.agentId ?? null},
					${evt.kind},
					${evt.tool ?? null},
					${evt.status ?? 'ok'},
					${evt.bytes ?? null},
					${evt.latencyMs ?? null},
					${JSON.stringify(evt.meta ?? {})}::jsonb
				)
			`;
		} catch (err) {
			console.warn('[usage] write failed', err?.message);
		}
	});
}

export function logger(name) {
	return {
		info: (msg, meta = {}) => console.log(JSON.stringify({ lvl: 'info', name, msg, ...meta })),
		warn: (msg, meta = {}) => console.warn(JSON.stringify({ lvl: 'warn', name, msg, ...meta })),
		error: (msg, meta = {}) =>
			console.error(JSON.stringify({ lvl: 'error', name, msg, ...meta })),
	};
}
