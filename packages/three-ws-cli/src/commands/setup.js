// `three-ws setup`: sign in, pick servers and clients, write every config,
// then prove it with a real tools/list per server.

import * as p from '@clack/prompts';
import { answer, canPrompt, signIn, authModeFromFlags } from './common.js';
import { c, line, sym, printJson, tildify } from '../ui.js';
import { readStore } from '../store.js';
import { currentIdentity, ensureStdioKey } from '../auth.js';
import { loadDirectory, loadCatalog, hostedServers, stdioPackages } from '../servers.js';
import { CLIENTS, PRINT_CLIENT, detectClients, getClient } from '../clients/index.js';
import { verifyServers, ensureSelections, applyToClients } from '../configure.js';
import { usesProxy, buildEntry } from '../entries.js';
import { VERSION } from '../http.js';

function list(value) {
	if (!value) return null;
	return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function pickServers(all, requested) {
	if (!requested) return null;
	const wanted = new Set(requested);
	const picked = all.filter((s) => wanted.has(s.slug) || wanted.has(s.path) || wanted.has(s.name));
	const unknown = requested.filter((r) => !all.some((s) => s.slug === r || s.path === r || s.name === r));
	if (unknown.length) throw new Error(`unknown server(s): ${unknown.join(', ')}. Run \`three-ws mcp list --available\` to see them.`);
	return picked;
}

export async function setup(ctx) {
	const { flags, origin, env } = ctx;
	const interactive = canPrompt(ctx);
	if (interactive) p.intro(`${c.bold('three.ws')} setup ${c.dim(`v${VERSION} · ${origin}`)}`);

	// 1. Account. Reuse a working credential unless a mode was asked for.
	const requestedMode = authModeFromFlags(flags);
	let me = null;
	if (!requestedMode) {
		try { me = await currentIdentity({ origin, env }); } catch { me = null; }
	}
	if (me && interactive) {
		const keep = answer(await p.confirm({ message: `Signed in as ${c.bold(me.user.email || me.user.id)}. Use this account?`, initialValue: true }));
		if (!keep) me = null;
	}
	let financial = Boolean(flags.financial);
	if (!me) {
		if (interactive && !flags.financial) {
			financial = answer(await p.confirm({
				message: 'Allow tools that move funds (spend USDC from your agent wallet, within your caps)?',
				initialValue: false,
			}));
		}
		me = await signIn(ctx, { mode: requestedMode, financial });
		if (interactive) p.log.success(`Signed in as ${c.bold(me.user.email || me.user.id)}`);
	}
	const store = readStore(env);
	const mode = store.auth?.type === 'apikey' ? 'apikey' : 'oauth';

	// 2. Servers, live from the platform's own directory.
	const directory = await loadDirectory(origin);
	const allServers = hostedServers(directory, origin);
	let servers = pickServers(allServers, list(flags.servers));
	if (!servers) {
		if (interactive) {
			const chosen = answer(await p.multiselect({
				message: 'Which three.ws servers should your clients get?',
				options: allServers.map((s) => ({ value: s.slug, label: `${s.name} ${c.dim(s.path)}`, hint: s.auth === 'none' ? 'no account needed' : s.description.slice(0, 70) })),
				initialValues: allServers.filter((s) => s.defaultSelected).map((s) => s.slug),
				required: true,
			}));
			servers = allServers.filter((s) => chosen.includes(s.slug));
		} else {
			servers = allServers.filter((s) => s.defaultSelected);
		}
	}

	// 3. Clients.
	const detected = detectClients(env);
	let clients;
	let printOnly = false;
	const requestedClients = list(flags.clients);
	if (requestedClients) {
		printOnly = requestedClients.includes('print');
		clients = requestedClients.filter((id) => id !== 'print').map(getClient);
	} else if (interactive) {
		const chosen = answer(await p.multiselect({
			message: detected.length ? 'Write the config into which clients?' : 'No MCP clients found on this machine. Write a config for which ones anyway?',
			options: [
				...CLIENTS.map((cl) => ({ value: cl.id, label: cl.label, hint: detected.includes(cl) ? tildify(cl.configPath(env, { project: flags.project })) : 'not detected' })),
				{ value: 'print', label: 'Print the JSON instead', hint: 'for any other MCP client' },
			],
			initialValues: detected.length ? detected.map((cl) => cl.id) : ['print'],
			required: true,
		}));
		printOnly = chosen.includes('print');
		clients = chosen.filter((id) => id !== 'print').map(getClient);
	} else {
		clients = detected;
		printOnly = !detected.length;
	}

	// 4. Optional stdio packages.
	let packages = [];
	const requestedPackages = list(flags.packages);
	if (requestedPackages || (interactive && clients.length && !flags.servers)) {
		const catalog = await loadCatalog(origin);
		const available = stdioPackages(catalog);
		if (requestedPackages) {
			packages = available.filter((pkg) => requestedPackages.includes(pkg.package) || requestedPackages.includes(pkg.slug));
		} else {
			const want = answer(await p.confirm({ message: `Also add stdio servers from npm? ${c.dim(`(${available.length} @three-ws/*-mcp packages)`)}`, initialValue: false }));
			if (want) {
				const chosen = answer(await p.multiselect({
					message: 'Which packages?',
					options: available.map((pkg) => ({ value: pkg.package, label: pkg.package, hint: `${pkg.tools} tools` })),
					required: false,
				}));
				packages = available.filter((pkg) => chosen.includes(pkg.package));
			}
		}
	}
	const stdioKey = packages.some((pkg) => pkg.auth === 'key') ? await ensureStdioKey({ origin, env }) : null;

	// 5. Verify first, so the entries can carry the live tool selection.
	ensureSelections(servers, { financial: financial || /\bwallet:write\b/.test(store.auth?.scope || ''), env });
	const spin = interactive ? p.spinner() : null;
	spin?.start(`Calling tools/list on ${servers.length} server${servers.length === 1 ? '' : 's'}`);
	const results = await verifyServers({ servers, env, origin });
	spin?.stop('Verified with live tool calls');
	const liveTools = Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.server.slug, r.tools]));

	// 6. Write.
	const apiKey = mode === 'apikey' ? readStore(env).auth.key : null;
	const writes = applyToClients({ clients, servers, packages, mode, apiKey, stdioKey, liveTools, forceProxy: Boolean(flags.proxy), project: Boolean(flags.project), origin, env });
	const selections = readStore(env).tools || {};
	const printed = printOnly
		? Object.fromEntries(servers.map((s) => [s.slug, buildEntry({ client: PRINT_CLIENT, server: s, mode, apiKey, selection: selections[s.slug], liveTools: liveTools[s.slug], forceProxy: Boolean(flags.proxy) })]))
		: null;

	if (ctx.flags.json) {
		printJson({
			account: { email: me.user.email || null, user_id: me.user.id },
			auth: mode,
			servers: results.map((r) => ({ slug: r.server.slug, url: r.server.url, ok: r.ok, tools: r.ok ? r.total : null, enabled: r.ok ? r.enabled : null, error: r.error || null })),
			clients: writes.map((w) => ({ id: w.client.id, file: w.file, servers: w.servers, error: w.error })),
			...(printed ? { print: { mcpServers: printed } } : {}),
		});
		return results.every((r) => r.ok) && writes.every((w) => !w.error) ? 0 : 1;
	}

	line('');
	line(c.bold('Servers'));
	for (const r of results) {
		if (r.ok) {
			const hidden = r.hidden ? c.dim(` (${r.hidden} off; \`three-ws tools\` to change)`) : '';
			line(`  ${c.green(sym.ok)} ${r.server.slug.padEnd(22)} ${c.bold(String(r.enabled))} tools${hidden}`);
		} else {
			line(`  ${c.red(sym.fail)} ${r.server.slug.padEnd(22)} ${r.error}`);
		}
	}
	if (writes.length) {
		line('');
		line(c.bold('Clients'));
		for (const w of writes) {
			if (w.error) line(`  ${c.red(sym.fail)} ${w.client.label.padEnd(15)} ${w.error}`);
			else {
				const viaProxy = servers.some((s) => usesProxy({ client: w.client, server: s, mode, forceProxy: flags.proxy })) ? c.dim(' (OAuth via the three-ws proxy)') : '';
				line(`  ${c.green(sym.ok)} ${w.client.label.padEnd(15)} ${tildify(w.file)} ${c.dim(`${w.servers.length} servers`)}${viaProxy}`);
			}
		}
	}
	if (printed) {
		line('');
		line(c.bold('Add this to any MCP client:'));
		printJson({ mcpServers: printed });
	}
	line('');
	const failed = results.filter((r) => !r.ok).length + writes.filter((w) => w.error).length;
	if (interactive) {
		if (failed) p.outro(c.yellow(`${failed} step${failed === 1 ? '' : 's'} failed above. Fix it and run \`three-ws setup\` again; finished steps are kept.`));
		else p.outro(`Done. Restart your client${writes.length === 1 ? '' : 's'} to load the tools. ${c.dim('Check anytime: three-ws status')}`);
	} else {
		line(failed ? c.yellow(`${failed} step(s) failed.`) : `Done. Restart your clients to load the tools. Check anytime: three-ws status`);
	}
	return failed ? 1 : 0;
}
