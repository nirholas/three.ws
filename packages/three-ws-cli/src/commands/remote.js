// The remote half of `three-ws setup`: clients configured in a vendor's cloud
// (Grok Bot). Nothing is written to disk. We pick the server, optionally mint a
// connector key, verify the public URL with a real tools/list, copy the URL, and
// print the fields to paste.

import * as p from '@clack/prompts';
import { answer, canPrompt, signIn, authModeFromFlags } from './common.js';
import { c, line, sym, rows, printJson } from '../ui.js';
import { ensureConnectorKey, currentIdentity } from '../auth.js';
import { listTools } from '../mcp-http.js';
import { copyText } from '../clipboard.js';
import { getRemoteClient, isLocalHost } from '../clients/remote.js';

/** True when every id names a remote client; used to skip the account step. */
export function allRemote(ids) {
	return ids.length > 0 && ids.every((id) => getRemoteClient(id));
}

async function mintKey(ctx) {
	const { origin, env } = ctx;
	const needsSignIn = async () => {
		let me = null;
		try { me = await currentIdentity({ origin, env }); } catch { me = null; }
		return !me;
	};
	if (await needsSignIn()) await signIn(ctx, { mode: authModeFromFlags(ctx.flags), extraScopes: ['agents:write'] });
	try {
		return await ensureConnectorKey({ origin, env });
	} catch (err) {
		if (err.status !== 403) throw err;
		// The stored sign-in predates the agents:write grant a connector key needs.
		const asked = authModeFromFlags(ctx.flags);
		await signIn(ctx, { mode: asked === 'key' ? 'oauth' : asked, extraScopes: ['agents:write'] });
		return ensureConnectorKey({ origin, env });
	}
}

/** Connect one remote client. Never throws for a failed verification; the result carries it. */
export async function connectRemote(ctx, client, { keyed }) {
	const { origin } = ctx;
	const url = `${origin}${client.serverPath}`;
	const connector = keyed ? await mintKey(ctx) : null;
	const reachable = !isLocalHost(new URL(origin).hostname);
	let verify;
	try {
		const { tools } = await listTools(url, { bearer: connector?.key || null });
		verify = { ok: true, tools: tools.length };
	} catch (err) {
		verify = { ok: false, error: err.message };
	}
	const copied = !ctx.flags.json && process.stdout.isTTY && !ctx.flags['no-copy'] ? copyText(url) : null;
	return { client, url, keyed: Boolean(connector), key: connector?.key || null, keyMinted: Boolean(connector?.minted), reachable, verify, copied };
}

export function remoteJson(results) {
	return results.map((r) => ({
		id: r.client.id,
		url: r.url,
		fields: Object.fromEntries(r.client.fields({ url: r.url, keyed: r.keyed })),
		chat_prompt: r.client.chatPrompt({ url: r.url }),
		api_key: r.key,
		reachable_from_cloud: r.reachable,
		verified: r.verify.ok,
		tools: r.verify.ok ? r.verify.tools : null,
		error: r.verify.ok ? null : r.verify.error,
		copied: Boolean(r.copied),
	}));
}

export function renderRemote(results) {
	for (const r of results) {
		line('');
		line(c.bold(`${r.client.label} (cloud connector, nothing to write locally)`));
		rows(r.client.fields({ url: r.url, keyed: r.keyed }), '  ');
		if (r.key) {
			line('');
			line(`  ${c.bold('API key')}  ${r.key}`);
			line(`  ${c.dim('Paste it as a Bot secret. It reads, generates and edits agents and can never spend.')}`);
			line(`  ${c.dim(r.keyMinted ? 'Revoke it anytime at https://three.ws/dashboard/api.' : 'Reused from the last run; revoke it anytime at https://three.ws/dashboard/api.')}`);
		}
		line('');
		line(`  ${c.dim('Or send this in a Grok Bot chat:')}`);
		line(`  ${r.client.chatPrompt({ url: r.url })}`);
		line('');
		if (r.verify.ok) line(`  ${c.green(sym.ok)} ${r.url} answered tools/list with ${c.bold(String(r.verify.tools))} tools (${r.keyed ? 'with the connector key' : 'no sign-in'})`);
		else line(`  ${c.red(sym.fail)} ${r.url} did not answer tools/list: ${r.verify.error}`);
		if (!r.reachable) line(`  ${c.yellow(sym.warn)} ${new URL(r.url).host} is only reachable from this machine. Grok Bot connects from xAI's cloud, so use the public https://three.ws URL there.`);
		if (r.copied) line(`  ${c.green(sym.ok)} Server URL copied to the clipboard (${r.copied})`);
		line(`  ${c.dim(`Docs: ${r.client.docs}`)}`);
	}
}

/** `setup --clients grok-bot`: no account, no local files. */
export async function setupRemoteOnly(ctx, ids) {
	const interactive = canPrompt(ctx);
	const clients = ids.map(getRemoteClient);
	let keyed = Boolean(ctx.flags['connector-key']);
	if (interactive) {
		p.intro(`${c.bold('three.ws')} setup ${c.dim(`· ${clients.map((x) => x.label).join(', ')}`)}`);
		if (!keyed) keyed = answer(await p.confirm({ message: 'Give it a connector key so it can use your three.ws agents? (the free 3D studio needs no key)', initialValue: false }));
	}
	const results = [];
	for (const client of clients) results.push(await connectRemote(ctx, client, { keyed }));
	if (ctx.flags.json) printJson({ remote: remoteJson(results) });
	else {
		renderRemote(results);
		line('');
	}
	const failed = results.filter((r) => !r.verify.ok).length;
	if (interactive) p.outro(failed ? c.yellow('Verification failed above. Fix it and run again.') : 'Done. Paste the fields into the client.');
	return failed ? 1 : 0;
}
