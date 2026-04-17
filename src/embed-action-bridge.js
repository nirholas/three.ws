// Agent-side postMessage bridge — lives inside <agent-3d> when running inside an iframe.
// Translates host requests into AgentProtocol events and mirrors agent events back to the host.
// See specs/EMBED_SPEC.md §Bridge Protocol

const PROTOCOL_VERSION = 1;
const MAX_QUEUED_EVENTS = 256;

/** @returns {string} */
function genId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
		return crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

/** Maps bridge op names to AgentProtocol action types. */
const OP_TO_ACTION = {
	speak: 'speak',
	gesture: 'gesture',
	emote: 'emote',
	look: 'look-at',
};

/**
 * Agent-side bridge. Receives host requests via postMessage and emits them onto the
 * AgentProtocol bus. Optionally mirrors protocol events back to the host when the
 * host opts in with a `subscribe` request.
 *
 * Host must send `{ kind:'request', op:'subscribe' }` to receive action events —
 * events are NOT leaked by default.
 */
export class EmbedActionBridge {
	/**
	 * @param {{ protocol: object, avatar?: object, manifest: object, window: Window }} opts
	 */
	constructor({ protocol, avatar = null, manifest, window: win }) {
		this._protocol = protocol;
		this._avatar = avatar; // reserved for future direct avatar control
		this._manifest = manifest;
		this._win = win;
		this._subscribed = false; // host must explicitly subscribe to receive events
		this._evtQueue = []; // events queued before host subscribes
		this._running = false;
		this._onMessage = this._handleMessage.bind(this);
		this._onAction = this._handleAction.bind(this);
	}

	start() {
		if (this._running) return;
		this._running = true;
		this._win.addEventListener('message', this._onMessage);
		this._protocol.on('*', this._onAction);

		// Announce ready to the parent — triggers the ping/pong handshake
		const agentId = this._manifest?.id?.agentId || this._manifest?.agentId || '';
		const capabilities = [...Object.keys(OP_TO_ACTION), 'setAgent', 'ping', 'subscribe'];
		this._toParent({ kind: 'event', op: 'ready', payload: { agentId, capabilities } });
	}

	stop() {
		if (!this._running) return;
		this._running = false;
		this._win.removeEventListener('message', this._onMessage);
		this._protocol.off('*', this._onAction);
		this._evtQueue = [];
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	_allowedOrigins() {
		const policy = this._manifest?.policy;
		if (!policy) return [];
		const list = policy.origins || policy.allowlist || [];
		return Array.isArray(list) ? list : [list];
	}

	_originAllowed(origin) {
		const allowed = this._allowedOrigins();
		// If no policy restriction, accept any origin (fail-open matches embed-policy spec)
		if (allowed.length === 0) return true;
		return allowed.some((o) => {
			if (o === '*') return true;
			try {
				return new URL(o).origin === origin;
			} catch {
				return o === origin;
			}
		});
	}

	_toParent(msg) {
		// Use '*' as targetOrigin — we don't know the parent's origin at construction time.
		// Incoming messages are validated via _originAllowed before acting on them.
		this._win.parent.postMessage(
			{ ...msg, v: PROTOCOL_VERSION, source: 'agent-3d', id: msg.id || genId() },
			'*',
		);
	}

	_reply(req, payload) {
		this._toParent({
			id: genId(),
			inReplyTo: req.id,
			kind: 'response',
			op: req.op === 'ping' ? 'pong' : req.op,
			payload,
		});
	}

	_replyError(req, code, message) {
		this._toParent({
			id: genId(),
			inReplyTo: req.id,
			kind: 'response',
			op: req.op,
			payload: { error: `${code}: ${message}` },
		});
	}

	// ── Incoming (host → agent) ───────────────────────────────────────────────

	_handleMessage(event) {
		if (event.source !== this._win.parent) return;
		if (!this._originAllowed(event.origin)) return;
		const msg = event.data;
		if (!msg || msg.v !== PROTOCOL_VERSION || msg.source !== 'agent-host') return;
		if (msg.kind !== 'request') return;

		const { op, payload = {} } = msg;

		if (op === 'ping') {
			this._reply(msg, { capabilities: [...Object.keys(OP_TO_ACTION), 'subscribe'] });
			return;
		}

		if (op === 'subscribe') {
			this._subscribed = true;
			this._reply(msg, { ok: true });
			// Flush any events queued before subscription
			for (const e of this._evtQueue) this._toParent(e);
			this._evtQueue = [];
			return;
		}

		if (op === 'setAgent') {
			// Runtime agent-switching requires a src attribute change on the host iframe.
			this._replyError(
				msg,
				'not_supported',
				'setAgent requires host to update the iframe src',
			);
			return;
		}

		const actionType = OP_TO_ACTION[op];
		if (!actionType) {
			this._replyError(msg, 'unknown_op', `Unknown op "${op}"`);
			return;
		}

		try {
			this._protocol.emit({ type: actionType, payload });
			this._reply(msg, { ok: true });
		} catch (err) {
			this._replyError(msg, 'emit_failed', err?.message || String(err));
		}
	}

	// ── Outgoing (agent → host) ───────────────────────────────────────────────

	_handleAction(action) {
		if (!this._running) return;
		const evt = {
			id: genId(),
			kind: 'event',
			op: 'action',
			payload: {
				type: action.type,
				payload: action.payload,
				agentId: action.agentId,
			},
		};

		if (!this._subscribed) {
			// Cap queue to prevent memory runaway; drop oldest
			if (this._evtQueue.length >= MAX_QUEUED_EVENTS) this._evtQueue.shift();
			this._evtQueue.push(evt);
			return;
		}
		this._toParent(evt);
	}
}
