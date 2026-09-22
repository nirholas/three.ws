// `three-ws mcp list | add <server> | remove <server>`: the non-interactive
// equivalents of setup, for scripts, dotfiles and CI.

import { c, line, sym, printJson, tildify } from '../ui.js';
import { readStore } from '../store.js';
import { loadDirectory, hostedServers } from '../servers.js';
import { detectClients, getClient, removeServer } from '../clients/index.js';
import { verifyServers, ensureSelections, applyToClients } from '../configure.js';
import { scanClients } from './account.js';

function clientsFrom(flags, env) {
	if (flags.clients) return String(flags.clients).split(',').map((s) => getClient(s.trim()));
	const detected = detectClients(env);
	if (!detected.length) throw new Error('no MCP clients detected; name one with --clients (e.g. --clients cursor)');
	return detected;
}

function findServer(all, name) {
	const s = all.find((x) => x.slug === name || x.path === name || x.name === name);
	if (!s) throw new Error(`unknown server "${name}". Available: ${all.map((x) => x.slug).join(', ')}`);
	return s;
}

async function listCmd(ctx) {
	const { flags, env, origin } = ctx;
	if (flags.available) {
		const all = hostedServers(await loadDirectory(origin), origin);
		if (flags.json) printJson(all);
		else for (const s of all) line(`  ${s.slug.padEnd(22)} ${s.url} ${c.dim(s.auth === 'none' ? 'no account needed' : 'sign-in required')}`);
		return 0;
	}
	const scan = scanClients(env, origin);
	if (flags.json) {
		printJson(scan.map((x) => ({ id: x.client.id, detected: x.detected, files: x.files, servers: x.entries.map((e) => e.name), error: x.error })));
		return 0;
	}
	let any = false;
	for (const x of scan) {
		if (x.error) line(`${c.red(sym.fail)} ${x.client.label}: ${x.error}`);
		if (!x.entries.length) continue;
		any = true;
		line(`${c.bold(x.client.label)} ${c.dim(x.files.map(tildify).join(', '))}`);
		for (const e of x.entries) line(`  ${e.name}${e.project ? c.dim(' [project]') : ''}`);
	}
	if (!any) line('No three.ws servers configured in any client. Run `three-ws setup`, or `three-ws mcp list --available` to see them.');
	return 0;
}

async function addCmd(ctx, name) {
	const { flags, env, origin } = ctx;
	if (!name) throw new Error('usage: three-ws mcp add <server> [--clients a,b] [--project] [--proxy]');
	const store = readStore(env);
	const server = findServer(hostedServers(await loadDirectory(origin), origin), name);
	if (server.auth === 'required' && !store.auth) throw new Error('sign in first: `three-ws login` (or `three-ws login --key sk_live_...` in CI)');
	const clients = clientsFrom(flags, env);
	const mode = store.auth?.type === 'apikey' ? 'apikey' : 'oauth';
	ensureSelections([server], { financial: /\bwallet:write\b/.test(store.auth?.scope || ''), env });
	const [result] = await verifyServers({ servers: [server], env, origin });
	const writes = applyToClients({
		clients,
		servers: [server],
		mode,
		apiKey: mode === 'apikey' ? store.auth.key : null,
		liveTools: result.ok ? { [server.slug]: result.tools } : {},
		forceProxy: Boolean(flags.proxy),
		project: Boolean(flags.project),
		origin,
		env,
	});
	if (flags.json) {
		printJson({ server: server.slug, verified: result.ok, tools: result.ok ? result.enabled : null, error: result.error || null, clients: writes.map((w) => ({ id: w.client.id, file: w.file, error: w.error })) });
	} else {
		line(result.ok ? `${c.green(sym.ok)} ${server.slug}: ${result.enabled} tools` : `${c.red(sym.fail)} ${server.slug}: ${result.error}`);
		for (const w of writes) line(w.error ? `  ${c.red(sym.fail)} ${w.client.label}: ${w.error}` : `  ${c.green(sym.ok)} ${w.client.label} ${c.dim(tildify(w.file))}`);
	}
	return result.ok && writes.every((w) => !w.error) ? 0 : 1;
}

function removeCmd(ctx, name) {
	const { flags, env, origin } = ctx;
	if (!name) throw new Error('usage: three-ws mcp remove <server> [--clients a,b]');
	const targets = flags.clients ? String(flags.clients).split(',').map((s) => s.trim()) : null;
	const removed = [];
	for (const x of scanClients(env, origin)) {
		if (targets && !targets.includes(x.client.id)) continue;
		for (const e of x.entries) {
			if (e.name !== name) continue;
			if (removeServer(x.client, name, env, { project: e.project })) removed.push({ client: x.client.id, project: e.project });
		}
	}
	if (flags.json) printJson({ server: name, removed });
	else if (!removed.length) line(`No client has an entry named ${name}. \`three-ws mcp list\` shows what is configured.`);
	else line(`${c.green(sym.ok)} Removed ${name} from ${removed.map((r) => getClient(r.client).label).join(', ')}.`);
	return 0;
}

export async function mcp(ctx) {
	const [sub = 'list', name] = ctx.positionals;
	if (sub === 'list') return listCmd(ctx);
	if (sub === 'add') return addCmd(ctx, name);
	if (sub === 'remove' || sub === 'rm') return removeCmd(ctx, name);
	throw new Error(`unknown mcp subcommand "${sub}". Use list, add or remove.`);
}
