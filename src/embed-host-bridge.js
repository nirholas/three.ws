// Host-page bridge for talking to an embedded <agent-3d> iframe.
// Consumed by the parent page (or lobehub-plugin/src/bridge.ts etc.).
// See specs/EMBED_SPEC.md §Bridge Protocol

const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BUFFERED_EVENTS = 256;

/** @returns {string} */
function genId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
		return crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

/**
 * Bidirectional postMessage bridge — host (parent-page) side.
 *
 * Wire format (all messages):
 *   { v:1, source:'agent-host'|'agent-3d', id, inReplyTo?, kind, op, payload }
 *
 * @example
 * const bridge = new EmbedHostBridge({ iframe, agentId: 'abc', allowedOrigin: 'https://three.ws/' });
 * await bridge.ready;
 * await bridge.speak('Hello world');
 * const unsub = bridge.on('action', (a) => console.log(a));
 */
export class EmbedHostBridge {
	/**
	 * @param {{ iframe: HTMLIFrameElement, agentId: string, allowedOrigin: string }} opts
	 */
	constructor({ iframe, agentId, allowedOrigin }) {
		this._iframe = iframe;
		this._agentId = agentId;
		this._allowedOrigin = allowedOrigin;
		this._pending = new Map(); // id → { resolve, reject, timer }
		this._listeners = { action: new Set(), state: new Set(), error: new Set() };
		this._outQueue = []; // requests queued before handshake completes
		this._evtBuffer = []; // incoming events buffered before a listener is attached
		this._ready = false;
		this._destroyed = false;

		this._onMessage = this._handleMessage.bind(this);
		window.addEventListener('message', this._onMessage);

		/** @type {Promise<{ agentId: string, capabilities: string[] }>} resolves after handshake */
		this.ready = new Promise((resolve, reject) => {
			this._resolveReady = resolve;
			this._rejectReady = reject;
		});
	}

	_send(msg) {
		this._iframe.contentWindow?.postMessage(
			{ ...msg, v: PROTOCOL_VERSION, source: 'agent-host' },
			this._allowedOrigin,
		);
	}

	_request(op, payload = {}) {
		return new Promise((resolve, reject) => {
			if (this._destroyed) {
				reject(new Error('EmbedHostBridge: destroyed'));
				return;
			}
			const id = genId();
			const timer = setTimeout(() => {
				this._pending.delete(id);
				reject(
					new Error(
						`TimeoutError: request "${op}" timed out after ${REQUEST_TIMEOUT_MS}ms`,
					),
				);
			}, REQUEST_TIMEOUT_MS);
			this._pending.set(id, { resolve, reject, timer });
			if (this._ready) {
				this._send({ id, kind: 'request', op, payload });
			} else {
				this._outQueue.push({ id, kind: 'request', op, payload });
			}
		});
	}

	_handleMessage(event) {
		if (event.source !== this._iframe.contentWindow) return;
		if (this._allowedOrigin !== '*' && event.origin !== this._allowedOrigin) return;
		const msg = event.data;
		if (!msg || msg.v !== PROTOCOL_VERSION || msg.source !== 'agent-3d') return;

		if (msg.kind === 'event' && msg.op === 'ready') {
			// Handshake step 1 — child announced ready, send ping
			this._send({ id: genId(), kind: 'request', op: 'ping', payload: {} });
			return;
		}

		if (msg.kind === 'response' && msg.op === 'pong') {
			// Handshake complete — flush queued outgoing requests
			this._ready = true;
			this._resolveReady({
				agentId: this._agentId,
				capabilities: msg.payload?.capabilities || [],
			});
			for (const m of this._outQueue) this._send(m);
			this._outQueue = [];
			return;
		}

		if (msg.kind === 'response' && msg.inReplyTo) {
			const entry = this._pending.get(msg.inReplyTo);
			if (entry) {
				clearTimeout(entry.timer);
				this._pending.delete(msg.inReplyTo);
				if (msg.payload?.error) entry.reject(new Error(msg.payload.error));
				else entry.resolve(msg.payload);
			}
			return;
		}

		if (msg.kind === 'event') {
			const bucket = msg.op === 'error' ? 'error' : msg.op === 'state' ? 'state' : 'action';
			const set = this._listeners[bucket];
			if (set?.size) {
				for (const h of set) h(msg.payload);
			} else {
				// Buffer events until a listener attaches; cap to avoid runaway
				if (this._evtBuffer.length >= MAX_BUFFERED_EVENTS) this._evtBuffer.shift();
				this._evtBuffer.push({ bucket, payload: msg.payload });
			}
		}
	}

	/** @param {string} text @param {object} [opts] @returns {Promise<void>} */
	speak(text, opts = {}) {
		return this._request('speak', { text, ...opts });
	}

	/** @param {string} name @returns {Promise<void>} */
	gesture(name) {
		return this._request('gesture', { name });
	}

	/** @param {{ trigger: string, weight: number }} emote @returns {Promise<void>} */
	emote({ trigger, weight }) {
		return this._request('emote', { trigger, weight });
	}

	/** @param {{ target: string }} look @returns {Promise<void>} */
	look({ target }) {
		return this._request('look', { target });
	}

	/** @param {string} nextAgentId @returns {Promise<void>} */
	setAgent(nextAgentId) {
		return this._request('setAgent', { agentId: nextAgentId });
	}

	/**
	 * Subscribe to events from the embedded agent.
	 * @param {'action'|'state'|'error'} event
	 * @param {Function} handler
	 * @returns {Function} unsubscribe
	 */
	on(event, handler) {
		const set = this._listeners[event];
		if (!set) throw new Error(`EmbedHostBridge: unknown event "${event}"`);
		set.add(handler);
		// Flush buffered events for this bucket
		const remaining = [];
		for (const item of this._evtBuffer) {
			if (item.bucket === event) handler(item.payload);
			else remaining.push(item);
		}
		this._evtBuffer = remaining;
		return () => set.delete(handler);
	}

	destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		window.removeEventListener('message', this._onMessage);
		for (const { timer, reject } of this._pending.values()) {
			clearTimeout(timer);
			reject(new Error('EmbedHostBridge: destroyed'));
		}
		this._pending.clear();
		this._outQueue = [];
		this._evtBuffer = [];
		this._rejectReady?.(new Error('EmbedHostBridge: destroyed'));
	}
}
