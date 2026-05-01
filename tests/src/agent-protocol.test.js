import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentProtocol, ACTION_TYPES } from '../../src/agent-protocol.js';

describe('ACTION_TYPES', () => {
	it('exposes the canonical action vocabulary', () => {
		const expected = [
			'SPEAK',
			'THINK',
			'GESTURE',
			'EMOTE',
			'LOOK_AT',
			'PERFORM_SKILL',
			'SKILL_DONE',
			'SKILL_ERROR',
			'REMEMBER',
			'SIGN',
			'LOAD_START',
			'LOAD_END',
			'VALIDATE',
			'PRESENCE',
		];
		for (const k of expected) expect(ACTION_TYPES).toHaveProperty(k);
	});

	it('uses kebab-case values for multi-word keys', () => {
		expect(ACTION_TYPES.LOOK_AT).toBe('look-at');
		expect(ACTION_TYPES.SKILL_DONE).toBe('skill-done');
		expect(ACTION_TYPES.LOAD_START).toBe('load-start');
	});
});

describe('AgentProtocol.emit', () => {
	let bus;
	beforeEach(() => {
		bus = new AgentProtocol();
	});

	it('delivers events of a matching type', () => {
		const handler = vi.fn();
		bus.on('speak', handler);
		bus.emit({ type: 'speak', payload: { text: 'hi' } });
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0]).toMatchObject({
			type: 'speak',
			payload: { text: 'hi' },
			agentId: 'default',
			sourceSkill: null,
		});
	});

	it('does not deliver to other types', () => {
		const speakHandler = vi.fn();
		const thinkHandler = vi.fn();
		bus.on('speak', speakHandler);
		bus.on('think', thinkHandler);
		bus.emit({ type: 'speak' });
		expect(speakHandler).toHaveBeenCalledOnce();
		expect(thinkHandler).not.toHaveBeenCalled();
	});

	it('delivers to wildcard subscribers', () => {
		const star = vi.fn();
		bus.on('*', star);
		bus.emit({ type: 'speak' });
		bus.emit({ type: 'think' });
		expect(star).toHaveBeenCalledTimes(2);
	});

	it('injects a timestamp', () => {
		const handler = vi.fn();
		const before = Date.now();
		bus.on('speak', handler);
		bus.emit({ type: 'speak' });
		const after = Date.now();
		const action = handler.mock.calls[0][0];
		expect(action.timestamp).toBeGreaterThanOrEqual(before);
		expect(action.timestamp).toBeLessThanOrEqual(after);
	});

	it('defaults payload to an empty object', () => {
		const handler = vi.fn();
		bus.on('speak', handler);
		bus.emit({ type: 'speak' });
		expect(handler.mock.calls[0][0].payload).toEqual({});
	});

	it('preserves agentId and sourceSkill when provided', () => {
		const handler = vi.fn();
		bus.on('speak', handler);
		bus.emit({ type: 'speak', agentId: 'alice', sourceSkill: 'greet' });
		expect(handler.mock.calls[0][0].agentId).toBe('alice');
		expect(handler.mock.calls[0][0].sourceSkill).toBe('greet');
	});
});

describe('AgentProtocol.once', () => {
	it('fires only once per event type', () => {
		const bus = new AgentProtocol();
		const handler = vi.fn();
		bus.once('speak', handler);
		bus.emit({ type: 'speak' });
		bus.emit({ type: 'speak' });
		expect(handler).toHaveBeenCalledOnce();
	});
});

describe('AgentProtocol.off', () => {
	it('unsubscribes a handler registered via on()', () => {
		const bus = new AgentProtocol();
		const handler = vi.fn();
		bus.on('speak', handler);
		bus.off('speak', handler);
		bus.emit({ type: 'speak' });
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('AgentProtocol.history', () => {
	it('tracks recent actions in order', () => {
		const bus = new AgentProtocol();
		bus.emit({ type: 'speak', payload: { text: 'a' } });
		bus.emit({ type: 'think', payload: { thought: 'b' } });
		const h = bus.history;
		expect(h).toHaveLength(2);
		expect(h[0].type).toBe('speak');
		expect(h[1].type).toBe('think');
	});

	it('returns a snapshot, not a live reference', () => {
		const bus = new AgentProtocol();
		bus.emit({ type: 'speak' });
		const snapshot = bus.history;
		bus.emit({ type: 'think' });
		expect(snapshot).toHaveLength(1);
	});

	it('caps history at the internal max', () => {
		const bus = new AgentProtocol();
		bus.debug = true; // bypass burst limiter so all 250 events reach history
		for (let i = 0; i < 250; i++) {
			bus.emit({ type: 'speak', payload: { i } });
		}
		expect(bus.history.length).toBeLessThanOrEqual(200);
		// Newest entries retained
		const last = bus.history.at(-1);
		expect(last.payload.i).toBe(249);
	});
});

describe('AgentProtocol.recent', () => {
	it('filters history by type', () => {
		const bus = new AgentProtocol();
		bus.emit({ type: 'speak', payload: { i: 0 } });
		bus.emit({ type: 'think', payload: { i: 1 } });
		bus.emit({ type: 'speak', payload: { i: 2 } });
		const recent = bus.recent('speak');
		expect(recent).toHaveLength(2);
		expect(recent.every((a) => a.type === 'speak')).toBe(true);
	});

	it('returns at most N matches (newest)', () => {
		const bus = new AgentProtocol();
		bus.debug = true; // bypass burst limiter
		for (let i = 0; i < 15; i++) bus.emit({ type: 'speak', payload: { i } });
		const r = bus.recent('speak', 5);
		expect(r).toHaveLength(5);
		expect(r[r.length - 1].payload.i).toBe(14);
	});

	it('defaults to 10 entries', () => {
		const bus = new AgentProtocol();
		bus.debug = true; // bypass burst limiter
		for (let i = 0; i < 20; i++) bus.emit({ type: 'speak', payload: { i } });
		expect(bus.recent('speak')).toHaveLength(10);
	});
});
