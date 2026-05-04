// End-to-end round trip between EmbedHostBridge (parent) and EmbedActionBridge
// (iframe). Wires the two against an in-memory "wormhole" that mirrors the
// browser's postMessage event with origin metadata, so we can verify:
//
//   1. The handshake (host:hello → agent:ready → host:ping → agent:pong) runs
//      end-to-end with strict origin targeting on every hop.
//   2. host.speak() → iframe's protocol.emit() actually fires.
//   3. Action events bubble back when the host subscribes.

import { describe, it, expect, vi } from 'vitest';
import { EmbedHostBridge } from '../src/embed-host-bridge.js';
import { EmbedActionBridge } from '../src/embed-action-bridge.js';

function makeProtocol() {
	const handlers = new Set();
	const wildcards = new Set();
	return {
		on(evt, fn) { (evt === '*' ? wildcards : handlers).add(fn); },
		off(evt, fn) { (evt === '*' ? wildcards : handlers).delete(fn); },
		emit(action) {
			for (const fn of handlers) fn(action);
			for (const fn of wildcards) fn(action);
		},
	};
}

// "Wormhole" — links the parent window's listeners to the iframe's listeners
// and vice versa, propagating origin and source on each side.
function wireWormhole({ hostOrigin, iframeOrigin }) {
	const hostListeners = new Set();
	const iframeListeners = new Set();

	// Note: `event.source` from the iframe's perspective must be `iframe._win.parent`
	// (the parent reference the iframe holds), and from the host's perspective
	// must be `iframe.contentWindow` (what the host stored). We back both with
	// concrete objects and re-use them as event.source on each hop.
	const iframeContentWindow = {
		postMessage(data, targetOrigin) {
			// host → iframe
			expect(targetOrigin).not.toBe('*');
			expect(targetOrigin).toBe(iframeOrigin);
			for (const fn of iframeListeners) {
				fn({ source: hostParent, origin: hostOrigin, data });
			}
		},
	};

	const hostParent = {
		postMessage(data, targetOrigin) {
			// iframe → host
			expect(targetOrigin).not.toBe('*');
			expect(targetOrigin).toBe(hostOrigin);
			for (const fn of hostListeners) {
				fn({ source: iframeContentWindow, origin: iframeOrigin, data });
			}
		},
	};

	const iframe = {
		tagName: 'IFRAME',
		src: `${iframeOrigin}/agent/abc/embed`,
		contentWindow: iframeContentWindow,
	};

	const fakeIframeWindow = {
		_listeners: iframeListeners,
		parent: hostParent,
		document: { referrer: `${hostOrigin}/` },
		location: { origin: iframeOrigin },
		addEventListener(t, fn) { if (t === 'message') iframeListeners.add(fn); },
		removeEventListener(t, fn) { if (t === 'message') iframeListeners.delete(fn); },
	};

	return {
		iframe,
		fakeIframeWindow,
		dispatchHostMessage(ev) {
			for (const fn of hostListeners) fn(ev);
		},
		hostListenersSet: hostListeners,
	};
}

describe('Bridge — host ↔ iframe round trip', () => {
	it('completes handshake and dispatches a speak action with strict origins', async () => {
		const hostOrigin = 'https://host.example';
		const iframeOrigin = 'https://iframe.example';
		const wormhole = wireWormhole({ hostOrigin, iframeOrigin });

		// Stub global window for the host bridge to register its listener on.
		const originalWindow = globalThis.window;
		globalThis.window = {
			_listeners: wormhole.hostListenersSet,
			addEventListener(t, fn) { if (t === 'message') wormhole.hostListenersSet.add(fn); },
			removeEventListener(t, fn) { wormhole.hostListenersSet.delete(fn); },
		};

		try {
			// Iframe side first — it announces ready as soon as start() runs.
			const protocol = makeProtocol();
			const speakHandler = vi.fn();
			protocol.on('speak', speakHandler);

			const action = new EmbedActionBridge({
				protocol,
				manifest: { id: { agentId: 'a1' } },
				window: wormhole.fakeIframeWindow,
			});

			// Host side — must construct *before* iframe.start() so it catches the
			// 'ready' announcement. Otherwise we'd miss the handshake step 1.
			const host = new EmbedHostBridge({
				iframe: wormhole.iframe,
				agentId: 'a1',
				allowedOrigin: iframeOrigin,
			});

			action.start();
			await host.ready;

			// Round trip a speak request.
			await host.speak('hello world');
			expect(speakHandler).toHaveBeenCalledTimes(1);
			expect(speakHandler).toHaveBeenCalledWith({
				type: 'speak',
				payload: { text: 'hello world' },
			});

			// Subscribe and verify the action event echoes back to the host.
			const onAction = vi.fn();
			// 'subscribe' is a request — must round-trip; do it explicitly via the
			// bridge's internal channel.
			await host._request('subscribe');
			host.on('action', onAction);
			onAction.mockClear();
			protocol.emit({ type: 'gesture', payload: { name: 'wave' } });
			expect(onAction).toHaveBeenCalled();
			const lastCall = onAction.mock.calls[onAction.mock.calls.length - 1][0];
			expect(lastCall).toMatchObject({
				type: 'gesture',
				payload: { name: 'wave' },
			});

			host.destroy();
			action.stop();
		} finally {
			globalThis.window = originalWindow;
		}
	});
});
