// @vitest-environment jsdom
//
// Forge needs a free account to make a model or add a photo. The moment a
// visitor is asked to sign in is where first-time users are lost, so the wall
// must lose nothing:
//   - the return address after sign-in is the Forge page they left, and can
//     only ever be a path on this site (no open redirect);
//   - the prompt and the chosen options survive the round trip through
//     sign-in or registration and come back ready to generate in one click;
//   - a session that ends mid-visit says so ("your session ended") instead of
//     telling a returning creator they need an account;
//   - the page can tell signed in, signed out and unknown apart, so it never
//     claims a session ended for someone who was never signed in.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	SIGN_IN_DRAFT_KEY,
	SIGN_IN_DRAFT_TTL_MS,
	forgeReturnPath,
	forgeAuthHref,
	normalizeSignInDraft,
	saveSignInDraft,
	takeSignInDraft,
	isAuthLink,
	restoredDraftNote,
} from '../src/forge-sign-in-return.js';

function memoryStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		_map: map,
	};
}

describe('forgeReturnPath: the address sign-in sends the visitor back to', () => {
	it('keeps a same-site Forge path with its query and hash', () => {
		expect(forgeReturnPath({ pathname: '/forge', search: '?mode=image', hash: '#make' })).toBe('/forge?mode=image#make');
		expect(forgeReturnPath({ pathname: '/forge-max', search: '', hash: '' })).toBe('/forge-max');
	});

	it('rejects a protocol-relative path, which a browser would treat as another site', () => {
		// https://three.ws//evil.com/x has location.pathname "//evil.com/x".
		expect(forgeReturnPath({ pathname: '//evil.com/x', search: '', hash: '' })).toBe('/forge');
		expect(forgeReturnPath({ pathname: '///evil.com', search: '', hash: '' })).toBe('/forge');
	});

	it('rejects absolute URLs, script schemes, backslashes and control characters', () => {
		expect(forgeReturnPath({ pathname: 'https://evil.com', search: '', hash: '' })).toBe('/forge');
		expect(forgeReturnPath({ pathname: 'javascript:alert(1)', search: '', hash: '' })).toBe('/forge');
		expect(forgeReturnPath({ pathname: '/\\evil.com', search: '', hash: '' })).toBe('/forge');
		expect(forgeReturnPath({ pathname: '/forge\n', search: '', hash: '' })).toBe('/forge');
		expect(forgeReturnPath(null)).toBe('/forge');
	});

	it('builds sign-in and registration links that carry the validated path', () => {
		const loc = { pathname: '/forge', search: '?tier=high', hash: '' };
		expect(forgeAuthHref('login', loc)).toBe(`/login?next=${encodeURIComponent('/forge?tier=high')}`);
		expect(forgeAuthHref('register', loc)).toBe(`/register?next=${encodeURIComponent('/forge?tier=high')}`);
		expect(forgeAuthHref('login', { pathname: '//evil.com', search: '', hash: '' })).toBe(`/login?next=${encodeURIComponent('/forge')}`);
	});
});

describe('uploadSignInUrl (src/shared/upload-sign-in.js) validates the return address', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('never puts a protocol-relative path into ?next=', async () => {
		vi.stubGlobal('location', { pathname: '//evil.com/x', search: '?a=1', hash: '' });
		vi.resetModules();
		const { uploadSignInUrl } = await import('../src/shared/upload-sign-in.js');
		const next = new URL(uploadSignInUrl(), 'https://three.ws').searchParams.get('next');
		expect(next.startsWith('//')).toBe(false);
		expect(next).toBe('/forge');
	});

	it('keeps the page the visitor is on', async () => {
		vi.stubGlobal('location', { pathname: '/forge', search: '?mode=image', hash: '' });
		vi.resetModules();
		const { uploadSignInUrl } = await import('../src/shared/upload-sign-in.js');
		expect(uploadSignInUrl()).toBe(`/login?next=${encodeURIComponent('/forge?mode=image')}`);
	});
});

describe('sign-in draft: what the visitor set up survives the round trip', () => {
	let storage;
	beforeEach(() => {
		storage = memoryStorage();
	});

	const draft = {
		prompt: 'a small wooden chair with a woven seat',
		mode: 'text',
		tier: 'draft',
		engineId: 'nvidia',
		aspect: '4:3',
		hadPhotos: false,
		creationId: null,
	};

	it('restores the prompt and every option once, then forgets them', () => {
		saveSignInDraft(storage, draft, 1_000);
		expect(takeSignInDraft(storage, 2_000)).toEqual(draft);
		expect(takeSignInDraft(storage, 3_000)).toBeNull();
		expect(storage.getItem(SIGN_IN_DRAFT_KEY)).toBeNull();
	});

	it('expires, so an abandoned sign-in does not refill the box days later', () => {
		saveSignInDraft(storage, draft, 1_000);
		expect(takeSignInDraft(storage, 1_000 + SIGN_IN_DRAFT_TTL_MS + 1)).toBeNull();
		expect(storage.getItem(SIGN_IN_DRAFT_KEY)).toBeNull();
	});

	it('does not save an empty composer (nothing to lose)', () => {
		saveSignInDraft(storage, { prompt: '   ', mode: 'text', tier: 'standard', aspect: '1:1' }, 1_000);
		expect(storage.getItem(SIGN_IN_DRAFT_KEY)).toBeNull();
	});

	it('saves a non-default option even with no prompt, and a model on screen', () => {
		saveSignInDraft(storage, { prompt: '', mode: 'image', tier: 'standard', aspect: '1:1', hadPhotos: true }, 1_000);
		expect(takeSignInDraft(storage, 1_001)).toMatchObject({ mode: 'image', hadPhotos: true });
		saveSignInDraft(storage, { prompt: '', mode: 'text', tier: 'standard', aspect: '1:1', creationId: 'abc-123' }, 1_000);
		expect(takeSignInDraft(storage, 1_001)).toMatchObject({ creationId: 'abc-123' });
	});

	it('drops anything it does not recognise instead of trusting stored text', () => {
		expect(
			normalizeSignInDraft({
				prompt: 'x'.repeat(1500),
				mode: 'video',
				tier: 'ultra',
				engineId: '<img src=x onerror=1>',
				aspect: '21:9',
				creationId: '../../etc',
			}),
		).toEqual({ prompt: 'x'.repeat(1000), mode: 'text', tier: 'standard', engineId: null, aspect: '1:1', hadPhotos: false, creationId: null });
		expect(normalizeSignInDraft(null)).toBeNull();
		expect(normalizeSignInDraft('nope')).toBeNull();
	});

	it('survives storage that throws (private mode, quota) without breaking the page', () => {
		const broken = {
			getItem() {
				throw new Error('denied');
			},
			setItem() {
				throw new Error('quota');
			},
			removeItem() {
				throw new Error('denied');
			},
		};
		expect(() => saveSignInDraft(broken, draft)).not.toThrow();
		expect(takeSignInDraft(broken)).toBeNull();
		storage.setItem(SIGN_IN_DRAFT_KEY, '{not json');
		expect(takeSignInDraft(storage)).toBeNull();
	});

	it('tells the visitor what came back, and that photos were not carried over', () => {
		expect(restoredDraftNote({ ...draft, hadPhotos: false })).toMatch(/prompt and settings are back/i);
		expect(restoredDraftNote({ ...draft, hadPhotos: true })).toMatch(/add your photos again/i);
	});
});

describe('isAuthLink: which clicks leave Forge for sign-in or registration', () => {
	const a = (href) => {
		const el = document.createElement('a');
		el.setAttribute('href', href);
		return el;
	};
	it('matches the site sign-in and registration pages', () => {
		expect(isAuthLink(a('/login?next=%2Fforge'), location.origin)).toBe(true);
		expect(isAuthLink(a('/register'), location.origin)).toBe(true);
		expect(isAuthLink(a(`${location.origin}/login`), location.origin)).toBe(true);
	});
	it('ignores other pages, other sites and non-links', () => {
		expect(isAuthLink(a('/forge'), location.origin)).toBe(false);
		expect(isAuthLink(a('/login-help'), location.origin)).toBe(false);
		expect(isAuthLink(a('https://evil.com/login'), location.origin)).toBe(false);
		expect(isAuthLink(null, location.origin)).toBe(false);
		expect(isAuthLink(document.createElement('a'), location.origin)).toBe(false);
	});
});

function response(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('accountState: signed in, signed out, or unknown', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	async function fresh() {
		vi.resetModules();
		return import('../src/shared/upload-sign-in.js');
	}
	it('reads the body of /api/auth/me', async () => {
		fetch.mockResolvedValue(response(200, { user: { id: 'u1' } }));
		expect(await (await fresh()).accountState()).toBe('in');
		fetch.mockResolvedValue(response(200, { user: null }));
		expect(await (await fresh()).accountState()).toBe('out');
		fetch.mockResolvedValue(response(401, {}));
		expect(await (await fresh()).accountState()).toBe('out');
	});
	it('is unknown when auth is erroring or offline, and uploads still go ahead', async () => {
		fetch.mockResolvedValue(response(503, {}));
		let mod = await fresh();
		expect(await mod.accountState()).toBe('unknown');
		expect(await mod.signedInForUploads()).toBe(true);
		fetch.mockRejectedValue(new Error('offline'));
		mod = await fresh();
		expect(await mod.accountState()).toBe('unknown');
		expect(await mod.signedInForUploads()).toBe(true);
	});
});

describe('session ended: a creator who was signed in is told so', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	async function fresh() {
		vi.stubGlobal('location', { pathname: '/forge', search: '', hash: '' });
		vi.resetModules();
		return import('../src/shared/upload-sign-in.js');
	}
	it('generate: says the session ended, the work is kept, and links back', async () => {
		const { renderCreateSignIn } = await fresh();
		const el = document.createElement('p');
		const link = renderCreateSignIn(el, { sessionEnded: true });
		expect(el.textContent).toMatch(/your session ended/i);
		expect(el.textContent).toMatch(/prompt and settings/i);
		expect(link.getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/forge')}`);
	});
	it('generate, never signed in: explains why an account is needed', async () => {
		const { renderCreateSignIn } = await fresh();
		const el = document.createElement('p');
		renderCreateSignIn(el);
		expect(el.textContent).toMatch(/needs a free account/i);
		expect(el.textContent).not.toMatch(/session ended/i);
		expect(el.textContent).toMatch(/prompt and settings/i);
	});
	it('photos: says the photo is not carried over before the visitor leaves', async () => {
		const { renderUploadSignIn } = await fresh();
		const el = document.createElement('p');
		renderUploadSignIn(el);
		expect(el.textContent).toMatch(/stays on this device/i);
		const ended = document.createElement('p');
		renderUploadSignIn(ended, { sessionEnded: true });
		expect(ended.textContent).toMatch(/your session ended/i);
	});
});

describe('site-wide banner (public/sign-in-watch.js) on a page that knew the visitor was signed in', () => {
	const BLOCK = readFileSync(join(process.cwd(), 'public/sign-in-watch.js'), 'utf8');
	const flush = () => new Promise((r) => setTimeout(r, 0));
	beforeEach(() => {
		document.body.innerHTML = '';
		delete document.documentElement.dataset.signInPrompt;
		delete document.documentElement.dataset.sessionSignedIn;
		delete window.__twsSignInWatch;
	});
	function install(upstream) {
		window.fetch = upstream;
		// eslint-disable-next-line no-new-func
		new Function(BLOCK)();
	}
	const refused = () =>
		new Response(JSON.stringify({ error: 'sign_in_required', message: 'Sign in to restyle a 3D model.' }), {
			status: 401,
			headers: { 'content-type': 'application/json' },
		});

	it('says the session ended when an editing tool is refused mid-visit', async () => {
		document.documentElement.dataset.sessionSignedIn = '1';
		install(vi.fn().mockResolvedValue(refused()));
		await window.fetch('/api/forge-stylize', { method: 'POST' });
		await flush();
		expect(document.querySelector('#tws-signin-banner p').textContent).toMatch(/your session ended/i);
	});

	it('keeps the server message for a visitor who was never signed in', async () => {
		install(vi.fn().mockResolvedValue(refused()));
		await window.fetch('/api/forge-stylize', { method: 'POST' });
		await flush();
		expect(document.querySelector('#tws-signin-banner p').textContent).toBe('Sign in to restyle a 3D model.');
	});
});

describe('the Forge page is wired to all of this', () => {
	const forgeJs = readFileSync(join(process.cwd(), 'src/forge.js'), 'utf8');
	const forgeHtml = readFileSync(join(process.cwd(), 'pages/forge.html'), 'utf8');
	it('saves the draft on the way out and restores it on the way back', () => {
		expect(forgeJs).toMatch(/installSignInDraftCapture\(/);
		expect(forgeJs).toMatch(/takeSignInDraft\(/);
	});
	it('ships the account note beside Generate', () => {
		expect(forgeHtml).toMatch(/id="forge-account-note"/);
	});
	it('no longer promises that no login is needed', () => {
		expect(forgeHtml).not.toMatch(/no login/i);
	});
});
