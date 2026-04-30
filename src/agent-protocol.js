/**
 * Agent Action Protocol
 * ---------------------
 * The zero-dependency event bus that every module speaks through.
 * Every action emitted here is visible — agents are not invisible JSON.
 *
 * Actions flow: Skills → Protocol → Avatar (renders) + Identity (logs) + Memory (stores)
 */

export const ACTION_TYPES = {
	SPEAK: 'speak', // agent says something (text + sentiment)
	THINK: 'think', // agent is processing (internal monologue)
	GESTURE: 'gesture', // named body gesture (point, wave, nod, shrug)
	EMOTE: 'emote', // direct emotion injection (concern, celebrate…)
	LOOK_AT: 'look-at', // agent looks at a world position or object
	PERFORM_SKILL: 'perform-skill', // a skill is starting execution
	SKILL_DONE: 'skill-done', // a skill finished (success + result payload)
	SKILL_ERROR: 'skill-error', // a skill failed
	REMEMBER: 'remember', // agent stored a memory
	SIGN: 'sign', // agent signs an action with its wallet
	LOAD_START: 'load-start', // model/asset loading started
	LOAD_END: 'load-end', // model/asset loading finished
	VALIDATE: 'validate', // validation result (errors, warnings, hints)
	PRESENCE: 'presence', // agent came online / went idle
	PROTOCOL_ERROR: 'protocol-error', // emitted by the rate limiter on cascade detection
	PERMISSIONS_REDEEM_START: 'permissions.redeem.start',
	PERMISSIONS_REDEEM_SUCCESS: 'permissions.redeem.success',
	PERMISSIONS_REDEEM_ERROR: 'permissions.redeem.error',
};

/**
 * @typedef {Object} ActionPayload
 * @property {string} type        — one of ACTION_TYPES
 * @property {Object} payload     — action-specific data
 * @property {number} timestamp   — Date.now()
 * @property {string} agentId     — identity id of the emitting agent
 * @property {string} [sourceSkill] — skill name if emitted by a skill
 */

export class AgentProtocol extends EventTarget {
	constructor() {
		super();
		this._history = [];
		this._maxHistory = 200;

		// Rate limiter state
		this._counters = new Map();   // eventType → { count, windowStart }
		this._throttled = new Set();  // event types currently rate-limited
		this._limits = {
			'perform-skill': 10,
			'emote': 20,
			'speak': 5,
			'*': 100,
		};
		this._windowMs = 100;
		this._cooldownMs = 1000;

		/** Set to true at runtime to log all emits instead of rate-limiting. */
		this.debug = false;
	}

	/**
	 * Emit a typed action to all listeners.
	 * @param {Omit<ActionPayload, 'timestamp'>} action
	 */
	emit(action) {
		if (this.debug) {
			console.log(`[agent-protocol] ${Date.now()} ${action.type}`, action.payload);
		} else if (this._isThrottled(action.type)) {
			console.warn(`[agent-protocol] rate-limited: ${action.type} — too many events`);
			return;
		}

		const full = {
			type: action.type,
			payload: action.payload || {},
			timestamp: Date.now(),
			agentId: action.agentId || 'default',
			sourceSkill: action.sourceSkill || null,
		};

		// Trim history
		this._history.push(full);
		if (this._history.length > this._maxHistory) {
			this._history.shift();
		}

		this.dispatchEvent(new CustomEvent(full.type, { detail: full }));
		// Also dispatch a wildcard so listeners can monitor all traffic
		this.dispatchEvent(new CustomEvent('*', { detail: full }));
	}

	_isThrottled(type) {
		if (this._throttled.has(type)) return true;

		const now = Date.now();
		const counter = this._counters.get(type) || { count: 0, windowStart: now };

		if (now - counter.windowStart > this._windowMs) {
			counter.count = 1;
			counter.windowStart = now;
			this._counters.set(type, counter);
			return false;
		}

		counter.count++;
		this._counters.set(type, counter);

		const limit = this._limits[type] ?? this._limits['*'];
		if (counter.count > limit) {
			this._throttle(type);
			return true;
		}
		return false;
	}

	_throttle(type) {
		this._throttled.add(type);
		if (type !== 'protocol-error') {
			this._dispatchDirect('protocol-error', {
				code: 'rate_limited',
				eventType: type,
				message: `Event type "${type}" rate-limited — too many emissions in ${this._windowMs}ms`,
			});
		}
		setTimeout(() => {
			this._throttled.delete(type);
			this._counters.delete(type);
		}, this._cooldownMs);
	}

	// Bypasses the rate limiter — only for internal protocol-error emission.
	_dispatchDirect(type, payload) {
		const full = {
			type,
			payload,
			timestamp: Date.now(),
			agentId: 'protocol',
			sourceSkill: null,
		};
		this._history.push(full);
		if (this._history.length > this._maxHistory) this._history.shift();
		this.dispatchEvent(new CustomEvent(type, { detail: full }));
		this.dispatchEvent(new CustomEvent('*', { detail: full }));
	}

	/**
	 * Subscribe to a specific action type (or '*' for all).
	 * @param {string} type
	 * @param {(action: ActionPayload) => void} handler
	 */
	on(type, handler) {
		this._wrap(type, handler, false);
	}

	/**
	 * Subscribe once.
	 * @param {string} type
	 * @param {(action: ActionPayload) => void} handler
	 */
	once(type, handler) {
		this._wrap(type, handler, true);
	}

	/**
	 * Unsubscribe. Must pass the same handler reference as used in on().
	 * @param {string} type
	 * @param {Function} handler
	 */
	off(type, handler) {
		if (handler.__protocolWrapped) {
			this.removeEventListener(type, handler.__protocolWrapped);
		} else {
			this.removeEventListener(type, handler);
		}
	}

	/** @returns {ActionPayload[]} Recent action history (newest last) */
	get history() {
		return this._history.slice();
	}

	/** Returns last N actions of a given type */
	recent(type, n = 10) {
		return this._history.filter((a) => a.type === type).slice(-n);
	}

	_wrap(type, handler, once) {
		const wrapped = (e) => handler(e.detail);
		handler.__protocolWrapped = wrapped;
		if (once) {
			this.addEventListener(type, wrapped, { once: true });
		} else {
			this.addEventListener(type, wrapped);
		}
	}
}

// Singleton — import this everywhere
export const protocol = new AgentProtocol();
export default protocol;
