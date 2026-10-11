// `three-ws doctor`: diagnose a broken setup and say how to fix each finding.
//
// Checks, in order: Node version, the credential file (present, valid, owner-only),
// the sign-in (expired, revoked, refreshable), every client config (parses, has a
// three.ws entry, launcher exists, no secret written in plain text), and whether
// each configured server answers a live tools/list. Exit 0 when nothing failed,
// 1 otherwise; warnings alone do not fail.

import fs from 'node:fs';
import path from 'node:path';
import { c, line, sym, printJson, tildify } from '../ui.js';
import { readStore } from '../store.js';
import { credentialsPath } from '../paths.js';
import { bearerFor } from '../oauth.js';
import { currentIdentity } from '../auth.js';
import { listTools } from '../mcp-http.js';
import { request } from '../http.js';
import { scanClients } from './account.js';

const MIN_NODE = [20, 12];
const SECRET_RE = /sk_(live|test)_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{20,}/;

const ok = (id, title, detail = '') => ({ id, status: 'ok', title, detail });
const warn = (id, title, detail, fix) => ({ id, status: 'warn', title, detail, fix });
const fail = (id, title, detail, fix) => ({ id, status: 'fail', title, detail, fix });

export function checkNode(version = process.versions.node) {
	const [maj, min] = version.split('.').map(Number);
	if (maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1])) return ok('node', `Node.js ${version}`);
	return fail('node', `Node.js ${version} is too old`, `three-ws needs ${MIN_NODE.join('.')} or newer.`, 'Install a current LTS from https://nodejs.org and run the command again.');
}

export function checkStoreFile(env) {
	const file = credentialsPath(env);
	let stat;
	try {
		stat = fs.statSync(file);
	} catch {
		return { check: warn('credentials', 'No credential file', `${tildify(file)} does not exist.`, 'Run `npx three-ws login`.'), store: null };
	}
	let store;
	try {
		store = readStore(env);
	} catch (err) {
		return { check: fail('credentials', 'Credential file is unreadable', err.message, `Delete ${tildify(file)} and run \`npx three-ws login\`.`), store: null };
	}
	if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
		return { check: warn('credentials', 'Credential file is readable by other users', `${tildify(file)} has mode ${(stat.mode & 0o777).toString(8)}.`, `chmod 600 ${tildify(file)}`), store };
	}
	return { check: ok('credentials', 'Credential file is owner-only', tildify(file)), store };
}

async function checkAuth({ env, origin, store }) {
	if (!store?.auth) return fail('auth', 'Not signed in', 'No credential is stored.', 'Run `npx three-ws login` (add `--device` over SSH).');
	try {
		const me = await currentIdentity({ origin, env });
		if (!me) return fail('auth', 'Not signed in', 'No credential is stored.', 'Run `npx three-ws login`.');
		const kind = store.auth.type === 'apikey' ? 'API key' : 'OAuth session';
		return ok('auth', `Signed in as ${me.user.email || me.user.id}`, kind);
	} catch (err) {
		const expired = err.code === 'login_required' || err.status === 401 || err.status === 400;
		if (expired) return fail('auth', 'Sign-in expired or revoked', err.message, 'Run `npx three-ws login` to sign in again.');
		return warn('auth', 'Could not verify the sign-in', err.message, 'Check your network, then run `npx three-ws status`.');
	}
}

function commandOnPath(command, env) {
	if (path.isAbsolute(command)) return fs.existsSync(command);
	const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
	for (const dir of String(env.vars.PATH || '').split(path.delimiter).filter(Boolean)) {
		for (const ext of exts) {
			try { fs.accessSync(path.join(dir, command + ext), fs.constants.X_OK); return true; } catch { /* keep looking */ }
		}
	}
	return false;
}

/** The hosted URL an entry talks to, direct or through the proxy. */
export function entryUrl(entry) {
	const direct = entry.url || entry.httpUrl || entry.serverUrl;
	if (direct) return direct;
	const args = Array.isArray(entry.args) ? entry.args : [];
	const i = args.indexOf('proxy');
	return i >= 0 && /^https?:/.test(args[i + 1] || '') ? args[i + 1] : null;
}

function checkClients({ env, origin }) {
	const out = [];
	const urls = new Map();
	let configured = 0;
	for (const x of scanClients(env, origin)) {
		const label = x.client.label;
		if (x.error) {
			out.push(fail(`client:${x.client.id}`, `${label} config is broken`, x.error, 'Fix or remove the file named above (a `.three-ws.bak` copy sits beside it if we edited it), then run `npx three-ws setup`.'));
			continue;
		}
		if (!x.entries.length) {
			if (x.detected) out.push(warn(`client:${x.client.id}`, `${label} is installed but has no three.ws server`, '', `Run \`npx three-ws setup --clients ${x.client.id}\`.`));
			continue;
		}
		configured += 1;
		out.push(ok(`client:${x.client.id}`, `${label}: ${x.entries.map((e) => e.name).join(', ')}`, x.files.map(tildify).join(', ')));
		for (const { name, entry } of x.entries) {
			if (SECRET_RE.test(JSON.stringify(entry))) {
				out.push(warn(`secret:${x.client.id}:${name}`, `${label} / ${name} holds a secret in plain text`, 'The config file contains an API key or token.', `Rewrite it without one: \`npx three-ws setup --clients ${x.client.id} --proxy\`, then rotate the key on /dashboard/api if the file was shared.`));
			}
			if (entry.command && !commandOnPath(entry.command, env)) {
				out.push(fail(`launcher:${x.client.id}:${name}`, `${label} / ${name} launches \`${entry.command}\`, which is not on PATH`, '', 'Install Node.js (it provides npx), restart the client, or rerun `npx three-ws setup`.'));
			}
			const url = entryUrl(entry);
			if (url) urls.set(url, name);
		}
	}
	return { checks: out, urls: [...urls.keys()], configured };
}

async function probeServers({ urls, env, origin }) {
	let bearer = null;
	try { bearer = await bearerFor(env, { origin }); } catch { bearer = null; }
	return Promise.all(urls.map(async (url) => {
		try {
			const { tools } = await listTools(url, { bearer });
			return ok(`server:${url}`, `${url} answers tools/list`, `${tools.length} tools`);
		} catch (err) {
			const needsLogin = /401|403|unauthor/i.test(err.message);
			if (needsLogin) return fail(`server:${url}`, `${url} refused the credential`, err.message, 'Run `npx three-ws login`.');
			return fail(`server:${url}`, `${url} is unreachable`, err.message, 'Check your network and proxy settings; if it persists, see https://three.ws/status.');
		}
	}));
}

async function checkOrigin(origin) {
	const started = Date.now();
	try {
		const res = await request(`${origin}/.well-known/mcp.json`, { timeoutMs: 10_000 });
		if (!res.ok) return fail('origin', `${origin} answered ${res.status}`, '', 'Try again shortly; if it persists, see https://three.ws/status.');
		return ok('origin', `${origin} is reachable`, `${Date.now() - started} ms`);
	} catch (err) {
		return fail('origin', `${origin} is unreachable`, err.message, 'Check your network, VPN or proxy. Use --origin to test another deployment.');
	}
}

export async function runChecks({ env, origin }) {
	const checks = [checkNode()];
	const { check, store } = checkStoreFile(env);
	checks.push(check);
	const [originCheck, authCheck] = await Promise.all([checkOrigin(origin), checkAuth({ env, origin, store })]);
	checks.push(originCheck, authCheck);
	const clients = checkClients({ env, origin });
	checks.push(...clients.checks);
	if (!clients.configured) checks.push(warn('clients', 'No client has three.ws configured', '', 'Run `npx three-ws --claude` (or --cursor, --codex, --vscode, --windsurf).'));
	if (originCheck.status === 'ok' && clients.urls.length) checks.push(...(await probeServers({ urls: clients.urls, env, origin })));
	return checks;
}

export async function doctor(ctx) {
	const checks = await runChecks({ env: ctx.env, origin: ctx.origin });
	const failed = checks.filter((x) => x.status === 'fail').length;
	const warned = checks.filter((x) => x.status === 'warn').length;
	if (ctx.flags.json) {
		printJson({ ok: failed === 0, failed, warnings: warned, checks });
		return failed ? 1 : 0;
	}
	line(`${c.bold('three-ws doctor')} ${c.dim(ctx.origin)}`);
	for (const x of checks) {
		const mark = x.status === 'ok' ? c.green(sym.ok) : x.status === 'warn' ? c.yellow(sym.warn) : c.red(sym.fail);
		line(`  ${mark} ${x.title}${x.detail ? c.dim(`  ${x.detail}`) : ''}`);
		if (x.fix) line(`      ${c.cyan(sym.arrow)} ${x.fix}`);
	}
	line('');
	line(failed ? c.red(`${failed} problem(s) found.`) : warned ? c.yellow(`No failures, ${warned} warning(s).`) : c.green('Everything checks out.'));
	return failed ? 1 : 0;
}
