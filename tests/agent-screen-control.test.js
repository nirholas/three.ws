/**
 * Agent-screen CONTROL channel, unit tests.
 *
 * Covers the API-boundary sanitizer and the SSRF nav guard that stand between a
 * remote driver and the caster's real browser. These are pure functions, so the
 * suite asserts exact behaviour: coordinate clamping, key/text whitelisting,
 * batch capping, and every private/loopback/metadata host being refused.
 *
 * The real-browser dispatch (that a sanitized event actually drives Chromium) is
 * proven separately by scripts/agent-screen-control-proof.mjs against a live
 * Playwright page, kept out of the unit suite so it stays fast and headless-free.
 */

import { describe, it, expect } from 'vitest';
import {
	sanitizeEvent,
	sanitizeEvents,
	isNavAllowed,
	KEY_WHITELIST,
	MAX_EVENTS_PER_BATCH,
	MAX_TEXT_LEN,
	SCROLL_CLAMP,
} from '../src/shared/agent-screen-control.js';

describe('sanitizeEvent, pointer events', () => {
	it('keeps a valid move with clamped coords', () => {
		expect(sanitizeEvent({ t: 'move', x: 0.5, y: 0.25 })).toEqual({ t: 'move', x: 0.5, y: 0.25 });
	});

	it('clamps out-of-range coordinates into [0,1]', () => {
		expect(sanitizeEvent({ t: 'move', x: 5, y: -3 })).toEqual({ t: 'move', x: 1, y: 0 });
	});

	it('drops a pointer event with non-finite coords', () => {
		expect(sanitizeEvent({ t: 'click', x: 'nope', y: 0.5 })).toBeNull();
		expect(sanitizeEvent({ t: 'click', x: NaN, y: 0.5 })).toBeNull();
	});

	it('defaults an unknown button to left and keeps valid buttons', () => {
		expect(sanitizeEvent({ t: 'click', x: 0.1, y: 0.1, button: 'weird' })).toEqual({ t: 'click', x: 0.1, y: 0.1, button: 'left' });
		expect(sanitizeEvent({ t: 'down', x: 0.1, y: 0.1, button: 'right' })).toEqual({ t: 'down', x: 0.1, y: 0.1, button: 'right' });
	});

	it('does not attach a button to a move', () => {
		expect(sanitizeEvent({ t: 'move', x: 0.2, y: 0.2, button: 'right' })).toEqual({ t: 'move', x: 0.2, y: 0.2 });
	});
});

describe('sanitizeEvent, scroll', () => {
	it('clamps wheel delta to the scroll bound', () => {
		expect(sanitizeEvent({ t: 'scroll', x: 0.5, y: 0.5, dy: 99999 })).toEqual({ t: 'scroll', x: 0.5, y: 0.5, dy: SCROLL_CLAMP });
		expect(sanitizeEvent({ t: 'scroll', x: 0.5, y: 0.5, dy: -99999 })).toEqual({ t: 'scroll', x: 0.5, y: 0.5, dy: -SCROLL_CLAMP });
	});

	it('coerces a bad delta to 0', () => {
		expect(sanitizeEvent({ t: 'scroll', x: 0.5, y: 0.5, dy: 'x' })).toEqual({ t: 'scroll', x: 0.5, y: 0.5, dy: 0 });
	});
});

describe('sanitizeEvent, keys and text', () => {
	it('accepts whitelisted keys only', () => {
		for (const key of KEY_WHITELIST) {
			expect(sanitizeEvent({ t: 'key', key })).toEqual({ t: 'key', key });
		}
	});

	it('rejects non-whitelisted / printable keys (those go through text)', () => {
		expect(sanitizeEvent({ t: 'key', key: 'a' })).toBeNull();
		expect(sanitizeEvent({ t: 'key', key: 'F5' })).toBeNull();
		expect(sanitizeEvent({ t: 'key', key: 'Meta' })).toBeNull();
	});

	it('keeps printable text and strips control chars', () => {
		expect(sanitizeEvent({ t: 'text', text: 'hello world' })).toEqual({ t: 'text', text: 'hello world' });
		expect(sanitizeEvent({ t: 'text', text: 'a\u0000b\nc' })).toEqual({ t: 'text', text: 'abc' });
	});

	it('drops text that is empty after stripping', () => {
		expect(sanitizeEvent({ t: 'text', text: '\n\t' })).toBeNull();
		expect(sanitizeEvent({ t: 'text', text: '' })).toBeNull();
	});

	it('caps text length', () => {
		const long = 'x'.repeat(MAX_TEXT_LEN + 50);
		const out = sanitizeEvent({ t: 'text', text: long });
		expect(out.text.length).toBe(MAX_TEXT_LEN);
	});
});

describe('sanitizeEvent, navigation and simple verbs', () => {
	it('keeps a public https nav', () => {
		expect(sanitizeEvent({ t: 'nav', url: 'https://example.com/path' })).toEqual({ t: 'nav', url: 'https://example.com/path' });
	});

	it('drops a nav to a blocked host', () => {
		expect(sanitizeEvent({ t: 'nav', url: 'http://169.254.169.254/latest/meta-data/' })).toBeNull();
		expect(sanitizeEvent({ t: 'nav', url: 'http://localhost:3000' })).toBeNull();
	});

	it('keeps back / forward / reload', () => {
		expect(sanitizeEvent({ t: 'back' })).toEqual({ t: 'back' });
		expect(sanitizeEvent({ t: 'forward' })).toEqual({ t: 'forward' });
		expect(sanitizeEvent({ t: 'reload' })).toEqual({ t: 'reload' });
	});

	it('drops unknown event types', () => {
		expect(sanitizeEvent({ t: 'exec', cmd: 'rm -rf /' })).toBeNull();
		expect(sanitizeEvent(null)).toBeNull();
		expect(sanitizeEvent('nope')).toBeNull();
	});
});

describe('isNavAllowed, SSRF guard', () => {
	const ALLOWED = [
		'https://example.com',
		'http://news.ycombinator.com',
		'https://en.wikipedia.org/wiki/Main_Page',
		'https://8.8.8.8/',            // public IP literal
		'https://[2606:4700:4700::1111]/', // public IPv6
	];
	const BLOCKED = [
		'http://localhost',
		'http://localhost:8080/x',
		'http://127.0.0.1',
		'http://0.0.0.0',
		'http://10.0.0.5',
		'http://172.16.0.1',
		'http://172.31.255.255',
		'http://192.168.1.1',
		'http://169.254.169.254/',     // cloud metadata
		'http://100.64.0.1',           // CGNAT
		'http://metadata.google.internal/computeMetadata/v1/',
		'http://something.internal/',
		'https://[::1]/',
		'https://[fe80::1]/',
		'https://[fd00::1]/',
		'ftp://example.com',
		'file:///etc/passwd',
		'javascript:alert(1)',
		'not a url',
	];

	it('allows public http(s) destinations', () => {
		for (const u of ALLOWED) expect(isNavAllowed(u), u).toBe(true);
	});

	it('blocks loopback, private, link-local, metadata, and non-http schemes', () => {
		for (const u of BLOCKED) expect(isNavAllowed(u), u).toBe(false);
	});

	it('blocks encoded IPv4 forms and IPv6 literals that embed a private IPv4', () => {
		const ENCODED = [
			'http://2130706433/',                       // decimal 127.0.0.1
			'http://0x7f.1/',                           // hex short form
			'http://0177.0.0.1/',                       // octal
			'http://[::ffff:10.0.0.1]/',                // IPv4-mapped IPv6
			'http://[::ffff:169.254.169.254]/latest/',  // mapped metadata
			'http://[64:ff9b::7f00:1]/',                // NAT64 of loopback
			'http://[2002:a9fe:a9fe::1]/',              // 6to4 of metadata
			'http://[ff02::1]/',                        // multicast
		];
		for (const u of ENCODED) expect(isNavAllowed(u), u).toBe(false);
	});
});

describe('sanitizeEvents, batch', () => {
	it('drops invalid events but keeps valid ones in order', () => {
		const out = sanitizeEvents([
			{ t: 'move', x: 0.1, y: 0.1 },
			{ t: 'bogus' },
			{ t: 'click', x: 0.2, y: 0.2 },
			{ t: 'nav', url: 'http://127.0.0.1' }, // dropped (blocked host)
			{ t: 'text', text: 'hi' },
		]);
		expect(out).toEqual([
			{ t: 'move', x: 0.1, y: 0.1 },
			{ t: 'click', x: 0.2, y: 0.2, button: 'left' },
			{ t: 'text', text: 'hi' },
		]);
	});

	it('caps the batch length', () => {
		const many = Array.from({ length: MAX_EVENTS_PER_BATCH + 25 }, () => ({ t: 'move', x: 0.5, y: 0.5 }));
		expect(sanitizeEvents(many).length).toBe(MAX_EVENTS_PER_BATCH);
	});

	it('returns [] for non-array input', () => {
		expect(sanitizeEvents(null)).toEqual([]);
		expect(sanitizeEvents('nope')).toEqual([]);
	});
});
