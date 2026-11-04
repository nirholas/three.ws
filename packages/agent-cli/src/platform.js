// The three.ws REST API (/api/v1) the local agent reads and writes: the
// account (`/me`), its agents and their runs, and server automations (the
// server half of a cron schedule). Every call carries the account's bearer
// credential and unwraps the `{ data, meta }` envelope, so callers get plain
// objects and an ApiError that names the server's own code and message.

import { ApiError, requestJson } from './http.js';

/** A 401 from three.ws means the key itself is no longer good: say which one and how to replace it. */
function keyRejected(credential, err) {
	const fix =
		credential.source === 'env THREE_WS_API_KEY'
			? 'update THREE_WS_API_KEY with a current key, or unset it and run `three-ws-agent login`'
			: 'run `three-ws-agent login` to sign this machine in again';
	return new ApiError(`three.ws rejected the API key from ${credential.source}: it was revoked, has expired or was mistyped; ${fix}.`, { status: 401, code: 'key_rejected', body: err.body });
}

export function createPlatform({ origin, credential, fetchTimeoutMs = 20_000 }) {
	const base = `${String(origin).replace(/\/+$/, '')}/api/v1`;

	async function call(method, path, { json, query } = {}) {
		if (!credential?.token) {
			throw new ApiError('Not signed in to three.ws. Run `three-ws-agent login`, or set THREE_WS_API_KEY.', { code: 'not_signed_in' });
		}
		const url = new URL(`${base}${path}`);
		for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
		let body;
		try {
			body = await requestJson(url.href, {
				method,
				json,
				timeoutMs: fetchTimeoutMs,
				headers: { authorization: `Bearer ${credential.token}` },
			});
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) throw keyRejected(credential, err);
			throw err;
		}
		return { data: body?.data ?? null, meta: body?.meta || {} };
	}

	return {
		base,
		async me() {
			return (await call('GET', '/me')).data;
		},
		async listAgents({ limit = 50 } = {}) {
			return (await call('GET', '/agents', { query: { limit } })).data || [];
		},
		async getAgent(id) {
			return (await call('GET', `/agents/${encodeURIComponent(id)}`)).data;
		},
		async listRuns(agentId, { limit = 10 } = {}) {
			return (await call('GET', `/agents/${encodeURIComponent(agentId)}/runs`, { query: { limit } })).data || [];
		},
		async listAutomations({ limit = 100 } = {}) {
			return (await call('GET', '/automations', { query: { limit } })).data || [];
		},
		/** The exact body `createAutomationRoute` (api/v1/rest.js) accepts for a scheduled prompt. */
		async createScheduleAutomation({ agentId, title, cron, prompt }) {
			const json = {
				agentId,
				title: String(title || '').slice(0, 80),
				trigger: { type: 'schedule', cron },
				action: { type: 'agent_prompt', prompt },
			};
			return (await call('POST', '/automations', { json })).data;
		},
		async deleteAutomation(id) {
			return (await call('DELETE', `/automations/${encodeURIComponent(id)}`)).data;
		},
	};
}
