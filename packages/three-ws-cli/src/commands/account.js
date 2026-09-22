// login, logout, whoami, status.

import { signIn, authModeFromFlags } from './common.js';
import { c, line, rows, sym, printJson, tildify, relativeExpiry, shortAddress } from '../ui.js';
import { readStore, mask } from '../store.js';
import { currentIdentity, logout as doLogout } from '../auth.js';
import { credentialsPath } from '../paths.js';
import { CLIENTS, readServers } from '../clients/index.js';
import { isThreeWsEntry } from '../servers.js';

function credentialSummary(store) {
	const a = store.auth;
	if (!a) return null;
	if (a.type === 'oauth') {
		return {
			type: 'oauth',
			label: `OAuth, access token ${a.expires_at ? `expires ${relativeExpiry(a.expires_at)}` : 'expiry unknown'}${a.refresh_token ? ', refreshes automatically' : ''}`,
			expires_at: a.expires_at ? new Date(a.expires_at).toISOString() : null,
			scope: a.scope,
		};
	}
	return { type: 'apikey', label: `API key ${a.prefix ? `${a.prefix}` : ''}${mask(a.key)}`, expires_at: null, scope: a.scope };
}

export async function login(ctx) {
	const me = await signIn(ctx, { mode: authModeFromFlags(ctx.flags), financial: Boolean(ctx.flags.financial) });
	const store = readStore(ctx.env);
	if (ctx.flags.json) {
		printJson({ account: me.user, credential: credentialSummary(store), store: credentialsPath(ctx.env) });
		return 0;
	}
	line(`${c.green(sym.ok)} Signed in as ${c.bold(me.user.email || me.user.id)} ${c.dim(`(${credentialSummary(store).label})`)}`);
	line(c.dim(`  Stored in ${tildify(credentialsPath(ctx.env))} (owner-only). Run \`three-ws setup\` to wire your clients.`));
	return 0;
}

export async function logout(ctx) {
	const { had, revoked } = await doLogout({ origin: ctx.origin, env: ctx.env });
	if (ctx.flags.json) {
		printJson({ signed_out: had, revoked });
		return 0;
	}
	if (!had) line('Not signed in; nothing to remove.');
	else line(`${c.green(sym.ok)} Signed out. ${revoked ? 'The refresh token was revoked on the server.' : 'API keys stay valid until you revoke them at /dashboard/api.'}`);
	line(c.dim('  Client configs are untouched; `three-ws mcp remove <server>` removes entries.'));
	return 0;
}

export async function whoami(ctx) {
	const me = await currentIdentity({ origin: ctx.origin, env: ctx.env });
	if (!me) {
		if (ctx.flags.json) printJson({ signed_in: false });
		else line('Not signed in. Run `npx three-ws login`.');
		return 1;
	}
	if (ctx.flags.json) printJson({ signed_in: true, ...me });
	else line(me.user.email || me.user.id);
	return 0;
}

/** Every three.ws entry in every client config on this machine. */
export function scanClients(env, origin) {
	return CLIENTS.map((client) => {
		const scopes = client.scopes?.includes('project') ? [false, true] : [false];
		const found = [];
		let error = null;
		const files = [];
		for (const project of scopes) {
			const file = client.configPath(env, { project });
			try {
				const servers = readServers(client, env, { project });
				const names = Object.entries(servers).filter(([name, entry]) => isThreeWsEntry(name, entry, origin)).map(([name, entry]) => ({ name, entry, project }));
				if (names.length) files.push(file);
				found.push(...names);
			} catch (err) {
				error = err.message;
			}
		}
		return { client, detected: client.detect(env), entries: found, files, error };
	});
}

function describeEntry(entry) {
	if (entry.url || entry.httpUrl || entry.serverUrl) return 'http';
	const args = Array.isArray(entry.args) ? entry.args : [];
	if (args.includes('proxy')) return 'proxy';
	return 'stdio';
}

export async function status(ctx) {
	const { env, origin } = ctx;
	const store = readStore(env);
	let me = null;
	let authError = null;
	try {
		me = await currentIdentity({ origin, env });
	} catch (err) {
		authError = err.message;
	}
	const cred = credentialSummary(store);
	const clients = scanClients(env, origin);

	if (ctx.flags.json) {
		printJson({
			origin,
			store: credentialsPath(env),
			signed_in: Boolean(me),
			auth_error: authError,
			account: me?.user || null,
			plan: me?.plan || null,
			credential: cred,
			wallet: me?.wallet || null,
			clients: clients.map((x) => ({ id: x.client.id, detected: x.detected, files: x.files, servers: x.entries.map((e) => ({ name: e.name, transport: describeEntry(e.entry), project: e.project })), error: x.error })),
		});
		return me ? 0 : 1;
	}

	line(`${c.bold('three.ws')} ${c.dim(origin)}`);
	const pairs = [];
	if (me) {
		pairs.push(['Account', `${me.user.email || me.user.id}`]);
		if (me.plan) {
			const quota = me.plan.mcp_calls_per_day != null ? `, ${me.plan.mcp_calls_24h}/${me.plan.mcp_calls_per_day} MCP calls in the last 24h` : '';
			pairs.push(['Plan', `${me.plan.plan}${quota}`]);
		}
	} else {
		pairs.push(['Account', authError ? c.red(authError) : c.yellow('not signed in; run `npx three-ws login`')]);
	}
	if (cred) pairs.push(['Credential', cred.label]);
	if (me?.wallet) {
		const w = me.wallet;
		if (w.provisioned) {
			const bal = `${w.balances?.sol ?? '?'} SOL, ${w.balances?.usdc ?? '?'} USDC`;
			pairs.push(['Wallet', `${shortAddress(w.address)}${w.agent_name ? ` (${w.agent_name})` : ''} on Solana: ${bal}`]);
			pairs.push(['Spending', `${w.spend_enabled ? 'enabled' : 'disabled'}, caps $${w.caps.max_per_call_usdc}/call, $${w.caps.max_per_day_usdc}/day`]);
		} else {
			pairs.push(['Wallet', `none yet; create an agent at ${origin}/create`]);
		}
	} else if (me?.missing?.includes('wallet:read')) {
		pairs.push(['Wallet', c.dim('this credential lacks wallet:read; `three-ws login` again to grant it')]);
	}
	rows(pairs, '  ');
	line('');
	line(c.bold('Clients'));
	for (const x of clients) {
		if (!x.detected && !x.entries.length) continue;
		if (x.error) {
			line(`  ${c.red(sym.fail)} ${x.client.label.padEnd(15)} ${x.error}`);
			continue;
		}
		if (!x.entries.length) {
			line(`  ${c.dim(sym.dot)} ${x.client.label.padEnd(15)} ${c.dim('installed, not configured; `three-ws setup` adds it')}`);
			continue;
		}
		const names = x.entries.map((e) => `${e.name}${describeEntry(e.entry) === 'proxy' ? c.dim(' (proxy)') : ''}${e.project ? c.dim(' [project]') : ''}`).join(', ');
		line(`  ${c.green(sym.ok)} ${x.client.label.padEnd(15)} ${names}`);
		line(`    ${c.dim(x.files.map(tildify).join(', '))}`);
	}
	if (!clients.some((x) => x.detected || x.entries.length)) line(c.dim('  No MCP clients found. `three-ws setup` can still print a config for any client.'));
	return me ? 0 : 1;
}
