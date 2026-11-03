// Meetup #3 client audit (console at zero): colyseus.js first constructs
// `new WebSocket(url, { headers, protocols })`, the Node `ws` signature, and
// catches the browser's refusal before retrying with the browser form. The
// room still connects, but Safari also logs "Wrong protocol for WebSocket
// '[object Object]'" as a console error on every connect, for every iOS player.
// pages/play.html now ships an inline head shim, run before any module, that
// hands the browser only the protocols. This test runs the shipped bytes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function shippedShim() {
	const html = readFileSync('pages/play.html', 'utf8');
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	const shim = scripts.find((s) => s.includes('__twsSig'));
	if (!shim) throw new Error('no WebSocket signature shim in pages/play.html');
	const head = html.slice(0, html.indexOf('</head>'));
	if (!head.includes(shim)) throw new Error('the shim must run in <head>, before any module script');
	return shim;
}

function fakeWindow() {
	class NativeWS {
		static OPEN = 1;
		constructor(url, protocols) {
			if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
				throw new SyntaxError(`Wrong protocol for WebSocket '${String(protocols)}'`);
			}
			this.args = protocols === undefined ? [url] : [url, protocols];
		}
	}
	return { WebSocket: NativeWS, NativeWS };
}

describe('WebSocket signature shim on /play', () => {
	it('gives the browser just the protocols when handed the Node ws options object', () => {
		const win = fakeWindow();
		new Function('window', shippedShim())(win);
		expect(new win.WebSocket('wss://room', { headers: undefined, protocols: undefined }).args).toEqual(['wss://room']);
		expect(new win.WebSocket('wss://room', { headers: { a: 1 }, protocols: ['v1'] }).args).toEqual(['wss://room', ['v1']]);
	});

	it('leaves every browser-form call, statics and instanceof untouched', () => {
		const win = fakeWindow();
		new Function('window', shippedShim())(win);
		expect(new win.WebSocket('wss://room').args).toEqual(['wss://room']);
		expect(new win.WebSocket('wss://room', ['v1', 'v2']).args).toEqual(['wss://room', ['v1', 'v2']]);
		expect(new win.WebSocket('wss://room', 'v1').args).toEqual(['wss://room', 'v1']);
		expect(win.WebSocket.OPEN).toBe(1);
		expect(new win.WebSocket('wss://room')).toBeInstanceOf(win.NativeWS);
	});

	it('installs once however many times the page runs it', () => {
		const win = fakeWindow();
		new Function('window', shippedShim())(win);
		const first = win.WebSocket;
		new Function('window', shippedShim())(win);
		expect(win.WebSocket).toBe(first);
	});
});
