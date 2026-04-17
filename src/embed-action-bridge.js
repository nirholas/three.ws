import { ACTION_TYPES } from './agent-protocol.js';

const _debugLogged = new Set();

function _debugOnce(msg) {
	if (!_debugLogged.has(msg)) {
		_debugLogged.add(msg);
		console.debug('[EmbedActionBridge]', msg);
	}
}

/**
 * Glue layer between EmbedHostBridge postMessage events and the agent protocol bus.
 * Host → Agent: translates `host.*` events into protocol.emit() calls.
 * Agent → Host: relays protocol events back to the host via bridge.send('embed.event').
 */
export class EmbedActionBridge {
	/**
	 * @param {{ bridge: EventTarget & { send: Function }, protocol: import('./agent-protocol.js').AgentProtocol }} opts
	 */
	constructor({ bridge, protocol }) {
		this._bridge = bridge;
		this._protocol = protocol;
		this._hostHandlers = new Map();
		this._protocolHandlers = new Map();
	}

	start() {
		this._listenHost('host.chat.message', (e) => this._onChatMessage(e));
		this._listenHost('host.action', (e) => this._onHostAction(e));
		this._listenHost('host.theme', (e) => this._onHostTheme(e));

		// Agent → Host relay
		this._listenProtocol(ACTION_TYPES.SPEAK,   (a) => this._relayEvent('agent.speaking', { text: a.payload.text, sentiment: a.payload.sentiment }));
		this._listenProtocol(ACTION_TYPES.EMOTE,   (a) => this._relayEvent('agent.emote',    a.payload));
		this._listenProtocol(ACTION_TYPES.REMEMBER,(a) => this._relayEvent('agent.memory',   a.payload));
		this._listenProtocol(ACTION_TYPES.PRESENCE,(a) => this._relayEvent('agent.idle',     a.payload));
	}

	stop() {
		for (const [type, fn] of this._hostHandlers) {
			this._bridge.removeEventListener(type, fn);
		}
		this._hostHandlers.clear();

		for (const [type, fn] of this._protocolHandlers) {
			this._protocol.off(type, fn);
		}
		this._protocolHandlers.clear();
	}

	// ── Host → Agent ─────────────────────────────────────────────────────────

	_onChatMessage(e) {
		const p = e.payload;
		if (!p || typeof p.text !== 'string') {
			_debugOnce('host.chat.message missing text — ignored');
			return;
		}
		if (p.role === 'user') {
			// User spoke into the host chat; treat as input directed at the agent.
			this._protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text: p.text, sentiment: 0, _from: 'user' } });
		} else if (p.role === 'assistant') {
			// Assistant turn delivered from the host — agent should voice/display it.
			// TTS does not auto-fire here; runtime/speech.js may consume SPEAK events if wired.
			this._protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text: p.text, sentiment: 0.3, _from: 'assistant' } });
		} else {
			_debugOnce(`host.chat.message unknown role "${p.role}" — ignored`);
		}
	}

	_onHostAction(e) {
		const p = e.payload;
		if (!p || typeof p.action !== 'string') {
			_debugOnce('host.action missing action string — ignored');
			return;
		}

		const action = p.action;
		const args = p.args && typeof p.args === 'object' ? p.args : {};

		if (action === 'speak') {
			if (typeof args.text !== 'string') {
				_debugOnce('host.action speak missing args.text — ignored');
				return;
			}
			this._protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text: args.text, sentiment: 0, _from: 'host' } });
			return;
		}

		if (action.startsWith('emote.')) {
			const suffix = action.slice('emote.'.length);
			if (!suffix) {
				_debugOnce('host.action emote with no suffix — ignored');
				return;
			}
			// Capitalize first letter for conventional clip names (wave → Wave)
			const name = suffix.charAt(0).toUpperCase() + suffix.slice(1);
			this._protocol.emit({ type: ACTION_TYPES.GESTURE, payload: { name, duration: args.duration ?? 2 } });
			return;
		}

		_debugOnce(`host.action unknown action "${action}" — ignored`);
	}

	_onHostTheme(e) {
		const p = e.payload;
		if (!p || typeof p.mode !== 'string') {
			_debugOnce('host.theme missing mode — ignored');
			return;
		}
		if (typeof document !== 'undefined') {
			document.body.dataset.theme = p.mode;
		}
	}

	// ── Agent → Host ─────────────────────────────────────────────────────────

	_relayEvent(event, data) {
		this._bridge.send('embed.event', { event, data: data ?? {} });
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	_listenHost(type, fn) {
		this._bridge.addEventListener(type, fn);
		this._hostHandlers.set(type, fn);
	}

	_listenProtocol(type, fn) {
		this._protocol.on(type, fn);
		this._protocolHandlers.set(type, fn);
	}
}
