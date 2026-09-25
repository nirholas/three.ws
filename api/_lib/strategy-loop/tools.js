// The tools a strategy loop tick may call, in three tiers:
//
//   read       the read-only server registry (api/_lib/agent-tools.js), limited
//              to the tools the loop's settings name. Changes nothing.
//   write      remember (a memory the next tick reads back) and notify_owner
//              (a bell/push/telegram message through the owner's channel
//              preferences). Changes account state only.
//   financial  trade_preview and trade_execute on the agent's own wallet. Off
//              until the owner turns the tier on for this loop. An execute
//              needs `confirm_swap: true` plus the preview_id a preview issued
//              in the SAME tick within PREVIEW_TTL_MS, and it executes exactly
//              the previewed trade, never arguments the model restates.
//
// Every trade runs through executeAgentTrade (api/agents/agent-trade.js): the
// kill switch, per-trade cap, daily budget, price-impact breaker, rug and
// honeypot firewall, the frozen switch and the anomaly guard, and the custody
// ledger, identical to a trade the owner makes by hand. The loop adds its own
// daily USD cap and the real-funds agreement check on top, never instead.

import { randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { AGENT_TOOLS } from '../agent-tools.js';
import { insertNotification } from '../notify.js';
import { loopSpendToday, usdcCapVerdict } from './budget.js';

/** How long a trade preview stays usable (the MCP tool policy uses the same window). */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;
export const MAX_REMEMBERS_PER_TICK = 5;
export const MAX_NOTIFIES_PER_TICK = 2;
export const LOOP_MEMORY_TTL_DAYS = 14;
const LAMPORTS_PER_SOL = 1_000_000_000;
const MEMORY_TYPES = new Set(['project', 'reference']);

const WRITE_TOOLS = {
	remember: {
		description:
			'Save a short observation this loop should recall on later ticks (a price level, a token you are tracking, a balance, a verdict). Keep it factual and under 500 characters. Memories from the loop expire after 14 days.',
		parameters: {
			type: 'object',
			properties: {
				content: { type: 'string', description: 'The observation, with numbers and their source.' },
				kind: { type: 'string', enum: ['project', 'reference'], description: 'project: something being tracked; reference: a fact to look up later.' },
				importance: { type: 'number', description: '0..1, how much later ticks should weigh it (default 0.5).' },
			},
			required: ['content'],
		},
	},
	notify_owner: {
		description:
			'Send the agent owner a short notification (bell, push and telegram, per their preferences). Use only for something they would act on: a safety failure, a threshold crossed, a trade made. At most two per tick.',
		parameters: {
			type: 'object',
			properties: { message: { type: 'string', description: 'One or two sentences, at most 280 characters.' } },
			required: ['message'],
		},
	},
};

const FINANCIAL_TOOLS = {
	trade_preview: {
		description:
			'Preview a trade from the agent wallet: quote, price impact, and every guard verdict, simulated on chain without signing. Returns a preview_id valid for 10 minutes in this tick. A buy spends SOL; a sell returns SOL. One side is always SOL.',
		parameters: {
			type: 'object',
			properties: {
				side: { type: 'string', enum: ['buy', 'sell'] },
				mint: { type: 'string', description: 'Token mint address (base58).' },
				amount: { type: 'string', description: 'Buy: SOL to spend, e.g. "0.05". Sell: token amount, or "max".' },
				slippage_bps: { type: 'integer', description: 'Slippage tolerance in basis points (capped by the agent trade limits).' },
			},
			required: ['side', 'mint', 'amount'],
		},
	},
	trade_execute: {
		description:
			'Execute a trade you previewed in this tick. Pass the preview_id and confirm_swap: true; the previewed trade executes exactly as quoted, through every guard. Refused when the preview expired, the loop daily USD cap would be exceeded, or the wallet is frozen.',
		parameters: {
			type: 'object',
			properties: {
				preview_id: { type: 'string' },
				confirm_swap: { type: 'boolean', description: 'Must be true: you are attesting you intend this trade.' },
			},
			required: ['preview_id', 'confirm_swap'],
		},
	},
};

/** Tool names by tier, for the status read model and the docs. */
export function toolTiers(loop) {
	return {
		read: (loop.tools || []).filter((t) => AGENT_TOOLS[t]),
		write: Object.keys(WRITE_TOOLS),
		financial: loop.financialEnabled ? Object.keys(FINANCIAL_TOOLS) : [],
	};
}

function schema(name, t) {
	return { type: 'function', function: { name, description: t.description, parameters: t.parameters } };
}

function clampText(v, max) {
	return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Build the schemas and handlers one tick exposes to the model.
 *
 * @param {object} o
 * @param {object} o.agent   agent_identities row
 * @param {object} o.loop    serialized loop settings (serializeLoop)
 * @param {object} o.tick    agent_loop_ticks row
 * @param {object} [o.deps]  injectable trade engine (tests); defaults to the real one
 * @param {'simulate'|'live'} [o.tradeMode]  'simulate' runs every execute as a
 *        simulation that signs and broadcasts nothing (the worker default)
 */
export function buildTickTools({ agent, loop, tick, deps = {}, tradeMode = 'simulate' }) {
	const tiers = toolTiers(loop);
	const schemas = [];
	const handlers = {};
	const counts = { remember: 0, notify: 0 };

	for (const name of tiers.read) {
		schemas.push(schema(name, AGENT_TOOLS[name]));
		handlers[name] = AGENT_TOOLS[name].handler;
	}

	schemas.push(schema('remember', WRITE_TOOLS.remember));
	handlers.remember = async (args) => {
		const content = clampText(args?.content, 500);
		if (!content) throw new Error('content is required');
		if (counts.remember >= MAX_REMEMBERS_PER_TICK) throw new Error(`At most ${MAX_REMEMBERS_PER_TICK} memories per tick.`);
		counts.remember++;
		const type = MEMORY_TYPES.has(args?.kind) ? args.kind : 'project';
		const salience = Math.min(1, Math.max(0, Number.isFinite(Number(args?.importance)) ? Number(args.importance) : 0.5));
		const [row] = await sql`
			INSERT INTO agent_memories (agent_id, type, content, tags, context, salience, expires_at)
			VALUES (
				${agent.id}, ${type}, ${content}, ${['loop', 'strategy-loop']},
				${JSON.stringify({ source: 'strategy_loop', tick_id: tick.id })}::jsonb,
				${salience}, now() + make_interval(days => ${LOOP_MEMORY_TTL_DAYS})
			)
			RETURNING id
		`;
		return { saved: true, memory_id: row.id };
	};

	schemas.push(schema('notify_owner', WRITE_TOOLS.notify_owner));
	handlers.notify_owner = async (args) => {
		const message = clampText(args?.message, 280);
		if (!message) throw new Error('message is required');
		if (counts.notify >= MAX_NOTIFIES_PER_TICK) throw new Error(`At most ${MAX_NOTIFIES_PER_TICK} notifications per tick.`);
		counts.notify++;
		await insertNotification(agent.user_id, 'agent_loop_report', {
			agent_id: agent.id,
			agent_name: agent.name || null,
			tick_id: tick.id,
			message,
			link: `/agents/${agent.id}/profile#loop`,
		});
		return { sent: true };
	};

	if (tiers.financial.length) {
		const engine = deps.trade || defaultTradeEngine();
		schemas.push(schema('trade_preview', FINANCIAL_TOOLS.trade_preview));
		schemas.push(schema('trade_execute', FINANCIAL_TOOLS.trade_execute));
		handlers.trade_preview = (args) => tradePreview({ agent, loop, tick, args, engine });
		handlers.trade_execute = (args) => tradeExecute({ agent, loop, tick, args, engine, simulate: tradeMode !== 'live' });
	}

	return { schemas, handlers, tiers };
}

/** The real trade engine, loaded lazily so a read-only tick never imports the signer. */
function defaultTradeEngine() {
	let mod = null;
	const load = async () => {
		if (!mod) {
			const [trade, guards, agreement] = await Promise.all([
				import('../../agents/agent-trade.js'),
				import('../agent-trade-guards.js'),
				import('../real-funds-agreement.js'),
			]);
			mod = { trade, guards, agreement };
		}
		return mod;
	};
	return {
		async parse(body, meta) {
			const m = await load();
			return m.trade.parseTradeInput(body, m.guards.getTradeLimits(meta));
		},
		async execute(opts) {
			const m = await load();
			return m.trade.executeAgentTrade(opts);
		},
		async solToUsd(sol) {
			const m = await load();
			return m.guards.lamportsToUsd(BigInt(Math.round(sol * LAMPORTS_PER_SOL)));
		},
		async hasSignedAgreement(userId) {
			const m = await load();
			return Boolean(await m.agreement.currentSignatureFor(userId));
		},
	};
}

async function freshAgent(agentId) {
	const [row] = await sql`SELECT id, user_id, name, meta, status, deleted_at FROM agent_identities WHERE id = ${agentId}`;
	return row;
}

function sourceMeta(loop, tick) {
	return { strategy: 'loop', strategy_id: loop.strategyId || null, equip_id: tick.id };
}

async function tradePreview({ agent, loop, tick, args, engine }) {
	const live = await freshAgent(agent.id);
	if (!live || live.deleted_at) throw new Error('This agent no longer exists.');
	const body = {
		side: args?.side,
		mint: args?.mint,
		amount: args?.amount,
		slippageBps: args?.slippage_bps,
		network: 'mainnet',
		simulate: true,
	};
	let input;
	try {
		input = await engine.parse(body, live.meta || {});
	} catch (err) {
		return { ok: false, error: err?.message || 'invalid trade' };
	}
	input.simulate = true;
	const sim = await engine.execute({
		id: agent.id,
		userId: agent.user_id,
		meta: live.meta || {},
		input,
		source: 'strategy:loop',
		sourceMeta: sourceMeta(loop, tick),
	});
	if (!sim.ok) {
		return { ok: false, blocked: true, code: sim.code, error: sim.message, detail: sim.detail || null };
	}

	const usd = input.side === 'buy' ? Number(await engine.solToUsd(input.amount).catch(() => null)) || null : null;
	const spent = await loopSpendToday(agent.id);
	const capBlock = input.side === 'buy'
		? usd == null
			? { reason: 'usdc_cap', requestedUsd: null, remainingUsd: Math.max(0, loop.caps.dailyUsdcUsd - spent.usdcUsd) }
			: usdcCapVerdict(loop.caps, spent, usd)
		: null;

	const previewId = `pv_${randomBytes(9).toString('base64url')}`;
	const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
	const record = {
		side: input.side,
		mint: input.mint,
		amount: args?.amount === 'max' ? 'max' : String(input.amount),
		slippageBps: input.slippageBps,
		usd,
		expiresAt,
		used: false,
	};
	await sql`
		UPDATE agent_loop_ticks
		   SET previews = previews || ${JSON.stringify({ [previewId]: record })}::jsonb, updated_at = now()
		 WHERE id = ${tick.id}
	`;
	return {
		ok: true,
		preview_id: previewId,
		expires_at: expiresAt,
		side: input.side,
		mint: input.mint,
		amount: record.amount,
		usd_value: usd,
		venue: sim.data?.venue ?? null,
		expected_out: sim.data?.expected_out ?? null,
		min_out: sim.data?.min_out ?? null,
		price_impact_pct: sim.data?.price_impact_pct ?? null,
		simulation_error: sim.data?.err ?? null,
		loop_cap: capBlock
			? { allowed: false, remaining_usd: capBlock.remainingUsd, message: 'This buy exceeds what is left of the loop daily USD cap; trade_execute will refuse it.' }
			: { allowed: true },
		next: 'To execute exactly this trade, call trade_execute with this preview_id and confirm_swap: true.',
	};
}

async function tradeExecute({ agent, loop, tick, args, engine, simulate }) {
	if (args?.confirm_swap !== true) {
		return { ok: false, error: 'confirm_swap must be true to execute a trade.' };
	}
	const previewId = typeof args?.preview_id === 'string' ? args.preview_id : '';
	const [row] = await sql`SELECT previews -> ${previewId}::text AS p FROM agent_loop_ticks WHERE id = ${tick.id}`;
	const preview = row?.p;
	if (!preview) return { ok: false, error: 'Unknown preview_id. Call trade_preview first in this tick.' };
	if (preview.used) return { ok: false, error: 'This preview was already executed. Preview again for another trade.' };
	if (Date.parse(preview.expiresAt) < Date.now()) return { ok: false, error: 'This preview expired. Call trade_preview again.' };

	// Re-read everything a stop, a freeze or a settings change could have
	// flipped since the tick started.
	const live = await freshAgent(agent.id);
	if (!live || live.deleted_at) return { ok: false, error: 'This agent no longer exists.' };
	if (live.status && live.status !== 'running') return { ok: false, error: 'The agent was stopped. No trade was made.' };
	if (live.meta?.spend_limits?.frozen === true) {
		return { ok: false, code: 'wallet_frozen', error: 'The agent wallet is frozen. No trade was made.' };
	}
	const [loopRow] = await sql`SELECT enabled, financial_enabled, daily_usdc_cap_usd FROM agent_loops WHERE agent_id = ${agent.id}`;
	if (!loopRow?.enabled || !loopRow.financial_enabled) {
		return { ok: false, error: 'The owner turned off trading for this loop. No trade was made.' };
	}
	if (!(await engine.hasSignedAgreement(agent.user_id))) {
		return {
			ok: false,
			code: 'risk_ack_required',
			error: 'The owner has not signed the current real-funds agreements, so the loop cannot trade. No trade was made.',
		};
	}
	if (preview.side === 'buy') {
		const caps = { dailyUsdcUsd: Number(loopRow.daily_usdc_cap_usd) || 0 };
		const spent = await loopSpendToday(agent.id);
		const block = preview.usd == null
			? { remainingUsd: Math.max(0, caps.dailyUsdcUsd - spent.usdcUsd) }
			: usdcCapVerdict(caps, spent, preview.usd);
		if (block) {
			return {
				ok: false,
				code: 'loop_usdc_cap',
				error: `This buy would exceed the loop daily USD cap ($${caps.dailyUsdcUsd.toFixed(2)}, $${block.remainingUsd.toFixed(2)} left). No trade was made.`,
			};
		}
	}

	// Claim the preview before the trade so a replayed step cannot spend twice;
	// the custody idempotency key below dedupes the trade itself as well.
	const claimed = await sql`
		UPDATE agent_loop_ticks
		   SET previews = jsonb_set(previews, ARRAY[${previewId}::text, 'used'], 'true'::jsonb), updated_at = now()
		 WHERE id = ${tick.id} AND coalesce((previews -> ${previewId}::text ->> 'used')::boolean, false) = false
		RETURNING id
	`;
	const replay = !claimed.length;

	let input;
	try {
		input = await engine.parse(
			{
				side: preview.side,
				mint: preview.mint,
				amount: preview.amount,
				slippageBps: preview.slippageBps,
				network: 'mainnet',
				idempotency_key: `loop:${tick.id}:${previewId}`,
			},
			live.meta || {},
		);
	} catch (err) {
		return { ok: false, error: err?.message || 'invalid trade' };
	}
	if (simulate) input.simulate = true;
	const out = await engine.execute({
		id: agent.id,
		userId: agent.user_id,
		meta: live.meta || {},
		input,
		source: 'strategy:loop',
		sourceMeta: sourceMeta(loop, tick),
	});
	if (!out.ok) {
		return { ok: false, blocked: true, code: out.code, error: out.message, detail: out.detail || null };
	}
	if (simulate) {
		// Nothing was signed, so nothing counts against the loop's USD cap, but
		// the action is still recorded on the tick.
		if (!replay) {
			await sql`UPDATE agent_loop_ticks SET actions = actions + 1, updated_at = now() WHERE id = ${tick.id}`;
		}
		return {
			ok: true,
			simulated: true,
			side: preview.side,
			mint: preview.mint,
			amount: preview.amount,
			usd_value: preview.usd,
			expected_out: out.data?.expected_out ?? null,
			signature: null,
			note: 'Simulate mode: the trade passed every guard and was simulated on chain. Nothing was signed or sent.',
		};
	}
	if (!replay && !out.data?.replayed) {
		const usd = preview.side === 'buy' && preview.usd ? preview.usd : 0;
		await sql`
			UPDATE agent_loop_ticks
			   SET spent_usd = spent_usd + ${String(usd)}, actions = actions + 1, updated_at = now()
			 WHERE id = ${tick.id}
		`;
	}
	return {
		ok: true,
		side: preview.side,
		mint: preview.mint,
		amount: preview.amount,
		usd_value: preview.usd,
		signature: out.data?.signature ?? null,
		explorer: out.data?.explorer ?? null,
		replayed: Boolean(out.data?.replayed || replay),
	};
}
