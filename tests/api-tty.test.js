// Coverage for api/tty.js, the hosted terminal renderer behind `curl three.ws/tty`.
//
// The renderer itself is tested in packages/tty-3d/tests. What is tested here is
// everything the HTTP boundary owns: what gets rendered, what colour depth a
// caller with no TERM ends up with, and the two answers that must never be
// wrong (a private avatar, and a default model that is read off disk rather
// than fetched from our own origin).

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import handler, { colorModeFor, defaultModelPath, resolveSource, sceneFromQuery } from '../api/tty.js';

describe('colour negotiation', () => {
	it('defaults to 256 colour, because curl forwards no terminal hints', () => {
		// Truecolor would be prettier and is the wrong default: a terminal that
		// cannot do it renders the escape sequences as literal text across the
		// user's screen. 256 colour is universally supported by anything that
		// renders escapes at all.
		expect(colorModeFor({}, {})).toBe('ansi256');
	});

	it('honours an explicit mode', () => {
		expect(colorModeFor({ color: 'mono' }, {})).toBe('mono');
		expect(colorModeFor({ color: 'TRUECOLOR' }, {})).toBe('truecolor');
	});

	it('ignores a mode it does not know rather than failing the request', () => {
		expect(colorModeFor({ color: 'sixel' }, {})).toBe('ansi256');
	});

	it('upgrades when the caller advertises truecolor', () => {
		expect(colorModeFor({}, { 'x-color': 'truecolor' })).toBe('truecolor');
	});
});

describe('default model', () => {
	it('resolves to a file that exists in this checkout', () => {
		const path = defaultModelPath();
		expect(path).toBeTruthy();
		expect(existsSync(path)).toBe(true);
		expect(path.endsWith('default.glb')).toBe(true);
	});

	it('returns null rather than a broken path when nothing is staged', () => {
		expect(defaultModelPath('/nonexistent-root-for-this-test')).toBeNull();
	});

	it('is a filesystem path, never a URL back to our own origin', async () => {
		// REGRESSION: building `https://${host}/avatars/default.glb` and fetching
		// it made the endpoint guess its own scheme from headers. Behind a proxy
		// that does not set x-forwarded-proto that guess is wrong, and the whole
		// feature 502s while looking like a model problem.
		const source = await resolveSource({});
		expect(source.url).not.toMatch(/^https?:\/\//);
		expect(existsSync(source.url)).toBe(true);
	});
});

describe('source resolution', () => {
	it('refuses a URL the SSRF guard rejects', async () => {
		await expect(resolveSource({ src: 'http://169.254.169.254/latest/meta-data/' })).rejects.toThrow();
		await expect(resolveSource({ src: 'http://127.0.0.1:8080/model.glb' })).rejects.toThrow();
		await expect(resolveSource({ src: 'file:///etc/passwd' })).rejects.toThrow();
	});

	it('reserves scene names without treating an avatar id as a scene', () => {
		expect(sceneFromQuery({ avatar: 'walk' })).toBe('walk');
		expect(sceneFromQuery({ scene: 'Birds' })).toBe('birds');
		expect(sceneFromQuery({ avatar: 'not-a-uuid' })).toBeNull();
		expect(sceneFromQuery({ avatar: '8f2c1a90-1c4e-4b2b-9d77-3f0a1b2c3d4e' })).toBeNull();
		expect(sceneFromQuery({ src: 'https://example.com/a.glb', avatar: 'walk' })).toBeNull();
	});

	it('returns nothing for an avatar id that does not resolve', async () => {
		// A non-UUID short-circuits in getAvatar without touching Postgres, so
		// this stays a pure unit test.
		expect(await resolveSource({ avatar: 'not-a-uuid' })).toBeNull();
	});

	it('rejects an explicit scene name it does not know', async () => {
		// scene=nope must not silently draw the default agent. A reserved name
		// is a scene. Anything else named as a scene is a mistake.
		const res = {
			statusCode: 200,
			headers: {},
			body: '',
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			getHeader(k) { return this.headers[k.toLowerCase()]; },
			write(c) { this.body += c; return true; },
			end(c) { if (c) this.body += c; },
			on() {},
		};
		await handler({ url: '/api/tty?scene=nope&frames=1&raw=1', headers: {}, method: 'GET', on() {} }, res);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatch(/unknown_scene/);
		expect(res.body).not.toMatch(/three\.ws/);
	});

	it('sends a browser that names an unknown scene to the page', async () => {
		const res = {
			statusCode: 200,
			headers: {},
			body: '',
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			end() {},
			on() {},
		};
		await handler({ url: '/api/tty?scene=nope', headers: { accept: 'text/html' }, method: 'GET', on() {} }, res);
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe('/tty');
	});

	it('lets an explicit model URL win over a bad scene name', async () => {
		const res = {
			statusCode: 200,
			headers: {},
			body: '',
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			write() { return true; },
			end(c) { if (c) this.body += c; },
			on() {},
		};
		await handler({
			url: '/api/tty?scene=nope&src=http://127.0.0.1/a.glb&frames=1&raw=1',
			headers: {},
			method: 'GET',
			on() {},
		}, res);
		expect(res.statusCode).toBe(400);
		expect(res.body).toMatch(/blocked_url/);
		expect(res.body).not.toMatch(/unknown_scene/);
	});
});
