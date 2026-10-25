// Walk Avatar extension: the auth-callback tab may only install a session token
// when it carries the one-time state minted by a sign-in the extension started.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'extensions/walk-avatar/background.js'), 'utf8');

function loadBackground() {
	const area = () => {
		const data = {};
		return {
			data,
			get: async (k) => {
				if (k == null) return { ...data };
				const keys = Array.isArray(k) ? k : [k];
				return Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]));
			},
			set: async (o) => Object.assign(data, o),
			remove: async (k) => [].concat(k).forEach((x) => delete data[x]),
		};
	};
	const listeners = { updated: [], message: [] };
	const created = [];
	const ev = (bucket) => ({ addListener: (fn) => bucket?.push(fn) });
	const chrome = {
		storage: { local: area(), session: area(), sync: area() },
		runtime: {
			onInstalled: ev(), onMessage: ev(listeners.message),
			sendMessage: () => Promise.resolve(),
		},
		tabs: {
			onUpdated: ev(listeners.updated), onRemoved: ev(),
			create: async (o) => { created.push(o); return { id: 99 }; },
			remove: async () => {},
		},
		commands: { onCommand: ev() },
		action: {},
	};
	const ctx = vm.createContext({ chrome, URL, console, crypto, btoa, fetch: () => {} });
	vm.runInContext(src, ctx);
	return { chrome, listeners, created };
}

const beginSignin = (l) =>
	new Promise((resolve) => {
		for (const fn of l.message) fn({ type: 'begin-signin' }, {}, resolve);
	});

const fire = async (l, url) => {
	for (const fn of l.updated) fn(7, { status: 'complete' }, { url });
	await new Promise((r) => setTimeout(r, 10));
};

describe('walk-avatar auth callback state binding', () => {
	let bg;
	beforeEach(() => { bg = loadBackground(); });

	it('ignores a callback token when no sign-in was started', async () => {
		await fire(bg.listeners, 'https://three.ws/extension/auth-callback?token=attacker');
		expect(bg.chrome.storage.local.data.threews_session).toBeUndefined();
	});

	it('ignores a callback token with a wrong state', async () => {
		await beginSignin(bg.listeners);
		await fire(bg.listeners, 'https://three.ws/extension/auth-callback?token=attacker&state=wrong');
		expect(bg.chrome.storage.local.data.threews_session).toBeUndefined();
	});

	it('accepts the token once with the matching state, then rejects replay', async () => {
		await beginSignin(bg.listeners);
		const login = new URL(bg.created[0].url);
		const next = new URL(login.searchParams.get('next'), 'https://three.ws');
		const state = next.searchParams.get('state');
		expect(state).toMatch(/^[A-Za-z0-9_-]{20,}$/);
		const cb = `https://three.ws/extension/auth-callback?token=good&state=${state}`;
		await fire(bg.listeners, cb);
		expect(bg.chrome.storage.local.data.threews_session).toBe('good');
		delete bg.chrome.storage.local.data.threews_session;
		await fire(bg.listeners, cb);
		expect(bg.chrome.storage.local.data.threews_session).toBeUndefined();
	});
});
