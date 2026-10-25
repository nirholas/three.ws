// A published agent's persona and custom skills are written by its owner. When a
// different, signed-in visitor chats with it, that text must never share a turn
// with the visitor's smart-home tools (they run under the visitor's authority).
import { describe, it, expect } from 'vitest';
import { homeToolsOffered, homeCallsToRun } from '../api/chat.js';

describe('homeToolsOffered', () => {
	it('offers home tools in a plain turn with no agent', () => {
		expect(homeToolsOffered({ homeCount: 1, agentId: null, isOwner: false })).toBe(true);
	});
	it('offers home tools when the visitor owns the agent', () => {
		expect(homeToolsOffered({ homeCount: 1, agentId: 'a1', isOwner: true })).toBe(true);
	});
	it('withholds home tools when a third-party agent persona is in the prompt', () => {
		expect(homeToolsOffered({ homeCount: 1, agentId: 'a1', isOwner: false })).toBe(false);
	});
	it('offers nothing without a home membership', () => {
		expect(homeToolsOffered({ homeCount: 0, agentId: null, isOwner: false })).toBe(false);
	});
});

describe('homeCallsToRun', () => {
	const calls = [{ name: 'home_status' }, { name: 'sendSol' }];
	it('runs nothing when the turn did not offer home tools, even if the model named one', () => {
		expect(homeCallsToRun(calls, false)).toEqual([]);
	});
	it('runs only home tools when they were offered', () => {
		expect(homeCallsToRun(calls, true).map((c) => c.name)).toEqual(['home_status']);
	});
});
