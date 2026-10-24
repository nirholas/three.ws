// Read-side commands for scripts and other agents. Every one honors --json
// (one JSON document on stdout, diagnostics on stderr) and --non-interactive
// (never prompts; missing input is exit 2), and exits with the stable table in
// src/automation.js.
//
//   three-ws agents list | get <id|name>
//   three-ws runs list --agent <id|name> | get <run-id>
//   three-ws wallet balance [--agent <id|name>] [--network mainnet|devnet]
//   three-ws orders list --agent <id|name> [--network mainnet|devnet]
//   three-ws report run <run-id> --out <file.html> [--agent <id>]
//
// Backed by GET /api/agents, POST /api/agents/balances, GET
// /api/agent-run-replay, GET /api/agents/:id/orders and GET
// /api/agents/:id/decision-trail/verify. Nothing here signs or moves funds.

import fs from 'node:fs';
import path from 'node:path';
import { createSolanaRpc } from '@solana/kit';
import { c, line, printJson, rows, shortAddress } from '../ui.js';
import { bearerFor } from '../oauth.js';
import { requestJson, ApiError } from '../http.js';
import { CliError, EXIT_CODES, requireInput } from '../automation.js';
import { buildRunReport } from '../report/run-report.js';
import { rpcUrlFor } from '../pay/x402.js';
import { SOLANA_DEVNET, SOLANA_MAINNET, USDC_DEVNET, USDC_MAINNET } from '../pay/permissions.js';
import { keystoreFor } from './pay.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authed(ctx) {
	const key = ctx.env.vars.THREE_WS_API_KEY;
	const bearer = key || (await bearerFor(ctx.env, { origin: ctx.origin }));
	if (!bearer) throw new ApiError('not signed in. Run `three-ws login`, or set THREE_WS_API_KEY.', { code: 'login_required' });
	return { authorization: `Bearer ${bearer}` };
}

const get = (ctx, headers, p) => requestJson(`${ctx.origin}${p}`, { headers });

function networkOf(flags) {
	const n = String(flags.network || 'mainnet').toLowerCase();
	if (n === 'mainnet' || n === 'devnet') return n;
	throw new CliError(EXIT_CODES.USAGE, 'invalid_network', '--network must be mainnet or devnet.');
}

function out(ctx, json, render) {
	if (ctx.flags.json) printJson(json);
	else render();
	return EXIT_CODES.OK;
}

/** Resolve an id, id prefix or exact name to one of the caller's agents. */
export async function resolveAgent(ctx, headers, key) {
	requireInput(key, 'an agent', 'pass --agent <id|name>');
	const { agents = [] } = await get(ctx, headers, '/api/agents');
	const k = String(key).toLowerCase();
	const hit = agents.filter((a) => a.id === key || (key.length >= 8 && a.id.startsWith(key)) || String(a.name || '').toLowerCase() === k);
	if (!hit.length) throw new CliError(EXIT_CODES.USAGE, 'agent_not_found', `no agent "${key}" on this account. List yours with \`three-ws agents list\`.`);
	if (hit.length > 1) throw new CliError(EXIT_CODES.USAGE, 'agent_ambiguous', `"${key}" matches ${hit.length} agents (${hit.map((h) => h.id.slice(0, 8)).join(', ')}). Use an id.`);
	return hit[0];
}

const agentView = (ctx, a) => ({
	id: a.id,
	name: a.name,
	page: `${ctx.origin}/agents/${a.id}`,
	has_body: Boolean(a.avatar_id),
	wallet: a.solana_address || null,
	wallet_ready: a.walletReady ?? null,
	created_at: a.created_at ?? null,
});

export async function agents(ctx) {
	const [sub = 'list', key] = ctx.positionals;
	const headers = await authed(ctx);
	if (sub === 'list') {
		const { agents: list = [] } = await get(ctx, headers, '/api/agents');
		const view = list.map((a) => agentView(ctx, a));
		return out(ctx, { agents: view }, () => {
			if (!view.length) return line('No agents on this account yet. Create one: three-ws create "Nova"');
			for (const a of view) line(`${a.id}  ${c.bold(a.name || '(unnamed)')}  ${a.wallet ? shortAddress(a.wallet) : c.dim('no wallet')}`);
		});
	}
	if (sub === 'get') {
		const a = await resolveAgent(ctx, headers, key);
		const view = agentView(ctx, a);
		return out(ctx, { agent: view }, () => {
			line(`${c.bold(view.name || '(unnamed)')} ${c.dim(view.id)}`);
			rows([['Page', view.page], ['Body', view.has_body ? 'has a 3D avatar' : 'none yet'], ['Wallet', view.wallet || 'none']], '  ');
		});
	}
	throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws agents <list|get <id|name>>');
}

const runLine = (r) => `${r.id}  ${String(r.status).padEnd(16)} ${String(r.goal || '').replace(/\s+/g, ' ').slice(0, 70)}`;

async function fetchRun(ctx, headers, id) {
	if (!UUID_RE.test(id)) throw new CliError(EXIT_CODES.USAGE, 'invalid_run_id', 'a run id is a uuid. List yours with `three-ws runs list --agent <id>`.');
	const { data } = await get(ctx, headers, `/api/agent-run-replay?run=${encodeURIComponent(id)}`);
	return data;
}

export async function runs(ctx) {
	const [sub = 'list', id] = ctx.positionals;
	const headers = await authed(ctx);
	if (sub === 'list') {
		const agent = await resolveAgent(ctx, headers, ctx.flags.agent);
		const { data } = await get(ctx, headers, `/api/agent-run-replay?agent=${encodeURIComponent(agent.id)}`);
		return out(ctx, { agent: agent.id, runs: data.runs, has_more: data.hasMore }, () => {
			if (!data.runs.length) return line(`${agent.name || agent.id} has not worked a goal on its own yet.`);
			for (const r of data.runs) line(runLine(r));
		});
	}
	if (sub === 'get') {
		requireInput(id, 'a run id', 'usage: three-ws runs get <run-id>');
		const data = await fetchRun(ctx, headers, id);
		return out(ctx, data, () => {
			line(`${c.bold(data.run.goal)}`);
			rows([
				['Run', data.run.id],
				['Status', data.run.status],
				['Steps', String(data.steps.length)],
				['Tool calls', String(data.toolTraces.length)],
				['Receipt chain', data.receiptChain ? (data.receiptChain.verified ? `verified (${data.receiptChain.checked})` : `broken at ${data.receiptChain.brokenAt}`) : 'not recomputed'],
			], '  ');
		});
	}
	throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws runs <list --agent <id|name>|get <run-id>>');
}

const num = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '?');

/** Balance of the local pay wallet, read straight from Solana RPC. */
async function localBalance(ctx, network) {
	const { address } = keystoreFor(ctx).address();
	const caip = network === 'devnet' ? SOLANA_DEVNET : SOLANA_MAINNET;
	const usdc = network === 'devnet' ? USDC_DEVNET : USDC_MAINNET;
	const rpc = createSolanaRpc(rpcUrlFor(caip, ctx.env));
	try {
		const [lamports, tokens] = await Promise.all([
			rpc.getBalance(address).send(),
			rpc.getTokenAccountsByOwner(address, { mint: usdc }, { encoding: 'jsonParsed' }).send(),
		]);
		const usdcAtomic = tokens.value.reduce((sum, t) => sum + BigInt(t.account.data.parsed.info.tokenAmount.amount), 0n);
		return { source: 'pay-wallet', network, address, sol: Number(lamports.value) / 1e9, usdc: Number(usdcAtomic) / 1e6 };
	} catch (err) {
		throw new ApiError(`could not read ${address} on ${network}: ${err.message}`, { status: 0 });
	}
}

export async function walletBalance(ctx) {
	const network = networkOf(ctx.flags);
	if (ctx.flags.agent !== undefined && ctx.flags.agent !== '') {
		const headers = await authed(ctx);
		const agent = await resolveAgent(ctx, headers, ctx.flags.agent);
		const { data = {} } = await requestJson(`${ctx.origin}/api/agents/balances`, { method: 'POST', headers, json: { ids: [agent.id] } });
		const b = data[agent.id] || {};
		const view = { source: 'agent-wallet', agent: agent.id, address: agent.solana_address || null, sol: b.sol ?? null, usdc: b.usdc ?? null, usd: b.usd ?? null };
		return out(ctx, view, () => rows([['Agent', agent.name || agent.id], ['Wallet', view.address || 'none'], ['SOL', num(view.sol, 4)], ['USDC', num(view.usdc)], ['USD', num(view.usd)]]));
	}
	const view = await localBalance(ctx, network);
	return out(ctx, view, () => rows([['Wallet', view.address], ['Network', network], ['SOL', num(view.sol, 4)], ['USDC', num(view.usdc)]]));
}

export async function orders(ctx) {
	const [sub = 'list'] = ctx.positionals;
	if (sub !== 'list') throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws orders list --agent <id|name> [--network mainnet|devnet]');
	const network = networkOf(ctx.flags);
	const headers = await authed(ctx);
	const agent = await resolveAgent(ctx, headers, ctx.flags.agent);
	const { data } = await get(ctx, headers, `/api/agents/${agent.id}/orders?network=${network}`);
	return out(ctx, { agent: agent.id, network, orders: data.orders, summary: data.summary }, () => {
		if (!data.orders.length) return line(`${agent.name || agent.id} has no ${network} orders. Place one at ${ctx.origin}/agents/${agent.id}.`);
		for (const o of data.orders) line(`${o.id}  ${String(o.status).padEnd(10)} ${String(o.type).padEnd(12)} ${o.side || ''} ${o.symbol ? `$${o.symbol}` : shortAddress(o.mint || '')}`);
	});
}

/** The decision trail is public; a failure to read it must not block the report. */
async function trailFor(ctx, agentId) {
	try {
		return await requestJson(`${ctx.origin}/api/agents/${agentId}/decision-trail/verify`);
	} catch (err) {
		process.stderr.write(`${c.yellow('!')} decision trail unavailable (${err.message}); the report will say so.\n`);
		return null;
	}
}

export async function report(ctx) {
	const [sub, id] = ctx.positionals;
	if (sub !== 'run') throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws report run <run-id> --out <file.html>');
	requireInput(id, 'a run id', 'usage: three-ws report run <run-id> --out <file.html>');
	const outFile = requireInput(typeof ctx.flags.out === 'string' ? ctx.flags.out : '', '--out <file.html>', 'the report is one file; say where to write it');
	const headers = await authed(ctx);
	const data = await fetchRun(ctx, headers, id);
	const trail = await trailFor(ctx, data.run.agentId);
	const html = buildRunReport({ run: data.run, steps: data.steps, toolTraces: data.toolTraces, receiptChain: data.receiptChain, trail, origin: ctx.origin });
	const target = path.resolve(ctx.env.cwd || process.cwd(), outFile);
	try {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, html);
	} catch (err) {
		throw new CliError(EXIT_CODES.ERROR, 'write_failed', `could not write ${target}: ${err.message}`);
	}
	const result = { run: data.run.id, file: target, bytes: Buffer.byteLength(html), steps: data.steps.length, tool_calls: data.toolTraces.length, decision_trail_head: trail?.chain?.head_hash ?? null };
	return out(ctx, result, () => line(`Wrote ${target} (${result.bytes} bytes, ${result.steps} steps).`));
}
