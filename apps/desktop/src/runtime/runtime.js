// The local agent runtime. Runs agents, strategies, orders and automations on
// this machine. Signing keys live in the keystore (OS keychain), state lives in
// a plain JSON file with no key material, and every action that signs or moves
// funds in live mode waits for an explicit yes carrying the payload hash the
// owner was shown (the same canonical-JSON sha256 the web flow uses).
//
// Pure of Electron: main.js injects the keystore, the store and the callbacks,
// the smoke test injects the same real pieces with a temp directory.

import { randomUUID } from 'node:crypto';
import { canonicalJson, payloadHash, confirmationTable, confirmationText } from './hash.js';
import { validateStrategyConfig, matchesEntry, shouldExit, effectivePriceImpactPct } from './strategy-schema.js';
import { createPumpFeed } from './feed.js';
import { quoteBuy, quoteSell } from './curve.js';

export const APPROVAL_TTL_MS = 15 * 60 * 1000;
export const AGENT_STATES = ['idle', 'working', 'waiting_approval', 'paused', 'error', 'killed'];
const MAX_RECEIPTS = 500;

export class RuntimeError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const emptyState = () => ({ version: 1, agents: {}, positions: [], approvals: {}, receipts: [], seen: {} });

export function createRuntime({ stateStore, keystore, log, feed = createPumpFeed(), live = null, onEvent = () => {}, now = Date.now }) {
	const state = { ...emptyState(), ...(stateStore.read() || {}) };
	const persist = () => stateStore.write(state);
	const emit = (type, data) => {
		try {
			onEvent({ type, ...data });
		} catch (err) {
			log.warn('event_handler_failed', { type, err });
		}
	};

	const agentOf = (id) => {
		const a = state.agents[id];
		if (!a) throw new RuntimeError('agent_not_found', `No agent ${id}.`, 404);
		return a;
	};

	function setStatus(agent, status, detail = null) {
		if (agent.status === status && agent.detail === detail) return;
		agent.status = status;
		agent.detail = detail;
		persist();
		emit('status', { agent: publicAgent(agent), face: face() });
	}

	// ── agents ───────────────────────────────────────────────────────────────
	function createAgent({ name, mode = 'paper', network = 'mainnet', strategy = {} }) {
		const cleanName = String(name || '').trim().slice(0, 60);
		if (!cleanName) throw new RuntimeError('invalid_name', 'An agent needs a name.');
		if (!['paper', 'live'].includes(mode)) throw new RuntimeError('invalid_mode', 'Mode must be paper or live.');
		if (!['mainnet', 'devnet'].includes(network)) throw new RuntimeError('invalid_network', 'Network must be mainnet or devnet.');
		const v = validateStrategyConfig({ ...strategy, network });
		if (!v.valid) throw new RuntimeError('invalid_strategy', v.errors.map((e) => `${e.field}: ${e.message}`).join(' '));
		const id = `ag_${randomUUID().slice(0, 12)}`;
		const wallet = keystore.create(id);
		state.agents[id] = {
			id, name: cleanName, mode, network, strategy: v.config, address: wallet.address,
			status: 'idle', detail: null, orders: [], automations: [], created_at: now(), last_sweep_at: null, last_cooldown_at: 0,
		};
		persist();
		log.info('agent_created', { id, mode, network });
		emit('status', { agent: publicAgent(state.agents[id]), face: face() });
		return publicAgent(state.agents[id]);
	}

	function pause(id) {
		const a = agentOf(id);
		if (a.status === 'killed') throw new RuntimeError('agent_killed', 'A killed agent cannot be paused.', 409);
		setStatus(a, 'paused');
		return publicAgent(a);
	}

	function resume(id) {
		const a = agentOf(id);
		if (a.status === 'killed') throw new RuntimeError('agent_killed', 'A killed agent cannot be resumed.', 409);
		setStatus(a, 'idle');
		return publicAgent(a);
	}

	/** Stop the agent for good: denies its pending approvals and disables orders and automations. Receipts and positions stay. */
	function kill(id) {
		const a = agentOf(id);
		for (const ap of Object.values(state.approvals)) {
			if (ap.agent_id === id && ap.status === 'pending') decideLocal(ap, 'denied', 'kill');
		}
		a.orders = [];
		a.automations = [];
		setStatus(a, 'killed');
		log.info('agent_killed', { id });
		return publicAgent(a);
	}

	function remove(id) {
		const a = agentOf(id);
		if (a.status !== 'killed') throw new RuntimeError('agent_active', 'Kill the agent before removing it.', 409);
		if (state.positions.some((p) => p.agent_id === id && p.status === 'open')) {
			throw new RuntimeError('open_positions', 'Close the open positions before removing the agent.', 409);
		}
		keystore.remove(id);
		delete state.agents[id];
		persist();
		return { removed: id };
	}

	function addOrder(id, order) {
		const a = agentOf(id);
		if (a.status === 'killed') throw new RuntimeError('agent_killed', 'The agent is killed.', 409);
		const side = order.side === 'sell' ? 'sell' : 'buy';
		if (!order.mint || typeof order.mint !== 'string') throw new RuntimeError('invalid_order', 'An order needs a mint.');
		const below = Number(order.trigger?.price_sol_below);
		const above = Number(order.trigger?.price_sol_above);
		const hasBelow = Number.isFinite(below) && below > 0;
		const hasAbove = Number.isFinite(above) && above > 0;
		if (!hasBelow && !hasAbove) throw new RuntimeError('invalid_order', 'An order needs price_sol_below or price_sol_above.');
		const amount = Number(order.amount_sol);
		if (side === 'buy' && !(amount > 0 && amount <= a.strategy.sizing.amount_sol * 10)) {
			throw new RuntimeError('invalid_order', 'Buy size must be positive and within ten times the strategy size.');
		}
		const o = { id: `or_${randomUUID().slice(0, 10)}`, mint: order.mint, side, amount_sol: side === 'buy' ? amount : null, trigger: { ...(hasBelow && { price_sol_below: below }), ...(hasAbove && { price_sol_above: above }) }, created_at: now() };
		a.orders.push(o);
		persist();
		return o;
	}

	function removeOrder(id, orderId) {
		const a = agentOf(id);
		a.orders = a.orders.filter((o) => o.id !== orderId);
		persist();
	}

	function addAutomation(id, auto) {
		const a = agentOf(id);
		if (a.status === 'killed') throw new RuntimeError('agent_killed', 'The agent is killed.', 409);
		const every = Number(auto.every_minutes);
		if (!(every >= 1 && every <= 10080)) throw new RuntimeError('invalid_automation', 'every_minutes must be between 1 and 10080.');
		if (!['sweep', 'expire_sweep'].includes(auto.action)) throw new RuntimeError('invalid_automation', 'action must be sweep or expire_sweep.');
		const x = { id: `au_${randomUUID().slice(0, 10)}`, action: auto.action, every_minutes: every, last_run_at: 0 };
		a.automations.push(x);
		persist();
		return x;
	}

	// ── approvals ────────────────────────────────────────────────────────────
	function decideLocal(ap, status, via) {
		ap.status = status;
		ap.decided_at = now();
		ap.via = via;
		emit('approval', { approval: publicApproval(ap) });
	}

	/** The exact action that will run, plus the table and hash the owner is shown. */
	function fileApproval(agent, payload, row) {
		const dupe = Object.values(state.approvals).find((ap) => ap.agent_id === agent.id && ap.status === 'pending' && ap.payload.idempotency_key === payload.idempotency_key);
		if (dupe) return dupe;
		const ap = {
			id: `ap_${randomUUID().slice(0, 12)}`, agent_id: agent.id, status: 'pending', payload,
			hash: payloadHash(payload), row, created_at: now(), expires_at: now() + APPROVAL_TTL_MS,
		};
		state.approvals[ap.id] = ap;
		persist();
		setStatus(agent, 'waiting_approval', `${row.amount} ${row.asset} to ${row.recipient_label || row.recipient}`);
		emit('approval', { approval: publicApproval(ap), notify: true });
		return ap;
	}

	function publicApproval(ap) {
		return {
			id: ap.id, agent_id: ap.agent_id, status: effectiveStatus(ap), hash: ap.hash, payload: ap.payload,
			table: confirmationTable(ap.row), text: confirmationText(ap.row), created_at: ap.created_at, expires_at: ap.expires_at, decided_at: ap.decided_at || null,
		};
	}

	const effectiveStatus = (ap) => (ap.status === 'pending' && ap.expires_at <= now() ? 'expired' : ap.status);

	function listApprovals({ status = null, agentId = null } = {}) {
		return Object.values(state.approvals)
			.filter((ap) => (!agentId || ap.agent_id === agentId) && (!status || effectiveStatus(ap) === status))
			.sort((a, b) => b.created_at - a.created_at)
			.map(publicApproval);
	}

	function refreshWaiting(agent) {
		const waiting = Object.values(state.approvals).some((ap) => ap.agent_id === agent.id && effectiveStatus(ap) === 'pending');
		if (agent.status === 'waiting_approval' && !waiting) setStatus(agent, 'idle');
	}

	/**
	 * Approve or deny. An approval must present the hash it was shown; the stored
	 * payload is re-hashed here so neither a stale view nor an edited state file
	 * can run an action that differs from what the owner saw.
	 */
	async function decide(approvalId, { decision, hash, via = 'desktop' }) {
		const ap = state.approvals[approvalId];
		if (!ap) throw new RuntimeError('approval_not_found', 'No such approval.', 404);
		if (!['approve', 'deny'].includes(decision)) throw new RuntimeError('invalid_decision', 'Decision must be approve or deny.');
		if (effectiveStatus(ap) === 'expired' && ap.status === 'pending') {
			decideLocal(ap, 'expired', 'timeout');
			persist();
			throw new RuntimeError('approval_expired', 'This approval expired. Nothing was run.', 410);
		}
		if (ap.status !== 'pending') throw new RuntimeError('approval_not_pending', `This approval is already ${ap.status}.`, 409);
		const agent = agentOf(ap.agent_id);
		if (decision === 'deny') {
			decideLocal(ap, 'denied', via);
			persist();
			refreshWaiting(agent);
			return publicApproval(ap);
		}
		if (agent.status === 'killed') throw new RuntimeError('agent_killed', 'The agent was killed. Nothing was run.', 409);
		if (typeof hash !== 'string' || hash.toLowerCase() !== ap.hash) {
			throw new RuntimeError('hash_mismatch', 'The hash does not match the action on file. Nothing was run.', 409);
		}
		if (payloadHash(ap.payload) !== ap.hash) {
			throw new RuntimeError('payload_changed', 'The stored action changed after it was filed. Nothing was run.', 409);
		}
		ap.status = 'executing';
		persist();
		try {
			const receipt = await execute(agent, ap.payload, { approval: ap });
			ap.status = 'executed';
			ap.decided_at = now();
			ap.via = via;
			ap.receipt_id = receipt.id;
		} catch (err) {
			ap.status = 'failed';
			ap.decided_at = now();
			ap.error = String(err.message || err).slice(0, 300);
			setStatus(agent, 'error', ap.error);
			log.error('approval_execute_failed', { id: ap.id, err });
		}
		persist();
		emit('approval', { approval: publicApproval(ap) });
		refreshWaiting(agent);
		return publicApproval(ap);
	}

	// ── execution ────────────────────────────────────────────────────────────
	function recordReceipt(r) {
		const receipt = { id: `rc_${randomUUID().slice(0, 12)}`, at: now(), ...r };
		state.receipts.unshift(receipt);
		if (state.receipts.length > MAX_RECEIPTS) state.receipts.length = MAX_RECEIPTS;
		persist();
		emit('receipt', { receipt });
		return receipt;
	}

	async function execute(agent, payload, { approval = null } = {}) {
		if (payload.side === 'buy') return executeBuy(agent, payload, approval);
		return executeSell(agent, payload, approval);
	}

	async function executeBuy(agent, p, approval) {
		const coin = await feed.coin(p.mint);
		if (!coin) throw new RuntimeError('quote_unavailable', 'The launch feed has no data for this coin right now.', 502);
		const q = quoteBuy(coin, p.amount_sol);
		if (p.max_price_impact_pct != null && q.impact_pct > p.max_price_impact_pct) {
			throw new RuntimeError('price_impact', `Price impact ${q.impact_pct.toFixed(2)}% exceeds the ${p.max_price_impact_pct}% cap.`, 409);
		}
		let signature = null;
		if (agent.mode === 'live') {
			if (!live) throw new RuntimeError('live_unavailable', 'Live execution is not configured on this install.', 409);
			signature = await live.buy({ agent, payload: p, quote: q });
		}
		state.positions.push({
			id: `po_${randomUUID().slice(0, 10)}`, agent_id: agent.id, mint: p.mint, symbol: coin.symbol || null, status: 'open',
			entry_lamports: Math.round(p.amount_sol * 1e9), tokens: q.tokens, peak_value_lamports: Math.round(p.amount_sol * 1e9),
			opened_at: now(), network: agent.network, mode: agent.mode,
		});
		agent.last_cooldown_at = now();
		return recordReceipt({ agent_id: agent.id, kind: 'buy', mode: agent.mode, network: agent.network, mint: p.mint, symbol: coin.symbol || null, sol: p.amount_sol, tokens: q.tokens, impact_pct: q.impact_pct, signature, approval_id: approval?.id || null, payload_hash: approval?.hash || null });
	}

	async function executeSell(agent, p, approval) {
		const pos = state.positions.find((x) => x.id === p.position_id && x.status === 'open');
		if (!pos) throw new RuntimeError('position_not_found', 'That position is not open.', 404);
		const coin = await feed.coin(pos.mint);
		if (!coin) throw new RuntimeError('quote_unavailable', 'The launch feed has no data for this coin right now.', 502);
		const q = quoteSell(coin, pos.tokens);
		let signature = null;
		if (agent.mode === 'live') {
			if (!live) throw new RuntimeError('live_unavailable', 'Live execution is not configured on this install.', 409);
			signature = await live.sell({ agent, payload: p, position: pos, quote: q });
		}
		pos.status = 'closed';
		pos.closed_at = now();
		pos.exit_lamports = q.lamports;
		pos.exit_reason = p.reason || 'manual';
		return recordReceipt({ agent_id: agent.id, kind: 'sell', mode: agent.mode, network: agent.network, mint: pos.mint, symbol: pos.symbol, sol: q.lamports / 1e9, tokens: pos.tokens, pnl_pct: ((q.lamports - pos.entry_lamports) / pos.entry_lamports) * 100, reason: pos.exit_reason, signature, approval_id: approval?.id || null, payload_hash: approval?.hash || null });
	}

	/** Paper never needs a yes (nothing signs). Live needs one unless the strategy is explicitly 'auto'. */
	const needsApproval = (agent) => agent.mode === 'live' && agent.strategy.mode !== 'auto';

	async function act(agent, payload, row) {
		if (needsApproval(agent)) return fileApproval(agent, payload, row);
		return execute(agent, payload);
	}

	const buyRow = (agent, p, symbol) => ({
		recipient: p.mint, recipient_label: symbol ? `$${symbol}` : null, amount: p.amount_sol, asset: 'SOL', chain: 'solana', network: agent.network, side: 'buy',
	});

	// ── scheduler ────────────────────────────────────────────────────────────
	function buyPayload(agent, mint) {
		const c = agent.strategy;
		return {
			kind: 'local_strategy_buy', agent_id: agent.id, strategy: c.name || 'local', network: agent.network, mint, side: 'buy',
			amount_sol: c.sizing.amount_sol, slippage_bps: c.sizing.max_slippage_bps,
			max_price_impact_pct: effectivePriceImpactPct(c, null), idempotency_key: `${agent.id}:${mint}`,
		};
	}

	async function sweepEntries(agent) {
		const c = agent.strategy;
		const launches = await feed.launches({ network: agent.network });
		const open = state.positions.filter((p) => p.agent_id === agent.id && p.status === 'open');
		const pending = Object.values(state.approvals).filter((ap) => ap.agent_id === agent.id && effectiveStatus(ap) === 'pending').length;
		let slots = c.risk.max_concurrent_positions - open.length - pending;
		const seen = new Set(state.seen[agent.id] || []);
		const decisions = [];
		for (const launch of launches) {
			if (slots <= 0) break;
			if (seen.has(launch.mint)) continue;
			if (c.risk.cooldown_minutes > 0 && now() - agent.last_cooldown_at < c.risk.cooldown_minutes * 60000) break;
			const verdict = matchesEntry(c, launch, now());
			seen.add(launch.mint);
			decisions.push({ mint: launch.mint, pass: verdict.pass, reasons: verdict.reasons });
			if (!verdict.pass) continue;
			const payload = buyPayload(agent, launch.mint);
			try {
				await act(agent, payload, buyRow(agent, payload, launch.symbol));
				slots -= 1;
			} catch (err) {
				log.warn('entry_failed', { agent: agent.id, mint: launch.mint, err });
			}
		}
		state.seen[agent.id] = [...seen].slice(-500);
		return decisions;
	}

	async function sweepExits(agent) {
		const open = state.positions.filter((p) => p.agent_id === agent.id && p.status === 'open');
		for (const pos of open) {
			const coin = await feed.coin(pos.mint);
			if (!coin) continue;
			const q = quoteSell(coin, pos.tokens);
			pos.peak_value_lamports = Math.max(pos.peak_value_lamports, q.lamports);
			const verdict = shouldExit(agent.strategy, pos, q.lamports, now());
			if (!verdict.exit) continue;
			const payload = { kind: 'local_strategy_sell', agent_id: agent.id, network: agent.network, mint: pos.mint, side: 'sell', position_id: pos.id, reason: verdict.reason, idempotency_key: `${agent.id}:${pos.id}:sell` };
			try {
				await act(agent, payload, { recipient: pos.mint, recipient_label: pos.symbol ? `$${pos.symbol}` : null, amount: q.lamports / 1e9, asset: 'SOL', chain: 'solana', network: agent.network, side: 'sell' });
			} catch (err) {
				log.warn('exit_failed', { agent: agent.id, mint: pos.mint, err });
			}
		}
		persist();
	}

	async function runOrders(agent) {
		for (const order of [...agent.orders]) {
			const coin = await feed.coin(order.mint);
			if (!coin || !(Number(coin.virtual_token_reserves) > 0)) continue;
			const price = Number(coin.virtual_sol_reserves) / 1e9 / (Number(coin.virtual_token_reserves) / 1e6);
			const hit = (order.trigger.price_sol_below && price <= order.trigger.price_sol_below) || (order.trigger.price_sol_above && price >= order.trigger.price_sol_above);
			if (!hit) continue;
			agent.orders = agent.orders.filter((o) => o.id !== order.id);
			persist();
			if (order.side === 'buy') {
				const payload = { ...buyPayload(agent, order.mint), amount_sol: order.amount_sol, kind: 'local_order_buy', idempotency_key: `${agent.id}:${order.id}` };
				await act(agent, payload, buyRow(agent, payload, coin.symbol));
			} else {
				const pos = state.positions.find((x) => x.agent_id === agent.id && x.mint === order.mint && x.status === 'open');
				if (!pos) continue;
				const q = quoteSell(coin, pos.tokens);
				const payload = { kind: 'local_order_sell', agent_id: agent.id, network: agent.network, mint: pos.mint, side: 'sell', position_id: pos.id, reason: 'order', idempotency_key: `${agent.id}:${order.id}` };
				await act(agent, payload, { recipient: pos.mint, recipient_label: pos.symbol ? `$${pos.symbol}` : null, amount: q.lamports / 1e9, asset: 'SOL', chain: 'solana', network: agent.network, side: 'sell' });
			}
		}
	}

	function expireSweep() {
		for (const ap of Object.values(state.approvals)) {
			if (ap.status === 'pending' && ap.expires_at <= now()) decideLocal(ap, 'expired', 'timeout');
		}
		persist();
		for (const a of Object.values(state.agents)) refreshWaiting(a);
	}

	/** One scheduler pass for one agent. Returns what it decided, for logs and tests. */
	async function tickAgent(agent) {
		if (agent.status === 'paused' || agent.status === 'killed') return { skipped: agent.status };
		const wasWaiting = agent.status === 'waiting_approval';
		setStatus(agent, 'working');
		try {
			expireSweep();
			await sweepExits(agent);
			await runOrders(agent);
			const decisions = await sweepEntries(agent);
			for (const au of agent.automations) {
				if (now() - au.last_run_at >= au.every_minutes * 60000) {
					au.last_run_at = now();
					if (au.action === 'expire_sweep') expireSweep();
				}
			}
			agent.last_sweep_at = now();
			const waiting = Object.values(state.approvals).some((ap) => ap.agent_id === agent.id && effectiveStatus(ap) === 'pending');
			setStatus(agent, waiting ? 'waiting_approval' : 'idle', waiting ? agent.detail : null);
			persist();
			return { decisions };
		} catch (err) {
			log.error('tick_failed', { agent: agent.id, err });
			setStatus(agent, 'error', String(err.message || err).slice(0, 200));
			return { error: err.message, wasWaiting };
		}
	}

	let timer = null;
	let ticking = false;
	async function tick() {
		if (ticking) return;
		ticking = true;
		try {
			for (const agent of Object.values(state.agents)) {
				if (agent.status === 'error') setStatus(agent, 'idle');
				await tickAgent(agent);
			}
		} finally {
			ticking = false;
		}
	}

	function start({ intervalMs = 30_000 } = {}) {
		if (timer) return;
		timer = setInterval(() => void tick(), intervalMs);
		timer.unref?.();
		void tick();
	}

	function stop() {
		if (timer) clearInterval(timer);
		timer = null;
	}

	// ── views ────────────────────────────────────────────────────────────────
	function publicAgent(a) {
		const open = state.positions.filter((p) => p.agent_id === a.id && p.status === 'open').length;
		const pending = Object.values(state.approvals).filter((ap) => ap.agent_id === a.id && effectiveStatus(ap) === 'pending').length;
		return {
			id: a.id, name: a.name, mode: a.mode, network: a.network, address: a.address, status: a.status, detail: a.detail,
			strategy: a.strategy, orders: a.orders, automations: a.automations, open_positions: open, pending_approvals: pending,
			last_sweep_at: a.last_sweep_at, created_at: a.created_at,
		};
	}

	/** What the mascot shows: the most urgent state across all agents. */
	function face() {
		const statuses = Object.values(state.agents).map((a) => a.status);
		const order = ['error', 'waiting_approval', 'working', 'idle', 'paused', 'killed'];
		const top = order.find((s) => statuses.includes(s)) || 'none';
		return { state: top, agents: statuses.length };
	}

	return {
		createAgent, pause, resume, kill, remove, addOrder, removeOrder, addAutomation,
		listAgents: () => Object.values(state.agents).map(publicAgent),
		getAgent: (id) => publicAgent(agentOf(id)),
		listApprovals, decide, tick, tickAgent, start, stop, face,
		positions: ({ agentId = null } = {}) => state.positions.filter((p) => !agentId || p.agent_id === agentId),
		receipts: ({ agentId = null, limit = 100 } = {}) => state.receipts.filter((r) => !agentId || r.agent_id === agentId).slice(0, limit),
		exportConfig: () => ({ agents: Object.values(state.agents).map((a) => ({ id: a.id, name: a.name, mode: a.mode, network: a.network, address: a.address, strategy: a.strategy, status: a.status })) }),
		canonicalJson,
	};
}
