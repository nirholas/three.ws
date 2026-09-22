// fund, provider, usage, ask: an agent's wallet pays for the model calls.
//
//   three-ws fund --amount 5 --agent <id>   top up credits from the agent wallet;
//                                           the first fund also mints an inference
//                                           key bound to that agent
//   three-ws provider use three-ws          point this machine's clients at three.ws
//   three-ws provider show                  the active provider
//   three-ws usage [--agent <id>]           credits, burn rate, days left, top-ups
//   three-ws ask "<prompt>"                 one completion through the active provider
//
// Moving money is two calls on the server: a preview, then an execute that
// needs confirm_deposit and that preview's id. `fund` prints the preview as a
// table (recipient, amount, token, chain, credits) and waits for an explicit
// yes. --yes answers yes for scripts after the table is printed; without a TTY
// and without --yes it refuses, so nothing ever moves unseen.

import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import { answer, canPrompt } from './common.js';
import { c, line, rows, sym, printJson, tildify } from '../ui.js';
import { requestJson, ApiError } from '../http.js';
import { bearerFor } from '../oauth.js';
import { readStore, updateStore } from '../store.js';
import {
	readProvider,
	writeProvider,
	threeWsProvider,
	writeHermesModel,
	hermesConfigPath,
	providerPath,
	complete,
	THREE_WS_PROVIDER,
} from '../provider.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_POLL_MS = 5_000;
const PENDING_POLL_MAX = 12;

async function authed(ctx) {
	const bearer = await bearerFor(ctx.env, { origin: ctx.origin });
	if (!bearer) throw new ApiError('sign in first: `npx three-ws login --financial` (funding needs the wallet:write scope)');
	return bearer;
}

function api(ctx, bearer, pathname, opts = {}) {
	return requestJson(`${ctx.origin}${pathname}`, {
		timeoutMs: 90_000,
		...opts,
		headers: { authorization: `Bearer ${bearer}`, ...(opts.headers || {}) },
	});
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/** The confirmation table every fund-moving path shows before the yes. */
export function previewRows(preview) {
	return [
		['Agent', `${preview.agent?.name || ''} ${c.dim(preview.agent?.id || '')}`.trim()],
		['From', `${preview.from} ${c.dim('(agent wallet)')}`],
		['To', `${preview.to} ${c.dim(`(${preview.to_label})`)}`],
		['Amount', `${preview.amount_usdc} ${preview.token}`],
		['Chain', `Solana ${preview.network}`],
		['Credits', `+$${Number(preview.credits_usd).toFixed(2)} at ${preview.rate} credit per USDC, no fee`],
		['Network fee', preview.network_fee],
		['After', `$${Number(preview.balance_after_usd).toFixed(2)} credits, ${preview.wallet_usdc_after} USDC left in the wallet`],
		['Expires', new Date(preview.expires_at).toLocaleTimeString()],
	];
}

async function confirmMove(ctx, preview) {
	if (!ctx.flags.json) {
		line(c.bold('Review this on-chain transfer:'));
		rows(previewRows(preview), '  ');
		line();
	}
	if (ctx.flags.yes) return true;
	if (!canPrompt(ctx)) {
		throw new ApiError('refusing to move funds without a confirmation. Review the preview above and rerun with --yes to approve it.');
	}
	return answer(await p.confirm({ message: `Move ${preview.amount_usdc} USDC from the agent wallet now?`, initialValue: false }));
}

/** Execute a preview, then follow a pending settlement until it resolves. */
async function executeAndSettle(ctx, bearer, pathname, body) {
	let result = await api(ctx, bearer, pathname, { method: 'POST', json: body });
	for (let i = 0; result?.status === 'pending' && i < PENDING_POLL_MAX; i++) {
		if (!ctx.flags.json) line(c.dim(`  Broadcast ${result.signature || ''}; waiting for Solana to confirm…`));
		await sleep(PENDING_POLL_MS);
		result = await api(ctx, bearer, pathname, { method: 'POST', json: body });
	}
	return result;
}

export async function fund(ctx) {
	const amount = Number(ctx.flags.amount);
	const agentId = String(ctx.flags.agent || '');
	if (!(amount > 0)) throw new ApiError('usage: three-ws fund --amount <usdc> --agent <agent-id>');
	if (!UUID_RE.test(agentId)) throw new ApiError('--agent must be one of your agent ids (see https://three.ws/my-agents)');

	const bearer = await authed(ctx);
	const store = readStore(ctx.env);
	const existing = store.inference?.key && store.inference.agent_id === agentId ? store.inference : null;

	// A key for this agent already exists: a plain credit top-up. Otherwise the
	// provision flow tops up AND mints the key in one confirmed move.
	const previewPath = existing ? `/api/agents/${agentId}/credits/topup/preview` : '/api/me/inference/provision/preview';
	const executePath = existing ? `/api/agents/${agentId}/credits/topup` : '/api/me/inference/provision';
	const preview = await api(ctx, bearer, previewPath, {
		method: 'POST',
		json: existing ? { amount_usdc: amount } : { agent_id: agentId, amount_usdc: amount },
	});

	const yes = await confirmMove(ctx, preview);
	if (!yes) {
		if (ctx.flags.json) printJson({ confirmed: false, preview });
		else line('Nothing moved.');
		return 1;
	}

	const result = await executeAndSettle(ctx, bearer, executePath, {
		preview_id: preview.preview_id,
		confirm_deposit: true,
		...(existing ? {} : { name: typeof ctx.flags.name === 'string' ? ctx.flags.name : undefined }),
	});

	if (result.status === 'pending') {
		if (ctx.flags.json) printJson(result);
		else line(`${c.yellow(sym.warn)} Still confirming (${result.signature}). Run \`three-ws usage\` in a minute; the credits land as soon as Solana confirms.`);
		return 3;
	}

	if (result.key?.token) {
		updateStore((s) => {
			s.inference = {
				key: result.key.token,
				prefix: result.key.prefix,
				key_id: result.key.id,
				agent_id: agentId,
				base_url: result.key.base_url,
				created_at: new Date().toISOString(),
			};
			return s;
		}, ctx.env);
	}

	if (ctx.flags.json) {
		printJson({ ...result, key: result.key ? { ...result.key, token: result.key.token ? `${result.key.prefix}…` : null } : undefined });
		return 0;
	}
	line(`${c.green(sym.ok)} Added $${Number(result.credits_usd).toFixed(2)} of credits from ${result.amount_usdc} USDC.`);
	if (result.signature) line(c.dim(`  ${result.explorer_url}`));
	if (result.key?.token) {
		line(`${c.green(sym.ok)} Minted inference key ${result.key.prefix}… bound to this agent, stored in your credentials.`);
		line(c.dim('  Next: `three-ws provider use three-ws` to point your clients at it.'));
	} else if (result.key && !result.key.token) {
		line(c.yellow(result.note || 'This top-up already minted its key earlier.'));
	}
	return 0;
}

export async function provider(ctx) {
	const [sub, name] = ctx.positionals;
	if (sub === 'show' || !sub) return showProvider(ctx);
	if (sub !== 'use') throw new ApiError('usage: three-ws provider use three-ws | three-ws provider show');
	if (name !== THREE_WS_PROVIDER.id) {
		throw new ApiError(`unknown provider "${name || ''}". Supported: ${THREE_WS_PROVIDER.id}.`);
	}

	const store = readStore(ctx.env);
	const key = typeof ctx.flags.key === 'string' && ctx.flags.key ? ctx.flags.key : store.inference?.key;
	if (!key) {
		throw new ApiError('no inference key yet. Fund one from an agent wallet: `three-ws fund --amount 5 --agent <id>` (or pass --key sk_live_... with the inference scope).');
	}
	const record = threeWsProvider({ origin: ctx.origin, key, agentId: store.inference?.agent_id || null });
	const written = [writeProvider(record, ctx.env)];

	const wanted = String(ctx.flags.clients || '').split(',').map((s) => s.trim()).filter(Boolean);
	// A Hermes-style agent on this machine gets its model block pointed at
	// three.ws too; --clients hermes forces it, --clients with anything else skips it.
	const hermesPresent = existsSync(hermesConfigPath(ctx.env));
	if (wanted.includes('hermes') || (hermesPresent && !wanted.length)) written.push(writeHermesModel(record, ctx.env));

	if (ctx.flags.json) {
		printJson({ provider: record.provider, base_url: record.base_url, model: record.model, key: `${key.slice(0, 12)}…`, written });
		return 0;
	}
	line(`${c.green(sym.ok)} Model provider is now ${c.bold('three.ws')} (${record.model}), billed to your credits.`);
	for (const f of written) line(c.dim(`  wrote ${tildify(f)}`));
	line(c.dim('  `three-ws ask` and anything reading provider.json switch on the next call. For any other OpenAI client:'));
	line(`  export OPENAI_BASE_URL=${record.base_url}`);
	line(`  export OPENAI_API_KEY=${key.slice(0, 12)}…  ${c.dim('(the full key is in the file above)')}`);
	return 0;
}

function showProvider(ctx) {
	const prov = readProvider(ctx.env);
	if (ctx.flags.json) {
		printJson(prov ? { ...prov, api_key: `${prov.api_key.slice(0, 12)}…`, file: providerPath(ctx.env) } : { provider: null });
		return prov ? 0 : 1;
	}
	if (!prov) {
		line('No model provider configured. Run `three-ws provider use three-ws`.');
		return 1;
	}
	rows([
		['Provider', prov.provider],
		['Base URL', prov.base_url],
		['Model', prov.model],
		['Key', `${prov.api_key.slice(0, 12)}…`],
		['Agent', prov.agent_id || c.dim('none (account budget only)')],
		['File', tildify(providerPath(ctx.env))],
	]);
	return 0;
}

export async function usage(ctx) {
	const store = readStore(ctx.env);
	const bearer = (await bearerFor(ctx.env, { origin: ctx.origin })) || store.inference?.key;
	if (!bearer) throw new ApiError('sign in first: `npx three-ws login`');
	const agent = ctx.flags.agent ? `?agent_id=${encodeURIComponent(ctx.flags.agent)}` : '';
	const u = await api(ctx, bearer, `/api/me/usage${agent}`);
	if (ctx.flags.json) {
		printJson(u);
		return 0;
	}
	const pairs = [
		['Credits', `$${u.balance_usd.toFixed(4)}`],
		['Burn rate', `$${u.burn_rate_usd_per_day.toFixed(4)} a day (7-day average)`],
		['Days left', u.days_remaining != null ? String(u.days_remaining) : c.dim('no recent usage')],
		['This month', `${u.inference_month.calls} calls, ${u.inference_month.input_tokens + u.inference_month.output_tokens} tokens, $${u.inference_month.spent_usd.toFixed(4)}`],
	];
	if (u.agent) {
		const b = u.agent.budget;
		pairs.push(['Agent', `${u.agent.name || u.agent.id}`]);
		pairs.push(['Budget', b ? `${b.daily_usd != null ? `$${b.daily_usd}/day` : 'no daily cap'}, ${b.monthly_usd != null ? `$${b.monthly_usd}/month` : 'no monthly cap'}` : c.dim('none')]);
		pairs.push(['Spent', `$${u.agent.spend.today_usd.toFixed(4)} today, $${u.agent.spend.month_usd.toFixed(4)} this month`]);
		if (u.agent.exhausted) pairs.push(['Status', c.red(`${u.agent.exhausted.window} budget used, resets ${new Date(u.agent.exhausted.resets_at).toLocaleString()}`)]);
	}
	rows(pairs);
	if (u.topups.length) {
		line();
		line(c.bold('Recent top-ups'));
		for (const t of u.topups.slice(0, 5)) {
			line(`  ${t.status.padEnd(8)} ${String(t.amount_usdc).padStart(8)} USDC  ${t.signature ? c.dim(t.explorer_url) : ''}`);
		}
	}
	return 0;
}

export async function ask(ctx) {
	const prompt = ctx.positionals.join(' ').trim();
	if (!prompt) throw new ApiError('usage: three-ws ask "<prompt>"');
	const out = await complete({
		messages: [{ role: 'user', content: prompt }],
		env: ctx.env,
		onDelta: ctx.flags.json ? undefined : (d) => process.stdout.write(d),
	});
	if (ctx.flags.json) {
		printJson(out);
		return 0;
	}
	if (!out.content) line(c.yellow('(the model finished without any text; nothing to show)'));
	else process.stdout.write('\n');
	if (out.billing) {
		line(c.dim(`  ${out.usage?.total_tokens ?? '?'} tokens, charged $${Number(out.billing.charged_usd).toFixed(6)}, $${Number(out.billing.balance_usd).toFixed(4)} credits left`));
	}
	return 0;
}
