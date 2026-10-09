// The remote half of `three-ws setup`: clients such as Grok Bot whose
// connectors live in their own cloud. Nothing is written on this machine.
// For each one: pick the server and auth mode, get the credential that mode
// needs, print the connector form's exact fields, copy the URL, and run the
// live check against the public URL (../remote.js).

import * as p from '@clack/prompts';
import { answer, canPrompt, signIn } from './common.js';
import { c, line, sym, rows } from '../ui.js';
import { currentIdentity } from '../auth.js';
import { copyToClipboard } from '../clipboard.js';
import {
	directoryEntry,
	recommendedServer,
	modesFor,
	defaultMode,
	parseMode,
	installUrl,
	connectorKey,
	checkConnectorKey,
	connectorUrl,
	connectorFields,
	sayLine,
	verifyConnector,
} from '../remote.js';

const MODE_OPTIONS = {
	none: { label: 'None, free', hint: 'the free 3D tools; the quota lasts one connection' },
	install: { label: 'None, with a free install token', hint: 'its own quota that survives reconnects, for scheduled tasks' },
	key: { label: 'Connector API key', hint: 'adds your agents, memory and skills; can never spend' },
	oauth: { label: 'OAuth 2.1', hint: 'sign in from the client once; revoke any time' },
};

const STEPS = (client, { say }) => [
	`In ${client.label}, open Connectors and add a custom MCP server with the fields above${say ? ', or send it the sentence above and confirm what it shows' : ''}.`,
	'Check the name and URL it shows, then confirm.',
	'Ask for 3D in any task, or attach the server with @ and its name.',
];

async function chooseServer(ctx, client, { directory, servers, picked }) {
	if (picked?.length) return picked;
	const recommended = recommendedServer(client, directory, servers);
	if (!canPrompt(ctx) || !recommended) return recommended ? [recommended] : [];
	const slug = answer(await p.select({
		message: `Which server should ${client.label} connect to?`,
		options: servers.map((s) => ({ value: s.slug, label: `${s.name} ${c.dim(s.path)}`, hint: s === recommended ? 'recommended' : s.keyless ? 'free tools need no account' : 'needs a key or sign-in' })),
		initialValue: recommended.slug,
	}));
	return servers.filter((s) => s.slug === slug);
}

async function chooseMode(ctx, client, { directory, server }) {
	if (ctx.flags.auth) return parseMode(ctx.flags.auth);
	if (ctx.flags['connector-key']) return 'key';
	const supported = modesFor(server);
	const initial = defaultMode(client, directory, server);
	if (!canPrompt(ctx)) return initial;
	return answer(await p.select({
		message: `How should ${client.label} authenticate to ${server.slug}?`,
		options: supported.map((m) => ({ value: m, ...MODE_OPTIONS[m] })),
		initialValue: initial,
	}));
}

/** The connector key for key mode: the one passed in, else a minted (or reused) connector-preset key. */
async function keyFor(ctx, client) {
	const { origin, env } = ctx;
	const passed = ctx.flags['connector-key'];
	if (passed) return checkConnectorKey({ origin, key: String(passed).trim() });
	let me = null;
	try { me = await currentIdentity({ origin, env }); } catch { me = null; }
	if (!me && canPrompt(ctx)) {
		p.log.info('A connector key belongs to your account, so sign in once to mint it.');
		await signIn(ctx, {});
	}
	return connectorKey({ origin, label: client.label, env });
}

/** One connector: credential, fields, live check. Never throws; failures land in `error` and `checks`. */
async function connectOne(ctx, client, { directory, server, mode }) {
	const base = { client, server, mode, url: null, fields: [], say: null, key: null, checks: [], error: null };
	try {
		if (!modesFor(server).includes(mode)) {
			throw new Error(`${server.slug} does not take --auth ${mode}; it supports ${modesFor(server).join(', ')}`);
		}
		let install = null;
		let key = null;
		if (mode === 'install') install = (await installUrl({ client, directory, server, origin: ctx.origin, env: ctx.env })).url;
		if (mode === 'key') key = await keyFor(ctx, client);
		const url = connectorUrl(server, mode, { install });
		const checks = await verifyConnector({ url, mode, key: key?.key });
		return {
			...base,
			url,
			key: key ? { value: key.key, scope: key.scope, connector: key.connector, reused: key.reused } : null,
			fields: connectorFields({ client, server, mode, url, key: key?.key }),
			say: sayLine({ server, mode, url }),
			checks,
		};
	} catch (err) {
		return { ...base, error: err.message };
	}
}

export const remoteOk = (r) => !r.error && r.checks.length > 0 && r.checks.every((x) => x.ok);

/**
 * Connect every remote client. `picked` is the server list `--servers` chose,
 * or null for the client's recommendation.
 */
export async function connectRemote(ctx, { clients, directory, servers, picked = null }) {
	const results = [];
	for (const client of clients) {
		const chosen = await chooseServer(ctx, client, { directory, servers, picked });
		if (!chosen.length) {
			results.push({ client, server: null, mode: null, url: null, fields: [], say: null, key: null, checks: [], error: `${ctx.origin} lists no MCP server ${client.label} can connect to` });
			continue;
		}
		for (const server of chosen) {
			const mode = await chooseMode(ctx, client, { directory, server });
			const spin = canPrompt(ctx) ? p.spinner() : null;
			spin?.start(`Checking ${server.slug} from outside, the way ${client.label} will call it`);
			const result = await connectOne(ctx, client, { directory, server, mode });
			spin?.stop(remoteOk(result) ? 'Live check passed' : 'Live check finished with problems');
			const entry = directoryEntry(client, directory);
			result.steps = STEPS(client, result);
			result.note = entry?.notes || null;
			results.push(result);
		}
	}
	// One clipboard: copy the URL when there is exactly one to paste.
	const pasteable = results.filter((r) => r.url && !r.error);
	if (!ctx.flags.json && pasteable.length === 1) pasteable[0].copied = copyToClipboard(pasteable[0].url, { env: ctx.env.vars });
	return results;
}

export function remoteJson(results) {
	return results.map((r) => ({
		id: r.client.id,
		server: r.server?.slug || null,
		auth: r.mode,
		url: r.url,
		fields: Object.fromEntries(r.fields),
		say: r.say,
		key: r.key ? { scope: r.key.scope, connector: r.key.connector, reused: r.key.reused } : null,
		checks: r.checks.map(({ id, label, ok, detail }) => ({ id, label, ok, detail })),
		ok: remoteOk(r),
		error: r.error,
	}));
}

export function printRemote(results, { origin }) {
	for (const r of results) {
		line('');
		line(`${c.bold(r.client.label)} ${c.dim(`${r.server ? r.server.slug : ''} · add it in ${r.client.where}; nothing is written on this machine`)}`);
		if (r.error) {
			line(`  ${c.red(sym.fail)} ${r.error}`);
			continue;
		}
		rows(r.fields.map(([k, v]) => [k, k === 'Value' ? `${c.bold(v)} ${c.dim('(store it as a Bot secret)')}` : c.bold(v)]), '  ');
		if (r.say) line(`  ${c.dim('Or tell it:')} "${r.say}"`);
		if (r.copied) line(`  ${c.green(sym.ok)} Server URL copied to the clipboard`);
		if (r.note) line(`  ${c.dim(r.note)}`);
		line('');
		line(`  ${c.bold('Live check')} ${c.dim(r.url.split('?')[0])}`);
		const width = Math.max(...r.checks.map((x) => x.label.length));
		for (const x of r.checks) line(`  ${x.ok ? c.green(sym.ok) : c.red(sym.fail)} ${x.label.padEnd(width)}  ${c.dim(x.detail)}`);
		line('');
		line(`  ${c.bold('Next')}`);
		r.steps.forEach((s, i) => line(`  ${i + 1}. ${s}`));
		line(`  ${c.dim(`Docs: ${origin}${r.client.docs}`)}`);
	}
}
