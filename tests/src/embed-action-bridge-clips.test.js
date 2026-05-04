// Verifies listClips request / clips event flow on EmbedActionBridge.
// Pumpfun.html and other parent pages use this to render an animation chip
// strip for the actually-loaded model — see public/pumpfun.html and
// src/element.js#_listAvailableClips.

import { describe, it, expect, vi } from 'vitest';
import { EmbedActionBridge } from '../../src/embed-action-bridge.js';

function makeFakeWindow() {
	const listeners = [];
	const parentMessages = [];
	const parent = {
		postMessage: (msg /*, origin */) => parentMessages.push(msg),
	};
	const win = {
		parent,
		addEventListener: (type, fn) => {
			if (type === 'message') listeners.push(fn);
		},
		removeEventListener: () => {},
		location: { origin: 'http://embed.test' },
		document: { referrer: 'http://host.test/page' },
	};
	const dispatch = (data) => {
		const ev = { source: parent, origin: 'http://host.test', data };
		for (const fn of listeners) fn(ev);
	};
	return { win, parentMessages, dispatch };
}

function makeProtocol() {
	const handlers = new Set();
	return {
		on: (_t, fn) => handlers.add(fn),
		off: (_t, fn) => handlers.delete(fn),
		emit: vi.fn(),
	};
}

describe('EmbedActionBridge — listClips', () => {
	it('replies to listClips request with the getClips() result', () => {
		const { win, parentMessages, dispatch } = makeFakeWindow();
		const clips = [
			{ name: 'idle', label: 'Idle', icon: '🧍', loop: true, source: 'manifest' },
			{ name: 'wave', label: 'Wave', icon: '👋', loop: false, source: 'manifest' },
		];
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: {},
			window: win,
			getClips: () => clips,
		});
		bridge.start();

		dispatch({
			v: 1,
			source: 'agent-host',
			id: 'req-1',
			kind: 'request',
			op: 'listClips',
			payload: {},
		});

		const reply = parentMessages.find(
			(m) => m.kind === 'response' && m.op === 'listClips' && m.inReplyTo === 'req-1',
		);
		expect(reply, 'host should receive a listClips response').toBeTruthy();
		expect(reply.payload.clips).toEqual(clips);
	});

	it('reports listClips in pong capabilities', () => {
		const { win, parentMessages, dispatch } = makeFakeWindow();
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: {},
			window: win,
			getClips: () => [],
		});
		bridge.start();

		dispatch({ v: 1, source: 'agent-host', id: 'p1', kind: 'request', op: 'ping', payload: {} });
		const pong = parentMessages.find((m) => m.op === 'pong');
		expect(pong.payload.capabilities).toContain('listClips');
		expect(pong.payload.capabilities).toContain('subscribe');
	});

	it('emitClipsChanged delivers immediately to subscribed hosts', () => {
		const { win, parentMessages, dispatch } = makeFakeWindow();
		let dynamic = [{ name: 'idle', label: 'Idle', icon: '🧍', loop: true, source: 'manifest' }];
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: {},
			window: win,
			getClips: () => dynamic,
		});
		bridge.start();

		// Subscribe first
		dispatch({ v: 1, source: 'agent-host', id: 's1', kind: 'request', op: 'subscribe', payload: {} });
		parentMessages.length = 0;

		// Simulate model swap inside the embed → caller flips the clip list and notifies.
		dynamic = [{ name: 'roboyes', label: 'Yes', icon: '✅', loop: false, source: 'glb' }];
		bridge.emitClipsChanged();

		const evt = parentMessages.find((m) => m.kind === 'event' && m.op === 'clips');
		expect(evt, 'subscribed host should receive clips event').toBeTruthy();
		expect(evt.payload.clips[0].name).toBe('roboyes');
	});

	it('emitClipsChanged queues for unsubscribed hosts and flushes on subscribe', () => {
		const { win, parentMessages, dispatch } = makeFakeWindow();
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: {},
			window: win,
			getClips: () => [{ name: 'idle', label: 'Idle', icon: '🧍', loop: true, source: 'manifest' }],
		});
		bridge.start();

		// Fire before subscribe
		bridge.emitClipsChanged();
		expect(parentMessages.find((m) => m.op === 'clips')).toBeFalsy();

		// Subscribe → queued events flushed
		dispatch({ v: 1, source: 'agent-host', id: 's1', kind: 'request', op: 'subscribe', payload: {} });
		const evt = parentMessages.find((m) => m.kind === 'event' && m.op === 'clips');
		expect(evt).toBeTruthy();
		expect(evt.payload.clips[0].name).toBe('idle');
	});

	it('returns [] from listClips when no getClips callback was supplied', () => {
		const { win, parentMessages, dispatch } = makeFakeWindow();
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: {},
			window: win,
		});
		bridge.start();

		dispatch({ v: 1, source: 'agent-host', id: 'req-1', kind: 'request', op: 'listClips', payload: {} });
		const reply = parentMessages.find((m) => m.op === 'listClips' && m.inReplyTo === 'req-1');
		expect(reply.payload.clips).toEqual([]);
	});

	it('survives a getClips callback that throws', () => {
		const { win, parentMessages, dispatch } = makeFakeWindow();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: {},
			window: win,
			getClips: () => {
				throw new Error('scene not ready');
			},
		});
		bridge.start();

		dispatch({ v: 1, source: 'agent-host', id: 'req-1', kind: 'request', op: 'listClips', payload: {} });
		const reply = parentMessages.find((m) => m.op === 'listClips' && m.inReplyTo === 'req-1');
		expect(reply.payload.clips).toEqual([]);
		warn.mockRestore();
	});
});
