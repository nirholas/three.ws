// @vitest-environment jsdom
//
// Making or uploading anything needs an account, and every creation endpoint
// answers an anonymous caller with 401 `sign_in_required`. Most of the pages
// that call those endpoints would show that as a generic failure, so
// public/nav.js (loaded on every page) watches same-origin fetches and shows one
// banner with the server's message and a sign-in link back to the page. The
// Forge pages render their own prompt for generating and photo uploads
// (src/shared/upload-sign-in.js) and list those paths in <html
// data-sign-in-prompt>, so the banner stands aside for those calls only.
//
// The watcher is the self-contained block at the end of nav.js; this evaluates
// that block alone, so the rest of the nav (which fetches its own markup) does
// not run here.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAV = readFileSync(join(process.cwd(), 'public/nav.js'), 'utf8');
const BLOCK = NAV.slice(NAV.indexOf('// ── Sign-in prompt for creation endpoints'));

function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let upstream;

function install() {
	delete window.__twsSignInWatch;
	upstream = vi.fn();
	window.fetch = upstream;
	// eslint-disable-next-line no-new-func
	new Function(BLOCK)();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	document.body.innerHTML = '';
	delete document.documentElement.dataset.signInPrompt;
	history.replaceState(null, '', '/avatar-studio?tab=make');
	install();
});

describe('site-wide sign-in banner (public/nav.js)', () => {
	it('shows the server message and a sign-in link back to this page on sign_in_required', async () => {
		upstream.mockResolvedValue(jsonResponse(401, { error: 'sign_in_required', message: 'Sign in to make a 3D model. A three.ws account is free.' }));
		const res = await window.fetch('/api/forge', { method: 'POST' });
		await flush();
		const banner = document.getElementById('tws-signin-banner');
		expect(banner).not.toBeNull();
		expect(banner.querySelector('p').textContent).toBe('Sign in to make a 3D model. A three.ws account is free.');
		expect(banner.querySelector('a').getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/avatar-studio?tab=make')}`);
		// The caller still gets the untouched response to handle itself.
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: 'sign_in_required' });
	});

	it('ignores other 401s, other statuses and other origins', async () => {
		upstream.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
		await window.fetch('/api/agents/mine');
		upstream.mockResolvedValueOnce(jsonResponse(200, { error: 'sign_in_required' }));
		await window.fetch('/api/forge');
		upstream.mockResolvedValueOnce(jsonResponse(401, { error: 'sign_in_required' }));
		await window.fetch('https://example.com/api/forge');
		await flush();
		expect(document.getElementById('tws-signin-banner')).toBeNull();
	});

	it('stands aside for the calls a page prompts for itself, and only those', async () => {
		document.documentElement.dataset.signInPrompt = '/api/forge /api/forge-upload';
		upstream.mockImplementation(async () => jsonResponse(401, { error: 'sign_in_required' }));
		await window.fetch('/api/forge?x=1');
		await window.fetch(new Request(`${location.origin}/api/forge-upload`, { method: 'POST' }));
		await flush();
		expect(document.getElementById('tws-signin-banner')).toBeNull();
		await window.fetch('/api/forge-stylize');
		await flush();
		expect(document.getElementById('tws-signin-banner')).not.toBeNull();
	});

	it('keeps one banner and lets the visitor dismiss it', async () => {
		upstream.mockImplementation(async () => jsonResponse(401, { error: 'sign_in_required', message: 'Sign in to upload a photo.' }));
		await window.fetch('/api/forge-upload');
		await window.fetch('/api/forge-upload');
		await flush();
		expect(document.querySelectorAll('#tws-signin-banner')).toHaveLength(1);
		document.querySelector('#tws-signin-banner button').click();
		expect(document.getElementById('tws-signin-banner')).toBeNull();
	});
});

describe('Forge in-page prompts (src/shared/upload-sign-in.js)', () => {
	it('names the two endpoints the page prompts for, so the banner stands aside for them', async () => {
		vi.resetModules();
		await import('../src/shared/upload-sign-in.js');
		expect(document.documentElement.dataset.signInPrompt).toBe('/api/forge /api/forge-upload');
	});

	it('renders the generate prompt with a focusable link back here and no claim that generating is open', async () => {
		vi.resetModules();
		const { renderCreateSignIn, renderUploadSignIn } = await import('../src/shared/upload-sign-in.js');
		const el = document.createElement('p');
		const link = renderCreateSignIn(el);
		expect(link.tagName).toBe('A');
		expect(link.getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/avatar-studio?tab=make')}`);
		expect(el.textContent).toMatch(/Making a 3D model needs a free account/);
		expect(el.classList.contains('upload-sign-in--panel')).toBe(true);

		const photo = document.createElement('p');
		renderUploadSignIn(photo);
		expect(photo.textContent).toMatch(/Photos need a free account/);
		expect(photo.textContent).not.toMatch(/without/);
	});
});
