// Specialist adapters: the one place a coordinator step touches real executors.
//
// Each adapter takes a resolved squad (squad.js) and one plan step, and returns
// a structured finding: { verdict, summary, evidence }. Summaries are templates
// over structured fields; untrusted coin text only ever reaches evidence after
// quarantineMetadata(), never a sentence the owner acts on.
//
// A team squad runs each role through the specialist team runtime
// (api/_lib/teams/runtime.js), so every step also lands on the team's findings
// board with the member's permissions enforced. A solo squad runs the same
// executors directly against the one agent. Both paths reach the same trade
// engine (previewAgentTrade / executeAgentTrade), so spend guards, the trade
// firewall, the daily budget and the custody ledger apply to every chat trade
// exactly as they do to a manual one.
//
// Nothing here signs a launch or a transfer: those hand the owner a prefilled
// page where they sign themselves, from a same-site session.

import { sql } from '../db.js';
import { getTradeLimits } from '../agent-trade-guards.js';
import { receiptTxUrl } from '../trade-receipt.js';
import { evaluateCondition, normalizeOrder, createOrder, describeCondition } from '../orders.js';
import { memberForRole } from './squad.js';
import { savePref } from './prefs.js';
import { mintLabel, describeEntryCondition } from './plan.js';
import { quarantineMetadata, injectionRiskNote } from './untrusted.js';

/** A refusal or failure the owner should read verbatim. Anything else is logged and genericized. */
export class StepError extends Error {
	constructor(code, message, detail = null) {
		super(message);
		this.code = code;
		this.detail = detail;
		this.isStepError = true;
	}
}

// The team runtime is a sibling surface: imported lazily, and only for team
// squads, so a solo squad works whether or not it is installed.
async function teamRuntime() {
	return import('../teams/runtime.js');
}

async function researchModule() {
	try {
		return await import('../teams/research.js');
	} catch {
		return null;
	}
}

function asStepError(e) {
	if (e?.isStepError) return e;
	if (e?.name === 'TeamError' || e?.isBoundary) return new StepError(e.code || 'refused', e.message, e.detail || null);
	return e;
}

/** The squad's policy agent row, owner-checked. Its meta carries the wallet and trade limits. */
export async function loadPolicyAgent(squad, userId) {
	if (!squad.policy_agent_id) throw new StepError('no_trader', 'This squad has no Trader agent to trade from. Repair the team first.');
	const [agent] = await sql`
		select id, user_id, name, avatar_id, meta from agent_identities
		where id = ${squad.policy_agent_id} and deleted_at is null limit 1
	`;
	if (!agent || agent.user_id !== userId) throw new StepError('no_trader', 'The Trader agent is missing. Repair the team first.');
	return { ...agent, meta: { ...(agent.meta || {}) } };
}

/** The per-trade cap in SOL: the stricter of the team policy and the agent's own trade limits. */
export function tradeCapSol(squad, agentMeta) {
	const caps = [squad.policy?.per_trade_sol, getTradeLimits(agentMeta || {}).per_trade_sol]
		.map((v) => (v == null ? null : Number(v)))
		.filter((v) => Number.isFinite(v) && v > 0);
	return caps.length ? Math.min(...caps) : null;
}

// ── team plumbing ──────────────────────────────────────────────────────────────

async function teamContext(squad, userId, role) {
	if (squad.status !== 'active') {
		throw new StepError(squad.status === 'paused' ? 'paused' : 'not_ready', squad.status === 'paused'
			? 'This team is paused. Resume it on the team page to run specialists.'
			: 'This team is not fully assembled. Repair it on the team page first.');
	}
	const rt = await teamRuntime();
	const { team } = await rt.loadTeamFor(squad.id, userId);
	const pick = memberForRole(squad, role);
	if (!pick) throw new StepError('no_member', `This team has no ${role}. Repair the team on its page.`);
	const rows = await rt.listMembers(squad.id);
	const member = rows.find((m) => m.id === pick.member_id);
	if (!member) throw new StepError('no_member', `This team's ${role} is no longer active. Repair the team.`);
	return { rt, team, member };
}

// ── research ───────────────────────────────────────────────────────────────────

async function loadCoinMetadata(mint, network) {
	try {
		const [row] = await sql`
			select name, symbol, description, twitter, telegram, website
			from pump_coin_intel where mint = ${mint} and network = ${network} limit 1
		`;
		return row || null;
	} catch {
		return null;
	}
}

// The trade firewall alone, for an install without the research module.
async function firewallOnly(mint, network) {
	const { assessTradeSafety } = await import('../trade-firewall.js');
	const safety = await assessTradeSafety({ network, mint, side: 'buy', quoteAmount: 50_000_000n });
	const verdict = safety.verdict === 'block' ? 'avoid' : safety.verdict === 'allow' ? 'pass' : 'caution';
	const reasons = (safety.reasons || []).slice(0, 4);
	return {
		verdict,
		score: Number(safety.score) || 0,
		summary: null,
		reasons,
		evidence: { network, safety: { verdict: safety.verdict, score: safety.score }, sources: [{ name: 'trade_firewall', at: new Date().toISOString() }] },
	};
}

const VERDICT_LABEL = { pass: 'Pass', caution: 'Caution', avoid: 'Avoid' };

/**
 * Researcher: vet one mint. Team squads reuse a live finding from the board
 * when one exists (the runtime's reuse rule); solo squads run fresh.
 */
export async function research({ squad, step, userId }) {
	const { mint } = step.params;
	const network = squad.network;
	let core;
	let findingId = null;
	let reused = false;
	try {
		if (squad.kind === 'team') {
			const { rt, team, member } = await teamContext(squad, userId, 'researcher');
			const out = await rt.runResearch(team, member, { mint });
			reused = out.reused;
			findingId = out.finding.id;
			core = {
				verdict: out.finding.verdict,
				score: out.finding.score,
				reasons: out.finding.evidence?.reasons || [],
				evidence: out.finding.evidence || {},
			};
		} else {
			const mod = await researchModule();
			core = mod ? await mod.researchMint({ mint, network }) : await firewallOnly(mint, network);
		}
	} catch (e) {
		throw asStepError(e);
	}

	const meta = quarantineMetadata(await loadCoinMetadata(mint, network));
	const riskNote = injectionRiskNote(meta.flags);
	const reasons = (core.reasons || []).slice(0, 6).map((r) => String(r).slice(0, 200));
	const label = mintLabel(mint);
	const lead = reasons[0] ? ` ${reasons[0]}` : '';
	const summary = `${label}: ${VERDICT_LABEL[core.verdict] || core.verdict} at ${Math.round(Number(core.score) || 0)}/100.${lead}${riskNote ? ' Its metadata tries to instruct AI agents.' : ''}`;
	return {
		verdict: core.verdict,
		summary: summary.slice(0, 400),
		evidence: {
			mint,
			network,
			verdict: core.verdict,
			score: Math.round(Number(core.score) || 0),
			reasons,
			identity: { name: meta.fields.name, symbol: meta.fields.symbol, description: meta.fields.description },
			socials: { twitter: meta.fields.twitter, telegram: meta.fields.telegram, website: meta.fields.website },
			injection: { suspicious: meta.suspicious, flags: meta.flags },
			risk_note: riskNote,
			safety: core.evidence?.safety || null,
			intel: core.evidence?.intel ? { quality_score: core.evidence.intel.quality_score, bundle_score: core.evidence.intel.bundle_score, dev_sold: core.evidence.intel.dev_sold } : null,
			smart_money: core.evidence?.smart_money || null,
			sources: core.evidence?.sources || [],
			finding_id: findingId,
			reused,
		},
	};
}

// ── entry ──────────────────────────────────────────────────────────────────────

function conditionSignals(spec) {
	const out = new Set();
	for (const c of spec?.all || []) if (c?.signal) out.add(c.signal);
	return [...out];
}

function roundSig(v) {
	if (v == null || !Number.isFinite(Number(v))) return null;
	const n = Number(v);
	return Math.abs(n) >= 1000 ? Math.round(n) : Number(n.toPrecision(6));
}

/**
 * Entry: evaluate the owner's condition against live signals. With no
 * condition it reports a market snapshot. On a team squad the entry scorer's
 * verdict is attached too when the intel watcher has a record for the mint.
 */
export async function entryCheck({ squad, step, userId }) {
	const { mint, condition } = step.params;
	const { getSignals } = await import('../../../workers/agent-orders/market.js');
	const need = condition ? conditionSignals(condition) : ['mcap_usd', 'graduated'];
	let signals = {};
	let market = null;
	try {
		const out = await getSignals({ network: squad.network, mint, need: [...new Set([...need, 'mcap_usd'])] });
		signals = out?.signals || {};
		market = out?.market || null;
	} catch (e) {
		throw new StepError('signals_unavailable', `Could not read live market data for ${mintLabel(mint)}: ${String(e?.message || 'unknown error').slice(0, 120)}`);
	}

	let scorer = null;
	if (squad.kind === 'team') {
		try {
			const { rt, team, member } = await teamContext(squad, userId, 'entry');
			const out = await rt.runEntry(team, member, { mint });
			const f = out.findings?.[0];
			if (f) scorer = { verdict: f.verdict, score: f.score, summary: f.summary, finding_id: f.id };
		} catch (e) {
			if (e?.code !== 'no_intel' && !e?.isStepError) console.warn('[team-chat] entry scorer skipped', e?.message);
		}
	}

	const snapshot = {
		mcap_usd: roundSig(signals.mcap_usd),
		mcap_sol: roundSig(signals.mcap_sol),
		price_sol: roundSig(signals.price_sol),
		graduated: typeof signals.graduated === 'boolean' ? signals.graduated : null,
		smart_money_score: roundSig(signals.smart_money_score),
		dev_dump: typeof signals.dev_dump === 'boolean' ? signals.dev_dump : null,
		venue: market?.venue || null,
	};
	const label = mintLabel(mint);
	if (!condition) {
		const cap = snapshot.mcap_usd != null ? `$${snapshot.mcap_usd.toLocaleString('en-US')}` : 'unknown';
		return {
			verdict: 'snapshot',
			summary: `${label} market cap is ${cap}${snapshot.graduated ? ', graduated to the AMM' : ''}.${scorer ? ` Entry scorer: ${scorer.verdict === 'setup' ? 'a setup' : 'no setup'}.` : ''}`,
			evidence: { mint, condition: null, signals: snapshot, scorer },
		};
	}
	const { fired, missing } = evaluateCondition(condition, signals);
	const verdict = missing?.length ? 'unknown' : fired ? 'met' : 'not_met';
	const described = describeEntryCondition(condition);
	const summary = verdict === 'met'
		? `Entry condition met on ${label}: ${described}.`
		: verdict === 'not_met'
			? `Entry condition not met on ${label}: wanted ${described}.`
			: `Could not confirm the entry condition on ${label}: no live ${missing.join(', ')} reading.`;
	return {
		verdict,
		summary,
		evidence: { mint, condition, condition_text: describeCondition(condition), missing: missing || [], signals: snapshot, scorer },
	};
}

// ── trade ──────────────────────────────────────────────────────────────────────

async function sellTokenAmount(squad, agentMeta, params) {
	if (params.amount_unit === 'max') return 'max';
	if (params.amount_unit === 'token') return Number(params.amount);
	const { getHolding } = await import('../../../workers/agent-orders/market.js');
	const holding = await getHolding({ network: squad.network, mint: params.mint, owner: agentMeta.solana_address });
	if (!holding || !(holding.whole > 0)) throw new StepError('no_position', `The Trader holds no ${mintLabel(params.mint)} to sell.`);
	const pct = Math.max(0, Math.min(100, Number(params.amount)));
	if (pct >= 100) return 'max';
	return Number(((holding.whole * pct) / 100).toFixed(holding.decimals > 6 ? 6 : holding.decimals));
}

/**
 * Trader, quote stage: price the trade through the real engine without
 * signing. Returns the quote (or null with a note when the agent has no wallet
 * yet) and the resolved amount for the approval card.
 */
export async function quoteTrade({ squad, step, userId, amount }) {
	const agent = await loadPolicyAgent(squad, userId);
	const trade = await import('../../agents/agent-trade.js');
	const p = step.params;
	const sendAmount = p.side === 'buy' ? amount : await sellTokenAmount(squad, agent.meta, p);
	let input;
	try {
		input = trade.parseTradeInput({ side: p.side, mint: p.mint, amount: sendAmount, slippageBps: p.slippage_bps, network: squad.network, simulate: true }, getTradeLimits(agent.meta));
	} catch (e) {
		throw asStepError(e);
	}
	if (!agent.meta.solana_address) {
		return { agent, amount: sendAmount, slippage_bps: input.slippageBps, quote: null, note: 'The Trader has no wallet yet. One is created when the trade first runs; the quote comes from that run.' };
	}
	try {
		const quote = await trade.previewAgentTrade({ id: agent.id, userId, meta: agent.meta, input });
		return { agent, amount: sendAmount, slippage_bps: input.slippageBps, quote, note: null };
	} catch (e) {
		throw asStepError(e);
	}
}

function shapeTradeReceipt(data, { mode, network }) {
	if (!data) return null;
	return {
		simulated: mode === 'paper' || data.simulated === true,
		signature: data.signature || null,
		explorer: data.signature ? receiptTxUrl(data.signature, network) || data.explorer || null : null,
		custody_event_id: data.custody_event_id || null,
		venue: data.venue || null,
		price_impact_pct: data.price_impact_pct ?? null,
		sol_spent: data.sol_spent ?? null,
		sol_received: data.sol_received ?? null,
		tokens_received: data.tokens_received ?? null,
		tokens_sold: data.tokens_sold ?? null,
		expected_out: data.expected_out ?? data.expected_out_raw ?? null,
		min_out: data.min_out ?? null,
		simulation_error: data.err ?? null,
		units_consumed: data.units_consumed ?? null,
	};
}

/** The live-mode precondition the HTTP trade route enforces: a signed real-funds agreement. */
async function assertRealFundsAgreement(userId, network) {
	if (network === 'devnet') return;
	const { currentSignatureFor, agreementRequirement } = await import('../real-funds-agreement.js');
	const sig = await currentSignatureFor(userId);
	if (!sig) {
		const req = agreementRequirement();
		throw new StepError('agreement_required', 'Live trading needs the real-funds agreement signed first. Sign it, then approve again.', { sign_url: req.sign_url });
	}
}

/**
 * Trader, execute stage. Runs only from an approved payload (runner.js checks
 * the hash first). Paper mode simulates the real instructions and never signs.
 */
export async function executeTrade({ squad, payload, userId, req = null }) {
	const mode = payload.mode === 'live' ? 'live' : 'paper';
	if (mode === 'live') await assertRealFundsAgreement(userId, squad.network);

	if (squad.kind === 'team') {
		const { rt, team, member } = await teamContext(squad, userId, 'trader');
		let out;
		try {
			out = await rt.runTrade(team, member, {
				mint: payload.mint,
				side: payload.side,
				amount: payload.amount,
				mode: mode === 'live' ? 'live' : 'simulate',
				slippageBps: payload.slippage_bps,
				confirm: true,
			}, { req, userId });
		} catch (e) {
			throw asStepError(e);
		}
		if (!out.outcome.ok) {
			throw new StepError(out.outcome.code || 'trade_refused', out.outcome.message || 'The Trader refused this trade.', { finding_id: out.finding?.id || null });
		}
		return { receipt: { ...shapeTradeReceipt(out.outcome.data, { mode, network: squad.network }), finding_id: out.finding?.id || null } };
	}

	const agent = await loadPolicyAgent(squad, userId);
	const trade = await import('../../agents/agent-trade.js');
	let input;
	try {
		input = trade.parseTradeInput({
			side: payload.side,
			mint: payload.mint,
			amount: payload.amount,
			slippageBps: payload.slippage_bps,
			network: squad.network,
			simulate: mode === 'paper',
			idempotency_key: `team-chat:${payload.step_id}`,
		}, getTradeLimits(agent.meta));
	} catch (e) {
		throw asStepError(e);
	}
	const result = await trade.executeAgentTrade({ id: agent.id, userId, meta: agent.meta, input, req, source: 'discretionary', sourceMeta: { via: 'team_chat', run_id: payload.run_id } });
	if (!result.ok) throw new StepError(result.code || 'trade_failed', result.message || 'The trade engine stopped this trade.', result.detail || null);
	return { receipt: { ...shapeTradeReceipt(result.data, { mode, network: squad.network }), finding_id: null } };
}

/**
 * Trader, conditional order: when the owner's entry condition is not met yet in
 * live mode, the approved action is a standing order the order worker fires
 * once the condition holds, inside the same spend guards.
 */
export async function placeConditionalOrder({ squad, payload, userId }) {
	const agent = await loadPolicyAgent(squad, userId);
	const raw = {
		type: 'conditional',
		side: payload.side,
		mint: payload.mint,
		network: squad.network,
		condition: payload.condition,
		slippage_bps: payload.slippage_bps,
		expires_at: payload.order_expires_at,
	};
	if (payload.side === 'buy') raw.size_sol = payload.amount;
	else if (payload.amount === 'max') raw.sell_pct = 100;
	else raw.size_tokens = payload.amount;
	const norm = normalizeOrder(raw);
	if (!norm.ok) throw new StepError(norm.error || 'invalid_order', norm.message || 'The order was refused.');
	const row = await createOrder(agent.id, userId, norm.order);
	return { receipt: { order_id: row?.id || null, status: row?.status || 'open', expires_at: norm.order.expires_at, orders_url: `/agent/${agent.id}/wallet#orders` } };
}

// ── launch, strategy, transfer, remember ───────────────────────────────────────

const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

function soloLaunchUrl({ avatarId, name, symbol, description, network }) {
	const q = new URLSearchParams();
	if (avatarId) q.set('avatar', avatarId);
	q.set('name', name);
	q.set('symbol', symbol);
	if (description) q.set('description', description);
	if (network === 'devnet') q.set('network', 'devnet');
	return `/three-launchpad?${q.toString()}#tl-launch`;
}

/**
 * Launcher: validate the coin plan and hand back a prefilled launchpad link.
 * Never builds or signs a transaction: the owner signs on /three-launchpad.
 */
export async function prepareLaunch({ squad, step, userId }) {
	const p = step.params;
	if (!p.symbol || !SYMBOL_RE.test(p.symbol)) {
		return { verdict: 'blocked', summary: `The launch plan for ${p.name} needs a ticker of 1 to 10 letters or digits. Say "($TICKER)".`, evidence: { plan: p, blockers: ['missing ticker'], launch_url: null } };
	}
	if (squad.kind === 'team') {
		try {
			const { rt, team, member } = await teamContext(squad, userId, 'launcher');
			const out = await rt.runLaunchPrep(team, member, { name: p.name, symbol: p.symbol, description: p.description || '' });
			return {
				verdict: out.ready ? 'ready' : 'blocked',
				summary: out.finding.summary,
				evidence: { plan: p, blockers: out.blockers, launch_url: out.finding.evidence?.launch_url || null, lane: out.finding.evidence?.lane || null, finding_id: out.finding.id },
			};
		} catch (e) {
			throw asStepError(e);
		}
	}
	const launcher = memberForRole(squad, 'launcher');
	const blockers = [];
	if (!launcher?.avatar_id) blockers.push('The agent has no 3D body to use as the coin image.');
	const ready = blockers.length === 0;
	return {
		verdict: ready ? 'ready' : 'blocked',
		summary: ready ? `Launch plan for ${p.symbol} is ready. You review and sign it on the launchpad.` : `Launch plan for ${p.symbol} is blocked: ${blockers[0]}`,
		evidence: { plan: p, blockers, launch_url: ready ? soloLaunchUrl({ avatarId: launcher.avatar_id, name: p.name, symbol: p.symbol, description: p.description, network: squad.network }) : null },
	};
}

/** Trader, strategy: compile the owner's words into a sniping strategy for review on the Snipe tab. */
export async function draftStrategy({ squad, step, userId }) {
	const agent = await loadPolicyAgent(squad, userId);
	const { compileStrategyFromText } = await import('../strategy-compiler.js');
	const out = await compileStrategyFromText(step.params.text, { tradeLimits: getTradeLimits(agent.meta), network: squad.network, track: { userId, agentId: agent.id, tool: 'team-chat-strategy' } });
	if (!out.ok) throw new StepError(out.error || 'compile_failed', out.message || 'Could not turn that into a strategy.');
	return {
		verdict: 'drafted',
		summary: `Drafted a sniping strategy: ${String(out.summary || '').slice(0, 220)} Review and arm it on the Snipe tab; nothing trades until you do.`,
		evidence: { strategy: out.strategy, summary: out.summary, assumptions: out.assumptions || [], warnings: out.warnings || [], clamped: out.clamped || null, via: out.via, handoff_url: `/agent/${agent.id}/wallet#snipe` },
	};
}

/** Trader, transfer: the owner signs sends on the agent wallet page; the chat prepares the confirmation. */
export async function prepareTransfer({ squad, step, userId }) {
	const agent = await loadPolicyAgent(squad, userId);
	const p = step.params;
	return {
		verdict: 'ready',
		summary: `Prepared a send of ${p.amount} ${p.asset}. You confirm and sign it on the agent wallet page.`,
		evidence: { amount: p.amount, asset: p.asset, recipient: p.recipient, from: agent.meta.solana_address || null, handoff_url: `/agent/${agent.id}/wallet#withdraw` },
	};
}

/** Coordinator: persist a preference into the policy agent's memory. */
export async function remember({ squad, step }) {
	const entry = await savePref(squad.policy_agent_id, squad.id, step.params.key, step.params.value);
	if (!entry) throw new StepError('bad_preference', 'That preference could not be saved.');
	return { verdict: 'saved', summary: entry.content, evidence: { memory: entry } };
}
