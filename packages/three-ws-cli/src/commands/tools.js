// `three-ws tools`: choose which tools each server exposes on this machine.
//
// The choice is stored in the credential store (tools[slug]) and applied in
// three places:
//   - the three-ws proxy filters tools/list and refuses a disabled tools/call;
//   - clients with a native allow list (Gemini CLI includeTools) get it written;
//   - direct HTTP entries carry it in the X-Three-Tools header.

import * as p from '@clack/prompts';
import { answer, canPrompt } from './common.js';
import { c, line, sym, printJson } from '../ui.js';
import { readStore, updateStore } from '../store.js';
import { loadDirectory, hostedServers } from '../servers.js';
import { verifyServers } from '../configure.js';
import { TIERS, TIER_LABELS, groupByTier, normalizeSelection, filterTools, isEnabled, tierOf, defaultSelection } from '../policy.js';
import { writeServer } from '../clients/index.js';
import { buildEntry } from '../entries.js';
import { scanClients } from './account.js';

function list(v) {
	return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function toolByName(tools, name) {
	return tools.find((t) => t.name === name);
}

/** Apply --enable/--disable/--reset to a selection, given the live tools. */
export function applyFlags(selection, tools, { enable = [], disable = [], reset = false } = {}) {
	const sel = reset ? defaultSelection() : normalizeSelection(selection);
	const check = (item) => {
		if (TIERS.includes(item) || toolByName(tools, item)) return;
		throw new Error(`"${item}" is neither a tier (${TIERS.join(', ')}) nor a tool on this server`);
	};
	for (const item of enable) {
		check(item);
		if (TIERS.includes(item)) {
			if (!sel.tiers.includes(item)) sel.tiers.push(item);
			continue;
		}
		sel.deny = sel.deny.filter((n) => n !== item);
		if (!sel.tiers.includes(tierOf(toolByName(tools, item)))) sel.allow.push(item);
	}
	for (const item of disable) {
		check(item);
		if (TIERS.includes(item)) {
			sel.tiers = sel.tiers.filter((t) => t !== item);
			continue;
		}
		sel.allow = sel.allow.filter((n) => n !== item);
		if (sel.tiers.includes(tierOf(toolByName(tools, item)))) sel.deny.push(item);
	}
	return { tiers: sel.tiers, allow: [...new Set(sel.allow)], deny: [...new Set(sel.deny)] };
}

/** A selection from an explicit set of enabled names: whole tiers plus the fewest exceptions. */
export function selectionFromChoice(tools, tiers, enabledNames) {
	const on = new Set(enabledNames);
	const allow = [];
	const deny = [];
	for (const t of tools) {
		const inTier = tiers.includes(tierOf(t));
		if (on.has(t.name) && !inTier) allow.push(t.name);
		if (!on.has(t.name) && inTier) deny.push(t.name);
	}
	return { tiers: [...tiers], allow, deny };
}

/** Re-render direct HTTP entries so their header / allow list matches the new selection. */
function rewriteDirectEntries(ctx, server, tools) {
	const store = readStore(ctx.env);
	const mode = store.auth?.type === 'apikey' ? 'apikey' : 'oauth';
	const updated = [];
	for (const x of scanClients(ctx.env, ctx.origin)) {
		for (const e of x.entries) {
			if (e.name !== server.slug) continue;
			if (Array.isArray(e.entry.args) && e.entry.args.includes('proxy')) continue;
			if (server.auth === 'required' && mode !== 'apikey') continue;
			const entry = buildEntry({ client: x.client, server, mode, apiKey: mode === 'apikey' ? store.auth.key : null, selection: store.tools[server.slug], liveTools: tools });
			writeServer(x.client, server.slug, entry, ctx.env, { project: e.project });
			updated.push(x.client.label);
		}
	}
	return updated;
}

function tierCounts(tools, selection) {
	const by = groupByTier(tools);
	return TIERS.map((t) => `${t} ${by[t].filter((x) => isEnabled(x, selection)).length}/${by[t].length}`).join(', ');
}

async function chooseServer(ctx, all) {
	const { flags } = ctx;
	if (flags.server) {
		const s = all.find((x) => x.slug === flags.server || x.path === flags.server);
		if (!s) throw new Error(`unknown server "${flags.server}". Known: ${all.map((x) => x.slug).join(', ')}`);
		return s;
	}
	if (!canPrompt(ctx)) throw new Error(`pass --server <slug>. Servers: ${all.map((s) => s.slug).join(', ')}`);
	const store = readStore(ctx.env);
	const configured = all.filter((s) => store.tools?.[s.slug]);
	const slug = answer(await p.select({
		message: 'Which server?',
		options: (configured.length ? configured : all).map((s) => ({ value: s.slug, label: s.name, hint: s.path })),
	}));
	return all.find((s) => s.slug === slug);
}

async function promptSelection(server, live, selection) {
	const byTier = groupByTier(live);
	const tiers = answer(await p.multiselect({
		message: `Tool groups for ${c.bold(server.name)}`,
		options: TIERS.map((t) => ({
			value: t,
			label: `${TIER_LABELS[t]} ${c.dim(`(${byTier[t].length})`)}`,
			hint: t === 'financial' ? 'off by default; each call still asks for confirmation' : t === 'read' ? 'never changes anything' : 'can be undone',
		})),
		initialValues: selection.tiers,
		required: false,
	}));
	let next = { tiers, allow: selection.allow, deny: selection.deny };
	const fine = answer(await p.confirm({ message: 'Fine-tune individual tools?', initialValue: false }));
	if (fine) {
		const picked = answer(await p.multiselect({
			message: 'Enabled tools',
			options: live.map((t) => ({ value: t.name, label: t.name, hint: TIER_LABELS[tierOf(t)] })),
			initialValues: live.filter((t) => isEnabled(t, next)).map((t) => t.name),
			required: false,
		}));
		next = selectionFromChoice(live, tiers, picked);
	}
	return next;
}

export async function tools(ctx) {
	const { flags, origin, env } = ctx;
	const all = hostedServers(await loadDirectory(origin), origin);
	const server = await chooseServer(ctx, all);
	const [result] = await verifyServers({ servers: [server], env, origin });
	if (!result.ok) throw new Error(`could not list ${server.slug} tools: ${result.error}`);
	const live = result.tools;
	const current = normalizeSelection(readStore(env).tools?.[server.slug]);

	let selection;
	if (flags.enable || flags.disable || flags.reset) {
		selection = applyFlags(current, live, { enable: list(flags.enable), disable: list(flags.disable), reset: Boolean(flags.reset) });
	} else if (canPrompt(ctx)) {
		selection = await promptSelection(server, live, current);
	} else {
		if (flags.json) {
			printJson({ server: server.slug, selection: current, enabled: filterTools(live, current).length, total: live.length, tools: live.map((t) => ({ name: t.name, tier: tierOf(t), enabled: isEnabled(t, current) })) });
		} else {
			line(`${c.bold(server.name)} ${c.dim(server.path)}: ${filterTools(live, current).length}/${live.length} tools enabled (${tierCounts(live, current)})`);
			for (const t of live) line(`  ${isEnabled(t, current) ? c.green(sym.ok) : c.dim(sym.dot)} ${t.name.padEnd(32)} ${c.dim(tierOf(t))}`);
		}
		return 0;
	}

	updateStore((s) => {
		s.tools = { ...(s.tools || {}), [server.slug]: selection };
		return s;
	}, env);
	const updated = rewriteDirectEntries(ctx, server, live);
	const enabled = filterTools(live, selection);
	if (flags.json) {
		printJson({ server: server.slug, selection, enabled: enabled.map((t) => t.name), total: live.length, rewrote: updated });
		return 0;
	}
	line(`${c.green(sym.ok)} ${server.slug}: ${enabled.length}/${live.length} tools enabled (${tierCounts(live, selection)})`);
	if (updated.length) line(c.dim(`  Updated ${updated.join(', ')}.`));
	line(c.dim('  Restart your clients to pick up the change.'));
	return 0;
}
