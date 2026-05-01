import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentProtocol } from '../src/agent-protocol.js';

// Node 18+ provides EventTarget, CustomEvent, and performance globally.
// These tests use vi.useFakeTimers() to control setTimeout and performance.now().

describe('AgentProtocol throttle policies', () => {
	let protocol;

	beforeEach(() => {
		vi.useFakeTimers();
		protocol = new AgentProtocol();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ─── gesture: leading-edge throttle, 600 ms ───────────────────────────────

	describe('gesture — leading-edge throttle (600 ms)', () => {
		it('fires the first event immediately', () => {
			const received = [];
			protocol.on('gesture', (a) => received.push(a));

			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });

			expect(received).toHaveLength(1);
			expect(received[0].payload.name).toBe('wave');
		});

		it('drops events within the 600 ms interval', () => {
			const received = [];
			protocol.on('gesture', (a) => received.push(a));

			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });
			vi.advanceTimersByTime(300);
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } });
			protocol.emit({ type: 'gesture', payload: { name: 'shrug' } });

			expect(received).toHaveLength(1);
			expect(protocol.droppedCount('gesture')).toBe(2);
		});

		it('fires again after the interval elapses', () => {
			const received = [];
			protocol.on('gesture', (a) => received.push(a));

			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });
			vi.advanceTimersByTime(600);
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } });

			expect(received).toHaveLength(2);
			expect(received[1].payload.name).toBe('nod');
		});

		it('does not fire trailing events even after the interval', () => {
			const received = [];
			protocol.on('gesture', (a) => received.push(a));

			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } }); // dropped

			vi.advanceTimersByTime(700); // no timer set for leading throttle

			expect(received).toHaveLength(1);
		});
	});

	// ─── look-at: trailing-edge debounce, 100 ms ─────────────────────────────

	describe('look-at — trailing-edge debounce (100 ms)', () => {
		it('does not emit until after the quiet window', () => {
			const received = [];
			protocol.on('look-at', (a) => received.push(a));

			protocol.emit({ type: 'look-at', payload: { target: 'model' } });
			expect(received).toHaveLength(0);

			vi.advanceTimersByTime(100);
			expect(received).toHaveLength(1);
		});

		it('resets the timer on each new event and emits only the last', () => {
			const received = [];
			protocol.on('look-at', (a) => received.push(a));

			protocol.emit({ type: 'look-at', payload: { target: 'model' } });
			vi.advanceTimersByTime(50);
			protocol.emit({ type: 'look-at', payload: { target: 'user' } });
			vi.advanceTimersByTime(50);
			protocol.emit({ type: 'look-at', payload: { target: 'camera' } });
			vi.advanceTimersByTime(100);

			expect(received).toHaveLength(1);
			expect(received[0].payload.target).toBe('camera');
		});

		it('counts superseded pending events as dropped', () => {
			const received = [];
			protocol.on('look-at', (a) => received.push(a));

			protocol.emit({ type: 'look-at', payload: { target: 'model' } });
			protocol.emit({ type: 'look-at', payload: { target: 'user' } });
			protocol.emit({ type: 'look-at', payload: { target: 'camera' } });
			vi.advanceTimersByTime(100);

			expect(received).toHaveLength(1);
			expect(received[0].payload.target).toBe('camera');
			expect(protocol.droppedCount('look-at')).toBe(2);
		});
	});

	// ─── emote: coalesce by trigger, max weight, 150 ms window ───────────────

	describe('emote — coalesce by trigger, max weight (150 ms)', () => {
		it('merges same-trigger events to the max weight', () => {
			const received = [];
			protocol.on('emote', (a) => received.push(a));

			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.3 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.5 } });
			vi.advanceTimersByTime(150);

			expect(received).toHaveLength(1);
			expect(received[0].payload.trigger).toBe('celebration');
			expect(received[0].payload.weight).toBe(0.9);
		});

		it('counts merged events as dropped', () => {
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.3 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.5 } });
			vi.advanceTimersByTime(150);

			// 3 events → 1 emitted, 2 dropped (2nd and 3rd merged into bucket)
			expect(protocol.droppedCount('emote')).toBe(2);
		});

		it('emits separate events for different triggers', () => {
			const received = [];
			protocol.on('emote', (a) => received.push(a));

			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.8 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'concern', weight: 0.6 } });
			vi.advanceTimersByTime(150);

			expect(received).toHaveLength(2);
			const triggers = received.map((a) => a.payload.trigger);
			expect(triggers).toContain('celebration');
			expect(triggers).toContain('concern');
		});

		it('does not emit before the window closes', () => {
			const received = [];
			protocol.on('emote', (a) => received.push(a));

			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.5 } });
			vi.advanceTimersByTime(100);

			expect(received).toHaveLength(0);
		});

		it('a 1000-event burst produces one emitted event per trigger', () => {
			const received = [];
			protocol.on('emote', (a) => received.push(a));

			for (let i = 0; i < 1000; i++) {
				protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: Math.random() } });
			}
			vi.advanceTimersByTime(150);

			expect(received).toHaveLength(1);
			expect(protocol.droppedCount('emote')).toBe(999);
		});
	});

	// ─── passthrough events ───────────────────────────────────────────────────

	describe('speak — passthrough (no delay)', () => {
		it('emits immediately', () => {
			const received = [];
			protocol.on('speak', (a) => received.push(a));

			protocol.emit({ type: 'speak', payload: { text: 'hello', sentiment: 0.8 } });

			expect(received).toHaveLength(1);
			expect(received[0].payload.text).toBe('hello');
		});

		it('all speak events pass through in order', () => {
			const received = [];
			protocol.on('speak', (a) => received.push(a));

			for (let i = 0; i < 4; i++) {
				protocol.emit({ type: 'speak', payload: { text: `msg${i}`, sentiment: 0 } });
			}

			expect(received).toHaveLength(4);
			expect(received.map((a) => a.payload.text)).toEqual(['msg0', 'msg1', 'msg2', 'msg3']);
		});

		it('droppedCount stays 0 for speak', () => {
			protocol.emit({ type: 'speak', payload: { text: 'hi', sentiment: 0 } });
			expect(protocol.droppedCount('speak')).toBe(0);
		});
	});

	describe('think — passthrough', () => {
		it('emits immediately without queuing', () => {
			const received = [];
			protocol.on('think', (a) => received.push(a));

			protocol.emit({ type: 'think', payload: { thought: 'processing…' } });

			expect(received).toHaveLength(1);
		});
	});

	// ─── setThrottlePolicy override ───────────────────────────────────────────

	describe('setThrottlePolicy override', () => {
		it('can override gesture to passthrough', () => {
			protocol.setThrottlePolicy('gesture', { mode: 'passthrough' });

			const received = [];
			protocol.on('gesture', (a) => received.push(a));

			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } });

			expect(received).toHaveLength(2);
		});

		it('can set a custom throttle interval on gesture', () => {
			protocol.setThrottlePolicy('gesture', { mode: 'throttle', leading: true, intervalMs: 200 });

			const received = [];
			protocol.on('gesture', (a) => received.push(a));

			protocol.emit({ type: 'gesture', payload: { name: 'wave' } }); // fires
			vi.advanceTimersByTime(150);
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } }); // dropped (150 < 200)
			vi.advanceTimersByTime(60);
			protocol.emit({ type: 'gesture', payload: { name: 'shrug' } }); // fires (210 >= 200)

			expect(received).toHaveLength(2);
			expect(received[0].payload.name).toBe('wave');
			expect(received[1].payload.name).toBe('shrug');
		});

		it('can override emote to passthrough', () => {
			protocol.setThrottlePolicy('emote', { mode: 'passthrough' });

			const received = [];
			protocol.on('emote', (a) => received.push(a));

			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.5 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });

			expect(received).toHaveLength(2);
		});

		it('cancels pending debounce timer when policy is replaced', () => {
			const received = [];
			protocol.on('look-at', (a) => received.push(a));

			protocol.emit({ type: 'look-at', payload: { target: 'model' } });
			// Replace policy before timer fires
			protocol.setThrottlePolicy('look-at', { mode: 'passthrough' });
			vi.advanceTimersByTime(200);

			// Pending event was cancelled; nothing emitted
			expect(received).toHaveLength(0);
		});
	});

	// ─── droppedCount accuracy ────────────────────────────────────────────────

	describe('droppedCount accuracy', () => {
		it('returns 0 before any events', () => {
			expect(protocol.droppedCount('gesture')).toBe(0);
			expect(protocol.droppedCount('emote')).toBe(0);
			expect(protocol.droppedCount('look-at')).toBe(0);
			expect(protocol.droppedCount('speak')).toBe(0);
		});

		it('accumulates across multiple drops for throttle', () => {
			protocol.emit({ type: 'gesture', payload: { name: 'wave' } }); // emitted
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } }); // dropped
			protocol.emit({ type: 'gesture', payload: { name: 'shrug' } }); // dropped
			protocol.emit({ type: 'gesture', payload: { name: 'point' } }); // dropped

			expect(protocol.droppedCount('gesture')).toBe(3);
		});

		it('does not count passthrough events as dropped', () => {
			protocol.emit({ type: 'speak', payload: { text: 'a', sentiment: 0 } });
			protocol.emit({ type: 'speak', payload: { text: 'b', sentiment: 0 } });
			protocol.emit({ type: 'speak', payload: { text: 'c', sentiment: 0 } });

			expect(protocol.droppedCount('speak')).toBe(0);
		});
	});

	// ─── wildcard subscription ────────────────────────────────────────────────

	describe("wildcard '*' subscription", () => {
		it('sees only emitted events, not dropped ones', () => {
			const wildcardReceived = [];
			protocol.on('*', (a) => wildcardReceived.push(a));

			// gesture: leading throttle → 1 emitted, 2 dropped
			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } });
			protocol.emit({ type: 'gesture', payload: { name: 'shrug' } });

			// speak: passthrough → 1 emitted
			protocol.emit({ type: 'speak', payload: { text: 'hi', sentiment: 0 } });

			// look-at: debounced → emits after 100 ms
			protocol.emit({ type: 'look-at', payload: { target: 'model' } });
			vi.advanceTimersByTime(100);

			const byType = (t) => wildcardReceived.filter((a) => a.type === t);
			expect(byType('gesture')).toHaveLength(1);
			expect(byType('speak')).toHaveLength(1);
			expect(byType('look-at')).toHaveLength(1);
		});

		it('does not see emote events merged into a bucket', () => {
			const wildcardReceived = [];
			protocol.on('*', (a) => wildcardReceived.push(a));

			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.5 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });
			vi.advanceTimersByTime(150);

			const emoteEvents = wildcardReceived.filter((a) => a.type === 'emote');
			expect(emoteEvents).toHaveLength(1);
			expect(emoteEvents[0].payload.weight).toBe(0.9);
		});
	});

	// ─── history ring buffer ──────────────────────────────────────────────────

	describe('history ring buffer', () => {
		it('records emitted events', () => {
			protocol.emit({ type: 'speak', payload: { text: 'hello', sentiment: 0 } });

			expect(protocol.history).toHaveLength(1);
			expect(protocol.history[0].type).toBe('speak');
		});

		it('does not record dropped throttle events', () => {
			protocol.emit({ type: 'gesture', payload: { name: 'wave' } }); // emitted
			protocol.emit({ type: 'gesture', payload: { name: 'nod' } }); // dropped

			expect(protocol.history.filter((a) => a.type === 'gesture')).toHaveLength(1);
		});

		it('records debounce event only after the timer fires', () => {
			protocol.emit({ type: 'look-at', payload: { target: 'model' } });
			expect(protocol.history.filter((a) => a.type === 'look-at')).toHaveLength(0);

			vi.advanceTimersByTime(100);
			expect(protocol.history.filter((a) => a.type === 'look-at')).toHaveLength(1);
		});

		it('records coalesced emote only after the window closes', () => {
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.3 } });
			protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });

			expect(protocol.history.filter((a) => a.type === 'emote')).toHaveLength(0);

			vi.advanceTimersByTime(150);
			const emoteHistory = protocol.history.filter((a) => a.type === 'emote');
			expect(emoteHistory).toHaveLength(1);
			expect(emoteHistory[0].payload.weight).toBe(0.9);
		});
	});
});
