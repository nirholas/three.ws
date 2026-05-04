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
	 * @param {{
	 *   protocol: object,
	 *   avatar?: object,
	 *   manifest: object,
	 *   window: Window,
	 *   getClips?: () => Array<{name:string, label?:string, icon?:string, loop?:boolean, source?:string}>,
	 * }} opts
	 */
	constructor({ protocol, avatar = null, manifest, window: win, getClips = null }) {
		this._protocol = protocol;
		this._avatar = avatar; // reserved for future direct avatar control
		this._manifest = manifest;
		this._win = win;
		this._getClips = getClips;
		this._subscribed = false; // host must explicitly subscribe to receive events
		this._evtQueue = []; // events queued before host subscribes
		this._running = false;
		this._onMessage = this._handleMessage.bind(this);
		this._onAction = this._handleAction.bind(this);
		// Parent origin is locked to ev.origin of the first valid host message.
		// Best-effort seed from document.referrer so we can announce 'ready' to a
		// known origin instead of '*'.
		this._parentOrigin = this._seedParentOrigin();
		this._parentOriginLocked = false;
	}

	_seedParentOrigin() {
		try {
			if (this._win.parent === this._win) return this._win.location.origin;
			const ref = this._win.document?.referrer;
			if (ref) return new URL(ref).origin;
		} catch {}
		return null;
	}

	start() {
		if (this._running) return;
		this._running = true;
		this._win.addEventListener('message', this._onMessage);
		this._protocol.on('*', this._onAction);

		// Announce ready to the parent — triggers the ping/pong handshake
		const agentId = this._manifest?.id?.agentId || this._manifest?.agentId || '';
		const capabilities = [...Object.keys(OP_TO_ACTION), 'setAgent', 'ping', 'subscribe', 'listClips'];
		this._toParent({ kind: 'event', op: 'ready', payload: { agentId, capabilities } });
	}

	/**
	 * Notify the host that the available clip list has changed (e.g. after a
	 * model swap). Host receives `{ kind:'event', op:'clips', payload:{ clips: [...] } }`.
	 * No-op if the host hasn't subscribed yet — event is queued like other events.
	 */
	emitClipsChanged() {
		if (!this._running) return;
		const clips = this._safeGetClips();
		const evt = {
			id: genId(),
			kind: 'event',
			op: 'clips',
			payload: { clips },
		};
		if (this._subscribed) {
			this._toParent(evt);
		} else {
			if (this._evtQueue.length >= MAX_QUEUED_EVENTS) this._evtQueue.shift();
			this._evtQueue.push(evt);
		}
	}

	_safeGetClips() {
		if (typeof this._getClips !== 'function') return [];
		try {
			const list = this._getClips();
			return Array.isArray(list) ? list : [];
		} catch (err) {
			console.warn('[embed-action-bridge] getClips failed', err);
			return [];
		}
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
		// Origin lockdown: we never post with '*'. Until we observe a valid host
		// message we use the referrer-derived origin (best effort); after we lock,
		// we use the host's actual origin.
		if (!this._parentOrigin) {
			console.warn('[embed-action-bridge] parent origin unknown; dropping', msg.op);
			return;
		}
		this._win.parent.postMessage(
			{ ...msg, v: PROTOCOL_VERSION, source: 'agent-3d', id: msg.id || genId() },
			this._parentOrigin,
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

		// Lock the parent origin to the first authenticated message we observe.
		// Subsequent messages from a different origin are rejected, even if they
		// were nominally allowed by the manifest policy.
		if (!this._parentOriginLocked) {
			this._parentOrigin = event.origin;
			this._parentOriginLocked = true;
		} else if (event.origin !== this._parentOrigin) {
			return;
		}

		const { op, payload = {} } = msg;

		if (op === 'ping') {
			this._reply(msg, { capabilities: [...Object.keys(OP_TO_ACTION), 'subscribe', 'listClips'] });
			return;
		}

		if (op === 'listClips') {
			this._reply(msg, { clips: this._safeGetClips() });
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
