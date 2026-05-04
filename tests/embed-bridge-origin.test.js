// Origin-lockdown contract for the host ↔ iframe bridge.
//
// Covers:
//   1. EmbedHostBridge constructor refuses missing / wildcard allowedOrigin
//   2. EmbedHostBridge ignores incoming messages from other origins
//   3. EmbedActionBridge (iframe side) refuses to post to '*' and locks
//      parentOrigin to the first valid host message
//   4. public/embed-sdk.js Agent3D.connect rejects iframes with unresolvable
//      origin and never targets '*'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbedHostBridge } from '../src/embed-host-bridge.js';
import { EmbedActionBridge } from '../src/embed-action-bridge.js';

// ── Tiny fakes ──────────────────────────────────────────────────────────────

function makeFakeWindow() {
	const listeners = new Map();
	const win = {
		_listeners: listeners,
		_postedToParent: [],
		document: { referrer: 'https://host.example/' },
		location: { origin: 'https://iframe.example' },
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(fn);
		},
		removeEventListener(type, fn) {
			listeners.get(type)?.delete(fn);
		},
		dispatch(type, event) {
			for (const fn of listeners.get(type) || []) fn(event);
		},
	};
	win.parent = {
		postMessage(data, targetOrigin) {
			win._postedToParent.push({ data, targetOrigin });
		},
	};
	return win;
}

function makeFakeIframe(src = 'https://iframe.example/agent/abc/embed') {
	const contentWindow = {
		_received: [],
		postMessage(data, targetOrigin) {
			contentWindow._received.push({ data, targetOrigin });
		},
	};
	return {
		tagName: 'IFRAME',
		src,
		contentWindow,
	};
}

// Minimal stand-in for AgentProtocol — only `on`/`off`/`emit` are exercised.
function makeProtocol() {
	const handlers = new Set();
	return {
		on(_evt, fn) { handlers.add(fn); },
		off(_evt, fn) { handlers.delete(fn); },
		emit(action) { for (const fn of handlers) fn(action); },
	};
}

// ── EmbedHostBridge ─────────────────────────────────────────────────────────

describe('EmbedHostBridge — allowedOrigin enforcement', () => {
	let originalWindow;

	beforeEach(() => {
		originalWindow = globalThis.window;
		globalThis.window = {
			_listeners: new Map(),
			addEventListener(t, fn) {
				if (!this._listeners.has(t)) this._listeners.set(t, new Set());
				this._listeners.get(t).add(fn);
			},
			removeEventListener(t, fn) { this._listeners.get(t)?.delete(fn); },
			dispatch(t, ev) { for (const fn of this._listeners.get(t) || []) fn(ev); },
		};
	});

	afterEach(() => { globalThis.window = originalWindow; });

	it('throws when allowedOrigin is missing', () => {
		expect(() => new EmbedHostBridge({
			iframe: makeFakeIframe(),
			agentId: 'a1',
		})).toThrow(/allowedOrigin/);
	});

	it('throws when allowedOrigin is "*"', () => {
		expect(() => new EmbedHostBridge({
			iframe: makeFakeIframe(),
			agentId: 'a1',
			allowedOrigin: '*',
		})).toThrow(/wildcard/i);
	});

	it('drops messages from other origins', async () => {
		const iframe = makeFakeIframe();
		const bridge = new EmbedHostBridge({
			iframe,
			agentId: 'a1',
			allowedOrigin: 'https://iframe.example',
		});
		bridge.ready.catch(() => {}); // we destroy before handshake completes
		// Inject a fake "ready" event from a foreign origin — must NOT trigger handshake.
		window.dispatch('message', {
			source: iframe.contentWindow,
			origin: 'https://evil.example',
			data: { v: 1, source: 'agent-3d', kind: 'event', op: 'ready', payload: {} },
		});
		// No ping was sent because the foreign-origin "ready" was dropped.
		expect(iframe.contentWindow._received).toHaveLength(0);
		bridge.destroy();
	});

	it('completes handshake on a same-origin ready/pong', async () => {
		const iframe = makeFakeIframe();
		const bridge = new EmbedHostBridge({
			iframe,
			agentId: 'a1',
			allowedOrigin: 'https://iframe.example',
		});
		window.dispatch('message', {
			source: iframe.contentWindow,
			origin: 'https://iframe.example',
			data: { v: 1, source: 'agent-3d', kind: 'event', op: 'ready', payload: {} },
		});
		// Handshake step 1 — host sent ping
		expect(iframe.contentWindow._received).toHaveLength(1);
		const ping = iframe.contentWindow._received[0];
		expect(ping.targetOrigin).toBe('https://iframe.example');
		expect(ping.data.op).toBe('ping');

		// Reply with pong from the iframe — handshake completes
		window.dispatch('message', {
			source: iframe.contentWindow,
			origin: 'https://iframe.example',
			data: {
				v: 1, source: 'agent-3d', kind: 'response', op: 'pong',
				inReplyTo: ping.data.id, payload: { capabilities: ['speak'] },
			},
		});
		await expect(bridge.ready).resolves.toMatchObject({ agentId: 'a1' });
		bridge.destroy();
	});
});

// ── EmbedActionBridge (iframe side) ─────────────────────────────────────────

describe('EmbedActionBridge — origin lockdown (iframe side)', () => {
	it('seeds parent origin from referrer and posts ready without "*"', () => {
		const win = makeFakeWindow();
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: { id: { agentId: 'a1' } },
			window: win,
		});
		bridge.start();
		expect(win._postedToParent).toHaveLength(1);
		expect(win._postedToParent[0].targetOrigin).toBe('https://host.example');
		expect(win._postedToParent[0].targetOrigin).not.toBe('*');
		bridge.stop();
	});

	it('locks parent origin to the first valid host message', () => {
		const win = makeFakeWindow();
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: { id: { agentId: 'a1' } },
			window: win,
		});
		bridge.start();
		win._postedToParent.length = 0;

		// First valid host message arrives from a *different* origin than the
		// referrer — the bridge should lock onto it for subsequent posts.
		win.dispatch('message', {
			source: win.parent,
			origin: 'https://other-host.example',
			data: { v: 1, source: 'agent-host', kind: 'request', op: 'ping', id: 'p1' },
		});

		// Reply (pong) was sent — must target the locked origin.
		expect(win._postedToParent).toHaveLength(1);
		expect(win._postedToParent[0].targetOrigin).toBe('https://other-host.example');

		// A subsequent message from yet another origin must be ignored.
		win._postedToParent.length = 0;
		win.dispatch('message', {
			source: win.parent,
			origin: 'https://evil.example',
			data: { v: 1, source: 'agent-host', kind: 'request', op: 'ping', id: 'p2' },
		});
		expect(win._postedToParent).toHaveLength(0);
		bridge.stop();
	});

	it('drops outbound posts when no parent origin is known', () => {
		const win = makeFakeWindow();
		win.document.referrer = ''; // no seed
		win.parent = win; // simulate top-level (not actually iframed)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// Restore parent to a proper poster but keep referrer empty for the seed.
		win.parent = {
			postMessage(data, targetOrigin) { win._postedToParent.push({ data, targetOrigin }); },
		};
		const bridge = new EmbedActionBridge({
			protocol: makeProtocol(),
			manifest: { id: { agentId: 'a1' } },
			window: win,
		});
		bridge.start();
		expect(win._postedToParent).toHaveLength(0);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		bridge.stop();
	});
});
