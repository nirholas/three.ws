// The credential store: ~/.config/three-ws/credentials.json, mode 0600.
//
// Shape (version 1):
//   {
//     version: 1,
//     origin: 'https://three.ws',
//     account: { user_id, email } | null,
//     auth: { type: 'oauth', access_token, refresh_token, expires_at, scope, client_id }
//         | { type: 'apikey', key, prefix, scope, key_id }
//         | null,
//     stdio_key: { key, prefix, key_id, scope } | null,   // for @three-ws/*-mcp stdio packages
//     oauth_clients: { [origin]: { client_id, redirect_uri } },
//     tools: { [serverSlug]: { tiers: ['read','write'], enabled: [toolName...] } },
//   }
//
// Writes go to a temp file in the same directory and are renamed into place, so
// a crash mid-write never leaves a half-written credential file, and a reader in
// another process (a proxy starting up) sees either the old file or the new one.

import fs from 'node:fs';
import path from 'node:path';
import { credentialsPath, systemEnv } from './paths.js';

export const DEFAULT_ORIGIN = 'https://three.ws';

function emptyStore() {
	return { version: 1, origin: DEFAULT_ORIGIN, account: null, auth: null, stdio_key: null, oauth_clients: {}, tools: {} };
}

export function readStore(env = systemEnv()) {
	const file = credentialsPath(env);
	let raw;
	try {
		raw = fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return emptyStore();
		throw err;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${file} is not valid JSON. Delete it and run \`three-ws login\` again.`);
	}
	return { ...emptyStore(), ...parsed };
}

export function writeStore(store, env = systemEnv()) {
	const file = credentialsPath(env);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	// rename keeps the temp file's mode, but an existing file created by an older
	// build or by hand might have been wider; enforce it every time.
	if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
	return file;
}

export function updateStore(mutator, env = systemEnv()) {
	const store = readStore(env);
	const next = mutator(store) || store;
	writeStore(next, env);
	return next;
}

/** The origin every command talks to: flag, then env, then the stored one. */
export function resolveOrigin({ flag, env = systemEnv(), store } = {}) {
	const raw = flag || env.vars.THREE_WS_ORIGIN || store?.origin || DEFAULT_ORIGIN;
	return String(raw).replace(/\/+$/, '');
}

/** Last four characters only. A stored secret is never printed whole. */
export function mask(secret) {
	if (!secret) return '';
	const s = String(secret);
	return `…${s.slice(-4)}`;
}

// ── Cross-process lock ───────────────────────────────────────────────────────
// Refresh tokens rotate on every use and the server treats a reused one as
// theft, revoking the whole family. Six proxies starting together would each
// refresh the same token and sign the user out, so a refresh holds this lock,
// re-reads the store, and only refreshes if nobody else just did.

const LOCK_STALE_MS = 30_000;

export async function withStoreLock(fn, env = systemEnv(), { timeoutMs = 20_000 } = {}) {
	const lock = `${credentialsPath(env)}.lock`;
	fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
	const started = Date.now();
	for (;;) {
		try {
			const fd = fs.openSync(lock, 'wx', 0o600);
			fs.writeSync(fd, String(process.pid));
			fs.closeSync(fd);
			break;
		} catch (err) {
			if (err.code !== 'EEXIST') throw err;
			let age = 0;
			try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
			if (age > LOCK_STALE_MS) {
				try { fs.unlinkSync(lock); } catch { /* another waiter removed it first */ }
				continue;
			}
			if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${lock}; delete it if no other three-ws process is running`);
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	try {
		return await fn();
	} finally {
		try { fs.unlinkSync(lock); } catch { /* already gone */ }
	}
}
