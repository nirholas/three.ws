// Per-stage speaking queue: one voice at a time on an <agent-stage>.
//
// Every agent on a stage has its own TTS pipeline, and browsers happily play
// two of them at once, so without this two agents answering the same cue talk
// over each other and both mouths move. The queue owns the floor: an agent asks
// to speak, and its line plays when the agent in front of it has finished.
//
// Pure and dependency-free. The stage injects `speak(agentId, text)`, which
// plays one line and resolves when it ends; this module only decides order.
//
// Rules, in the order they apply:
// - Priority: 'user' (someone spoke to this agent) beats 'broadcast' (a stage
//   cue every agent answers) beats 'ambient' (idle chatter, scripted asides).
//   Within one level, first in first out.
// - Never mid-utterance: a higher priority line jumps queued lines only. The
//   agent holding the floor always finishes (or is cancelled, or times out).
// - De-duplication: the same agent asking to say the same line (case and
//   whitespace folded) while it is queued or playing gets the existing request
//   back, promoted to the higher of the two priorities if it is still queued.
// - Depth: at most `maxDepth` lines wait. A new line in a full queue evicts the
//   oldest ambient line; failing that, a user line evicts the oldest broadcast
//   line; failing that, the new line is refused. User lines are never evicted.
// - A speaker that throws, rejects, or never ends (see `timeoutMs`) is settled
//   and the queue moves on, so one broken voice cannot silence the stage.

export const SPEECH_PRIORITIES = Object.freeze(['user', 'broadcast', 'ambient']);

const RANK = Object.freeze({ user: 0, broadcast: 1, ambient: 2 });
const AMBIENT = RANK.ambient;

/**
 * Default ceiling for one utterance: generous enough for slow voices and
 * network TTS that buffers before playing (about 2.5 words per second plus a
 * fixed allowance), short enough that a stuck engine does not hold the floor.
 */
export function defaultSpeechTimeout(text) {
	const words = String(text).trim().split(/\s+/).filter(Boolean).length;
	return 10_000 + words * 400;
}

const foldText = (text) => String(text).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * @typedef {'user' | 'broadcast' | 'ambient'} SpeechPriority
 * @typedef {{ agentId: string, text: string, priority: SpeechPriority, startedAt?: number }} SpeechLine
 * @typedef {{
 *   status: 'spoken' | 'dropped' | 'cancelled' | 'error' | 'timeout',
 *   agentId: string,
 *   text: string,
 *   priority: SpeechPriority,
 *   reason?: string,
 *   error?: string,
 * }} SpeechOutcome
 */

/**
 * @param {{
 *   speak: (agentId: string, text: string) => Promise<unknown> | unknown,
 *   cancel?: (agentId: string) => void,
 *   onChange?: (speaking: SpeechLine | null, previous: SpeechLine | null) => void,
 *   maxDepth?: number,
 *   timeoutMs?: number | ((text: string) => number),
 *   now?: () => number,
 * }} options
 */
export function createStageSpeechQueue({
	speak,
	cancel,
	onChange,
	maxDepth = 8,
	timeoutMs = defaultSpeechTimeout,
	now = () => Date.now(),
} = {}) {
	if (typeof speak !== 'function') {
		throw new TypeError('createStageSpeechQueue: speak(agentId, text) is required');
	}
	const depth = Math.max(1, Math.floor(maxDepth) || 1);
	const timeoutFor = typeof timeoutMs === 'function' ? timeoutMs : () => timeoutMs;

	/** Waiting lines, kept sorted: by rank, then arrival. */
	const queue = [];
	/** The line holding the floor, or null. */
	let current = null;
	let seq = 0;

	const publicLine = (item) =>
		item
			? {
					agentId: item.agentId,
					text: item.text,
					priority: SPEECH_PRIORITIES[item.rank],
					...(item.startedAt != null ? { startedAt: item.startedAt } : {}),
				}
			: null;

	const outcome = (item, status, extra = {}) => ({
		status,
		agentId: item.agentId,
		text: item.text,
		priority: SPEECH_PRIORITIES[item.rank],
		...extra,
	});

	const settle = (item, result) => {
		if (item.settled) return;
		item.settled = true;
		item.resolve(result);
	};

	/** Insert after the last waiting line of the same or higher priority. */
	const insert = (item) => {
		let at = queue.length;
		while (at > 0 && queue[at - 1].rank > item.rank) at--;
		queue.splice(at, 0, item);
	};

	const setCurrent = (item) => {
		const previous = current;
		current = item;
		if (previous === item) return;
		try {
			onChange?.(publicLine(item), publicLine(previous));
		} catch {
			// A listener's failure is the listener's; the floor still moves.
		}
	};

	const finish = (item, result) => {
		if (current !== item) return; // already cancelled or timed out
		clearTimeout(item.timer);
		settle(item, result);
		next();
	};

	function next() {
		const item = queue.shift() || null;
		setCurrent(item);
		if (!item) return;
		item.startedAt = now();
		const limit = Number(timeoutFor(item.text));
		if (Number.isFinite(limit) && limit > 0) {
			item.timer = setTimeout(() => {
				if (current !== item) return;
				stopSpeaker(item.agentId);
				finish(item, outcome(item, 'timeout', { reason: `no end after ${limit}ms` }));
			}, limit);
		}
		let playing;
		try {
			playing = Promise.resolve(speak(item.agentId, item.text));
		} catch (err) {
			playing = Promise.reject(err);
		}
		playing.then(
			() => finish(item, outcome(item, 'spoken')),
			(err) => finish(item, outcome(item, 'error', { error: err?.message || String(err) })),
		);
	}

	function stopSpeaker(agentId) {
		try {
			cancel?.(agentId);
		} catch {
			// The engine may already be gone (agent removed); the floor moves regardless.
		}
	}

	/** Make room for `incoming` in a full queue; false when it should be refused. */
	function makeRoom(incoming) {
		if (queue.length < depth) return true;
		let victim = queue.findIndex((q) => q.rank === AMBIENT);
		if (victim < 0 && incoming.rank === RANK.user) {
			victim = queue.findIndex((q) => q.rank === RANK.broadcast);
		}
		if (victim < 0) return false;
		const [dropped] = queue.splice(victim, 1);
		settle(dropped, outcome(dropped, 'dropped', { reason: 'queue full' }));
		return true;
	}

	return {
		/**
		 * Ask for the floor. Resolves (never rejects) once the line has played or
		 * was dropped, cancelled, failed, or timed out.
		 * @param {string} agentId
		 * @param {string} text
		 * @param {{ priority?: SpeechPriority }} [opts]
		 * @returns {Promise<SpeechOutcome>}
		 */
		enqueue(agentId, text, { priority = 'ambient' } = {}) {
			if (!Object.hasOwn(RANK, priority)) {
				throw new RangeError(
					`stage speech priority must be one of ${SPEECH_PRIORITIES.join(', ')}; got "${priority}"`,
				);
			}
			const rank = RANK[priority];
			const line = String(text ?? '');
			const id = String(agentId);
			if (!line.trim()) {
				return Promise.resolve({ status: 'dropped', agentId: id, text: line, priority, reason: 'empty' });
			}

			const key = `${id}\u0000${foldText(line)}`;
			if (current && current.key === key) return current.promise;
			const dup = queue.find((q) => q.key === key);
			if (dup) {
				if (rank < dup.rank) {
					queue.splice(queue.indexOf(dup), 1);
					dup.rank = rank;
					insert(dup);
				}
				return dup.promise;
			}

			const item = { id: ++seq, agentId: id, text: line, rank, key, settled: false };
			item.promise = new Promise((resolve) => {
				item.resolve = resolve;
			});
			if (!current) {
				queue.push(item);
				next();
				return item.promise;
			}
			if (!makeRoom(item)) {
				settle(item, outcome(item, 'dropped', { reason: 'queue full' }));
				return item.promise;
			}
			insert(item);
			return item.promise;
		},

		/**
		 * Remove an agent's lines: queued ones are dropped and its current line is
		 * stopped through `cancel(agentId)`. Returns how many lines were cancelled.
		 */
		cancelAgent(agentId) {
			const id = String(agentId);
			let count = 0;
			for (let i = queue.length - 1; i >= 0; i--) {
				if (queue[i].agentId !== id) continue;
				const [item] = queue.splice(i, 1);
				settle(item, outcome(item, 'cancelled', { reason: 'agent removed' }));
				count++;
			}
			if (current && current.agentId === id) {
				const item = current;
				count++;
				stopSpeaker(id);
				finish(item, outcome(item, 'cancelled', { reason: 'agent removed' }));
			}
			return count;
		},

		/** Cancel every waiting line and stop the current one. */
		clear() {
			for (const item of queue.splice(0)) {
				settle(item, outcome(item, 'cancelled', { reason: 'stage cleared' }));
			}
			if (current) {
				const item = current;
				stopSpeaker(item.agentId);
				clearTimeout(item.timer);
				settle(item, outcome(item, 'cancelled', { reason: 'stage cleared' }));
				setCurrent(null);
			}
		},

		/** The line holding the floor, or null when the stage is silent. */
		get speaking() {
			return publicLine(current);
		},

		/** Waiting lines in the order they will play. */
		get pending() {
			return queue.map(publicLine);
		},

		/** Number of waiting lines (not counting the one playing). */
		get size() {
			return queue.length;
		},
	};
}
