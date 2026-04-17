const HOST_TYPES = new Set(['host.hello', 'host.chat.message', 'host.action', 'host.theme', 'host.response']);
const EMBED_TYPES = new Set(['embed.ready', 'embed.event', 'embed.error', 'embed.request']);
const PROTOCOL_VERSION = 1;

let _warnedTypes = new Set();

function makeId() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class EmbedHostBridge extends EventTarget {
	constructor({ allowedOrigins = '*' } = {}) {
		super();
		this._allowedOrigins = allowedOrigins;
		this._pendingRequests = new Map();
		this._listener = null;
		this._started = false;
	}

	start() {
		if (this._started || typeof window === 'undefined') return;
		this._started = true;
		this._listener = (e) => this._onMessage(e);
		window.addEventListener('message', this._listener);
		// Send embed.ready to parent — payload filled by caller after construction
		// Callers should populate capabilities via send() after wiring up the agent
	}

	stop() {
		if (!this._started || typeof window === 'undefined') return;
		this._started = false;
		window.removeEventListener('message', this._listener);
		this._listener = null;
		for (const [, pending] of this._pendingRequests) {
			pending.reject(new Error('bridge stopped'));
		}
		this._pendingRequests.clear();
	}

	send(type, payload) {
		if (typeof window === 'undefined') return;
		if (!EMBED_TYPES.has(type)) {
			console.warn('[EmbedHostBridge] unknown outbound type:', type);
		}
		const msg = { v: PROTOCOL_VERSION, type };
		if (payload !== undefined) msg.payload = payload;
		window.parent.postMessage(msg, '*');
	}

	request(method, params, { timeout = 5000 } = {}) {
		return new Promise((resolve, reject) => {
			const id = makeId();
			const timer = setTimeout(() => {
				this._pendingRequests.delete(id);
				reject(new Error(`request timeout: ${method}`));
			}, timeout);

			this._pendingRequests.set(id, {
				resolve: (result) => {
					clearTimeout(timer);
					this._pendingRequests.delete(id);
					resolve(result);
				},
				reject: (err) => {
					clearTimeout(timer);
					this._pendingRequests.delete(id);
					reject(err);
				},
			});

			const msg = { v: PROTOCOL_VERSION, type: 'embed.request', id, payload: { method, params } };
			if (typeof window !== 'undefined') {
				window.parent.postMessage(msg, '*');
			}
		});
	}

	_originAllowed(origin) {
		if (this._allowedOrigins === '*') return true;
		if (Array.isArray(this._allowedOrigins)) return this._allowedOrigins.includes(origin);
		return false;
	}

	_onMessage(e) {
		if (e.source !== window.parent) return;
		if (!this._originAllowed(e.origin)) return;

		const msg = e.data;

		if (!msg || typeof msg !== 'object' || msg.v !== PROTOCOL_VERSION || typeof msg.type !== 'string') {
			// malformed — send error once
			const key = JSON.stringify(msg).slice(0, 80);
			if (!_warnedTypes.has(key)) {
				_warnedTypes.add(key);
				this.send('embed.error', { code: 'MALFORMED_MESSAGE', message: 'missing v:1 or type' });
			}
			return;
		}

		if (!HOST_TYPES.has(msg.type)) {
			if (!_warnedTypes.has(msg.type)) {
				_warnedTypes.add(msg.type);
				console.warn('[EmbedHostBridge] unknown inbound type (ignored):', msg.type);
			}
			return;
		}

		// Route host.response to pending requests
		if (msg.type === 'host.response' && msg.id) {
			const pending = this._pendingRequests.get(msg.id);
			if (pending) {
				if (msg.payload?.error) {
					pending.reject(Object.assign(new Error(msg.payload.error.message || 'request failed'), msg.payload.error));
				} else {
					pending.resolve(msg.payload?.result);
				}
			}
			return;
		}

		this.dispatchEvent(Object.assign(new CustomEvent(msg.type), { payload: msg.payload ?? null, msgId: msg.id ?? null }));
	}
}
