// Host-side client for an embedded HQ iframe (apps/hq). Wraps the postMessage
// bridge in promises: correlated requests (panel data, agent-tool queries,
// portfolio risk) and an opt-in hand-off of fired HQ alerts to the owner's
// agent as an Autopilot proposal. See docs/hq-agent-integration.md.
//
// Security: replies are accepted only from the HQ origin AND the HQ frame's own
// window, and a hand-off can only ever create a reversible, pending proposal.

const DEFAULT_TIMEOUT_MS = 25000;
const REPLY_TYPES = new Set(['hq:panel-data', 'hq:query-result', 'hq:error']);

let counter = 0;
function nextId() {
	counter += 1;
	return `h${Date.now().toString(36)}${counter}`;
}

/**
 * @param {object} opts
 * @param {HTMLIFrameElement} opts.frame        The HQ iframe.
 * @param {string} opts.origin                  Exact HQ origin, e.g. https://hq.example.
 * @param {string} [opts.agentId]               Owner's agent; enables alert hand-off.
 * @param {(url: string, init: object) => Promise<Response>} [opts.apiFetch]  Authenticated fetch (src/api.js apiFetch).
 * @param {Window} [opts.win]                   Window to listen on (tests).
 * @param {number} [opts.timeoutMs]
 */
export function createHqHost({ frame, origin, agentId, apiFetch, win = window, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	if (!frame) throw new Error('createHqHost: frame is required');
	const expected = new URL(origin).origin;
	const pending = new Map();
	const listeners = new Map();
	let disposed = false;

	const emitLocal = (type, payload) => {
		for (const fn of listeners.get(type) || []) {
			try {
				fn(payload);
			} catch (err) {
				console.error('[hq-host] listener failed', err);
			}
		}
	};

	async function handoff(payload) {
		if (!agentId || !apiFetch || payload?.handoff !== true) return null;
		const p = payload.proposal;
		if (!p || (p.kind !== 'briefing' && p.kind !== 'create_alert')) return null;
		const res = await apiFetch('/api/autopilot/proposals', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				agentId,
				action: 'propose',
				kind: p.kind,
				params: p.params,
				context: p.context,
				title: payload.name ? `HQ alert: ${payload.name}` : undefined,
				rationale: `Your HQ alert fired: ${payload.description}`,
			}),
		});
		const body = await res.json().catch(() => ({}));
		// 409 means an identical proposal is already pending, which is the desired end state.
		if (!res.ok && res.status !== 409) throw new Error(body.error_description || body.error || `HTTP ${res.status}`);
		return body.proposal || null;
	}

	function onMessage(event) {
		if (disposed || event.origin !== expected || event.source !== frame.contentWindow) return;
		const data = event.data;
		if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type.startsWith('hq:')) return;

		if (REPLY_TYPES.has(data.type)) {
			const id = data.payload?.id;
			const entry = typeof id === 'string' ? pending.get(id) : null;
			if (entry) {
				pending.delete(id);
				clearTimeout(entry.timer);
				if (data.type === 'hq:error') entry.reject(Object.assign(new Error(data.payload.message || 'HQ error'), { code: data.payload.code }));
				else entry.resolve(entry.pick(data.payload));
				return;
			}
		}

		emitLocal(data.type, data.payload);
		if (data.type === 'hq:alert-triggered') {
			handoff(data.payload)
				.then((proposal) => proposal && emitLocal('handoff', { proposal }))
				.catch((err) => emitLocal('handoff-error', { message: err.message }));
		}
	}
	win.addEventListener('message', onMessage);

	function request(type, payload, pick = (reply) => reply.result) {
		if (disposed) return Promise.reject(new Error('hq-host disposed'));
		const target = frame.contentWindow;
		if (!target) return Promise.reject(new Error('HQ frame is not loaded'));
		const id = nextId();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(Object.assign(new Error('HQ did not answer in time'), { code: 'timeout' }));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer, pick });
			target.postMessage({ type, payload: { ...payload, id } }, expected);
		});
	}

	return {
		/** Current data of an HQ panel (markets, polymarket, news-clusters, panels). */
		getPanelData: (key) => request('host:get-panel-data', { key }, (p) => p.data),
		/** Same request, resolving { key, data, updatedAt } (ISO string, or null before the panel has loaded). */
		getPanelSnapshot: (key) => request('host:get-panel-data', { key }, (p) => ({ key: p.key, data: p.data, updatedAt: p.updatedAt ?? null })),
		/** Run an HQ DeFi tool by name, e.g. runTool('top_yields', { chain: 'Solana' }). */
		runTool: (tool, args = {}) => request('host:run-query', { tool, args }),
		/** Ask a natural-language question; HQ routes it to a tool and narrates the result. */
		ask: (question) => request('host:run-query', { question }),
		/** Score caller-supplied positions: [{symbol, usd, protocol?, chain?}]. */
		getPortfolioRisk: (positions) => request('host:get-portfolio-risk', { positions }),
		/** Fire-and-forget HQ commands (apply-template, toggle-panel, show-panel, fly-to-country, request-state). */
		send(type, payload = {}) {
			frame.contentWindow?.postMessage({ type, payload }, expected);
		},
		/** Subscribe to HQ events (e.g. 'hq:ready', 'hq:alert-triggered') and to 'handoff' / 'handoff-error'. Returns an unsubscribe. */
		on(type, fn) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(fn);
			return () => listeners.get(type)?.delete(fn);
		},
		dispose() {
			disposed = true;
			win.removeEventListener('message', onMessage);
			for (const entry of pending.values()) {
				clearTimeout(entry.timer);
				entry.reject(new Error('hq-host disposed'));
			}
			pending.clear();
			listeners.clear();
		},
	};
}
