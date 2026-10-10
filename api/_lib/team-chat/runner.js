// The coordinator: one plain-language message in, a run of specialist steps out.
//
//   start()    load remembered preferences, build and freeze the plan, persist
//              it, then advance.
//   advance()  under a short lease, run every queued step whose dependencies are
//              settled. A step that would sign, transfer, launch or exceed the
//              cap stops at needs_approval with the exact payload, its hash and
//              the confirmation table. When nothing else can move, the run waits
//              on the owner (awaiting_approval) or finishes with a summary.
//   decide()   the owner's approve or deny. Approve re-checks the payload hash
//              and the plan fingerprint, executes exactly that payload once, and
//              resumes the run. A mirrored step decides through the approval
//              inbox, so a decision from /approvals, push or Telegram resumes the
//              same run through approval-executor.js.
//
// Every state change is an event (persisted, then published to live streams),
// so the chat renders the same story live, after a reload, or from a decision
// taken on another device.
//
// The store, specialists, bridge, squad resolver and preference loader are
// injected, which is how tests/team-chat-escalation.test.js drives this exact
// code against an in-memory store.

import { buildPlan, mintLabel, describeEntryCondition } from './plan.js';
import { planFingerprint, sha256Hex, scanForInjection } from './untrusted.js';
import { memberForRole } from './squad.js';
import { publish } from './bus.js';

export const TERMINAL = Object.freeze(['done', 'failed', 'skipped', 'denied', 'expired']);
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 120_000;
const ROLE_TITLE = { coordinator: 'Coordinator', researcher: 'Researcher', entry: 'Entry', trader: 'Trader', launcher: 'Launcher' };

function shortAddr(a) {
	const s = String(a || '');
	return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

function fmtSol(v) {
	const n = Number(v);
	return Number.isFinite(n) ? `${n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 4 : 6 })} SOL` : 'n/a';
}

function chainLabel(network) {
	return network === 'devnet' ? 'Solana devnet' : 'Solana mainnet';
}

// Owners paste coin pages into chat. When part of a message reads like orders
// aimed at an AI, say so: the plan holds only the steps listed, and anything
// that moves funds still stops for an approval that names the recipient.
function pastedTextNote(text, steps) {
	if (!scanForInjection(text).suspicious) return [];
	const moves = steps.some((s) => s.kind === 'transfer' || s.kind === 'trade');
	return [`Part of your message reads like instructions aimed at an AI, often pasted from a coin page. I only planned the steps listed below${moves ? ', and anything that moves funds still waits for your approval' : ''}.`];
}

/** The owner-facing view of one step row. */
export function publicStep(row) {
	const a = row.approval;
	return {
		id: row.id,
		key: row.step_key,
		idx: row.idx,
		role: row.role,
		role_title: ROLE_TITLE[row.role] || row.role,
		kind: row.kind,
		title: row.title,
		params: row.params,
		depends_on: row.depends_on || [],
		agent_id: row.agent_id,
		status: row.status,
		evidence: row.evidence || {},
		result: row.result || null,
		approval: a
			? {
				action: a.payload?.action,
				payload: a.payload,
				payload_hash: a.payload_hash,
				summary: a.summary,
				table: a.table,
				gate_reasons: a.gate_reasons,
				risk_notes: a.risk_notes,
				expires_at: a.expires_at,
				mirrored: Boolean(row.approval_request_id),
				inbox_url: a.inbox_url || null,
				handoff_url: a.handoff_url || null,
			}
			: null,
		error: row.error,
		started_at: row.started_at,
		finished_at: row.finished_at,
	};
}

/** The deterministic end-of-run report: one line per specialist step. No model writes it. */
export function summarizeRun(steps) {
	const lines = steps.map((s) => {
		const text = s.status === 'done'
			? s.result?.summary || s.evidence?.summary || s.title
			: s.status === 'needs_approval'
				? `Waiting for your approval: ${s.approval?.summary || s.title}`
				: s.status === 'skipped'
					? `Skipped: ${s.error || 'its preconditions were not met.'}`
					: s.status === 'denied'
						? 'You declined this step. Nothing was signed.'
						: s.status === 'expired'
							? 'The approval window closed. Nothing was signed; ask again for a fresh quote.'
							: s.status === 'failed'
								? `Failed: ${s.error || 'unknown error'}`
								: s.title;
		return { step_id: s.id, key: s.step_key, role: s.role, role_title: ROLE_TITLE[s.role] || s.role, title: s.title, status: s.status, text: String(text).slice(0, 400), receipt: s.result?.receipt || null };
	});
	const count = (st) => steps.filter((s) => s.status === st).length;
	const parts = [];
	if (count('done')) parts.push(`${count('done')} done`);
	if (count('needs_approval')) parts.push(`${count('needs_approval')} waiting for you`);
	if (count('skipped')) parts.push(`${count('skipped')} skipped`);
	if (count('failed')) parts.push(`${count('failed')} failed`);
	if (count('denied')) parts.push(`${count('denied')} declined`);
	if (count('expired')) parts.push(`${count('expired')} expired`);
	return { headline: `${steps.length} step${steps.length === 1 ? '' : 's'}: ${parts.join(', ') || 'nothing ran'}.`, lines };
}

function tokenLabel(mint) {
	const label = mintLabel(mint);
	return label.startsWith('$') ? `${label} (${shortAddr(mint)})` : shortAddr(mint);
}

/** Build the approval for a quoted trade. The payload is exactly what executes. */
export function buildTradeApproval({ run, squad, step, quoted, cap, requested, riskNotes = [] }) {
	const p = step.params;
	const isBuy = p.side === 'buy';
	const gate = ['signs'];
	if (isBuy && cap != null && requested > cap) gate.push('exceeds_cap');
	const payload = {
		action: 'trade',
		side: p.side,
		mint: p.mint,
		amount: quoted.amount,
		amount_unit: isBuy ? 'SOL' : quoted.amount === 'max' ? 'max' : 'token',
		slippage_bps: quoted.slippage_bps,
		network: run.network,
		mode: run.mode,
		agent_id: squad.policy_agent_id,
		squad_id: squad.id,
		run_id: run.id,
		step_id: step.id,
	};
	const q = quoted.quote;
	const wallet = q?.wallet_address || quoted.agent?.meta?.solana_address || null;
	const amountText = isBuy ? fmtSol(quoted.amount) : quoted.amount === 'max' ? `All ${mintLabel(p.mint)} held` : `${Number(quoted.amount).toLocaleString('en-US')} ${mintLabel(p.mint)}`;
	const table = [
		{ label: 'Action', value: `${isBuy ? 'Buy' : 'Sell'} ${mintLabel(p.mint)}` },
		{ label: 'Amount', value: amountText + (q?.usd_value ? ` (~$${Number(q.usd_value).toFixed(2)})` : '') },
		{ label: 'Token', value: tokenLabel(p.mint), full: p.mint },
		{ label: isBuy ? 'Tokens go to' : 'SOL goes to', value: wallet ? `${squad.name} Trader wallet (${shortAddr(wallet)})` : `${squad.name} Trader wallet (created on first trade)`, full: wallet },
		{ label: 'Chain', value: chainLabel(run.network) },
		{ label: 'Mode', value: run.mode === 'live' ? 'Live: signs from the Trader wallet' : 'Paper: simulated against the live quote, never signs' },
	];
	if (q?.venue) table.push({ label: 'Venue', value: q.venue });
	if (q && isBuy && q.expected_tokens_out != null) table.push({ label: 'Expected out', value: `${Number(q.expected_tokens_out).toLocaleString('en-US', { maximumFractionDigits: 2 })} tokens` });
	if (q && !isBuy && q.expected_sol_out != null) table.push({ label: 'Expected out', value: fmtSol(q.expected_sol_out) });
	if (q?.price_impact_pct != null) table.push({ label: 'Price impact', value: `${Number(q.price_impact_pct).toFixed(2)}%` });
	table.push({ label: 'Max slippage', value: `${(quoted.slippage_bps / 100).toFixed(2)}%` });
	if (q?.platform_fee?.amount_sol != null) table.push({ label: 'Platform fee', value: fmtSol(q.platform_fee.amount_sol) });

	const notes = [...riskNotes];
	if (gate.includes('exceeds_cap')) notes.unshift(`You asked for ${fmtSol(requested)}; the per-trade cap is ${fmtSol(cap)}, so this approval is for the cap.`);
	if (quoted.note) notes.push(quoted.note);
	const summary = `${isBuy ? 'Buy' : 'Sell'} ${amountText} ${isBuy ? `of ${mintLabel(p.mint)} ` : ''}on ${chainLabel(run.network)} (${run.mode === 'live' ? 'live' : 'paper'})`;
	return {
		payload,
		payload_hash: sha256Hex(payload),
		summary,
		table,
		gate_reasons: gate,
		risk_notes: notes.slice(0, 8),
		amount_usd: q?.usd_value ?? null,
		token_label: mintLabel(p.mint),
		wallet,
		expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
	};
}

/** Build the approval for a standing conditional order (live mode, condition not met yet). */
export function buildOrderApproval({ run, squad, step, condition, amount, slippageBps, cap, requested, wallet }) {
	const p = step.params;
	const isBuy = p.side === 'buy';
	const gate = ['signs'];
	if (isBuy && cap != null && requested > cap) gate.push('exceeds_cap');
	const orderExpires = new Date(Date.now() + ORDER_TTL_MS).toISOString();
	const payload = {
		action: 'order',
		side: p.side,
		mint: p.mint,
		amount,
		amount_unit: isBuy ? 'SOL' : amount === 'max' ? 'max' : 'token',
		slippage_bps: slippageBps,
		condition,
		order_expires_at: orderExpires,
		network: run.network,
		mode: 'live',
		agent_id: squad.policy_agent_id,
		squad_id: squad.id,
		run_id: run.id,
		step_id: step.id,
	};
	const amountText = isBuy ? fmtSol(amount) : amount === 'max' ? `All ${mintLabel(p.mint)} held` : `${Number(amount).toLocaleString('en-US')} ${mintLabel(p.mint)}`;
	const table = [
		{ label: 'Action', value: `Standing order: ${isBuy ? 'buy' : 'sell'} when ${describeEntryCondition(condition)}` },
		{ label: 'Amount', value: amountText },
		{ label: 'Token', value: tokenLabel(p.mint), full: p.mint },
		{ label: isBuy ? 'Tokens go to' : 'SOL goes to', value: wallet ? `${squad.name} Trader wallet (${shortAddr(wallet)})` : `${squad.name} Trader wallet`, full: wallet },
		{ label: 'Chain', value: chainLabel(run.network) },
		{ label: 'Mode', value: 'Live: the order worker signs from the Trader wallet when the condition holds' },
		{ label: 'Expires', value: '24 hours after you approve' },
		{ label: 'Max slippage', value: `${(slippageBps / 100).toFixed(2)}%` },
	];
	const notes = ['The entry condition is not met yet, so the Trader proposes a standing order instead of buying now.'];
	if (gate.includes('exceeds_cap')) notes.unshift(`You asked for ${fmtSol(requested)}; the per-trade cap is ${fmtSol(cap)}, so this order is for the cap.`);
	return {
		payload,
		payload_hash: sha256Hex(payload),
		summary: `Standing ${isBuy ? 'buy' : 'sell'} of ${amountText}${isBuy ? ` of ${mintLabel(p.mint)}` : ''} when ${describeEntryCondition(condition)}`,
		table,
		gate_reasons: gate,
		risk_notes: notes,
		amount_usd: null,
		token_label: mintLabel(p.mint),
		wallet,
		expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
	};
}

function buildHandoffApproval({ run, squad, step, action, table, summary, handoffUrl, extra = {} }) {
	const payload = { action, ...extra, network: run.network, squad_id: squad.id, run_id: run.id, step_id: step.id, handoff_url: handoffUrl };
	return {
		payload,
		payload_hash: sha256Hex(payload),
		summary,
		table,
		gate_reasons: [action === 'launch' ? 'launches' : 'transfers'],
		risk_notes: ['Approving opens the page where you review and sign this yourself. The coordinator never signs it.'],
		handoff_url: handoffUrl,
		expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
	};
}

/**
 * @param {object} deps
 * @param {object} deps.store         createSqlStore() or createMemoryStore()
 * @param {object} deps.specialists   the specialists.js module (or a test double)
 * @param {object|null} deps.bridge   createApprovalsBridge(), or null for chat-only approvals
 * @param {Function} deps.resolveSquad (id, userId) => squad
 * @param {Function} deps.loadPrefs   (agentId, squadId) => { values, entries }
 * @param {string} deps.userId
 * @param {object} [deps.req]
 * @param {boolean} [deps.useModel]   let the model propose a plan (validated either way)
 */
export function createRunner({ store, specialists, bridge = null, resolveSquad, loadPrefs, userId, req = null, useModel = true }) {
	async function emit(runId, stepId, kind, payload) {
		const ev = await store.appendEvent(runId, stepId, kind, payload);
		publish(runId, ev);
		return ev;
	}

	async function emitStep(row) {
		return emit(row.run_id, row.id, 'step', { step: publicStep(row) });
	}

	function failMessage(e, role) {
		if (e?.isStepError) return { code: e.code, message: e.message, detail: e.detail || null };
		console.error('[team-chat] step failed', e?.stack || e?.message);
		return { code: 'internal_error', message: `The ${ROLE_TITLE[role] || role} hit an unexpected error. Nothing was signed.`, detail: null };
	}

	// ── start ──────────────────────────────────────────────────────────────────

	async function start({ squad, utterance, mode = 'paper', onCreated = null }) {
		const text = String(utterance || '').trim().slice(0, 2000);
		const prefs = await loadPrefs(squad.policy_agent_id, squad.id);
		const built = await buildPlan(text, { prefs: prefs.values, useModel, track: { userId, agentId: squad.policy_agent_id, tool: 'team-chat-plan' } });
		const steps = built.steps.map((s) => ({ ...s, agent_id: memberForRole(squad, s.role)?.agent_id || squad.policy_agent_id }));
		const plan = {
			steps: steps.map(({ key, kind, role, title, params, depends_on }) => ({ key, kind, role, title, params, depends_on })),
			notes: [...(built.notes || []), ...pastedTextNote(text, steps)],
			clarify: built.clarify || null,
			planner: built.planner,
			prefs: prefs.values,
		};
		plan.fingerprint = planFingerprint(plan);
		const run = await store.createRun({ userId, squad, utterance: text, mode: mode === 'live' ? 'live' : 'paper', plan, planner: built.planner });
		if (onCreated) await onCreated(run);
		const rows = await store.insertSteps(run.id, steps);
		await emit(run.id, null, 'run', { status: run.status, mode: run.mode, network: run.network, utterance: text, created_at: run.created_at });
		await emit(run.id, null, 'memory', { entries: prefs.entries });
		await emit(run.id, null, 'plan', { steps: rows.map(publicStep), notes: plan.notes, clarify: plan.clarify, planner: plan.planner });
		if (!rows.length) {
			await store.updateRun(run.id, { status: 'done', summary: { headline: plan.clarify || 'Nothing to do.', lines: [] } });
			await emit(run.id, null, 'summary', { status: 'done', headline: plan.clarify || 'Nothing to do.', lines: [], clarify: true });
			return { run: await store.getRunById(run.id), squad };
		}
		await advance(run.id, { squad });
		return { run: await store.getRunById(run.id), squad };
	}

	// ── advance ────────────────────────────────────────────────────────────────

	async function expireStale(run, steps) {
		const now = Date.now();
		let changed = false;
		for (const s of steps) {
			if (s.status !== 'needs_approval' || !s.approval?.expires_at) continue;
			if (new Date(s.approval.expires_at).getTime() > now) continue;
			const row = await store.claimStep(s.id, ['needs_approval'], 'expired', { error: 'The approval window closed before a decision. Nothing was signed.' });
			if (row) {
				changed = true;
				await emitStep(row);
			}
		}
		return changed;
	}

	async function syncInbox(steps) {
		if (!bridge) return false;
		const mirrored = steps.filter((s) => s.status === 'needs_approval' && s.approval_request_id);
		if (!mirrored.length) return false;
		const statuses = await bridge.statuses(mirrored.map((s) => s.approval_request_id));
		let changed = false;
		for (const s of mirrored) {
			const st = statuses.get(s.approval_request_id);
			if (st !== 'denied' && st !== 'expired') continue;
			const row = await store.claimStep(s.id, ['needs_approval'], st, { error: st === 'denied' ? 'Declined from the approval inbox. Nothing was signed.' : 'The approval expired in the inbox. Nothing was signed.' });
			if (row) {
				changed = true;
				await emitStep(row);
			}
		}
		return changed;
	}

	async function finalize(run, steps) {
		const open = steps.filter((s) => !TERMINAL.includes(s.status));
		if (!open.length) {
			const summary = summarizeRun(steps);
			const allFailed = steps.every((s) => s.status === 'failed');
			const status = allFailed ? 'failed' : 'done';
			if (run.status !== status) {
				await store.updateRun(run.id, { status, summary });
				await emit(run.id, null, 'summary', { status, ...summary });
			}
			return status;
		}
		const waiting = open.every((s) => s.status === 'needs_approval');
		if (waiting && run.status !== 'awaiting_approval') {
			const summary = summarizeRun(steps);
			await store.updateRun(run.id, { status: 'awaiting_approval', summary });
			await emit(run.id, null, 'summary', { status: 'awaiting_approval', ...summary });
			return 'awaiting_approval';
		}
		if (!waiting && run.status === 'awaiting_approval') {
			await store.updateRun(run.id, { status: 'running' });
			await emit(run.id, null, 'run', { status: 'running', mode: run.mode, network: run.network });
		}
		return waiting ? 'awaiting_approval' : 'running';
	}

	async function advance(runId, { squad = null } = {}) {
		if (!(await store.lockRun(runId, LEASE_MS))) return { locked: true };
		try {
			let run = await store.getRunById(runId);
			if (!run || run.user_id !== userId) return { missing: true };
			const sq = squad || (await resolveSquad(run.squad_id, userId));
			if (!sq) {
				await store.updateRun(runId, { status: 'failed' });
				await emit(runId, null, 'error', { code: 'squad_missing', message: 'This squad no longer exists or is no longer yours.' });
				return { status: 'failed' };
			}
			for (let guard = 0; guard < 40; guard++) {
				run = await store.getRunById(runId);
				if (['done', 'failed', 'cancelled'].includes(run.status)) break;
				let steps = await store.getSteps(runId);
				if ((await expireStale(run, steps)) | (await syncInbox(steps))) steps = await store.getSteps(runId);
				const byKey = new Map(steps.map((s) => [s.step_key, s]));
				const ready = steps.filter((s) => s.status === 'queued' && (s.depends_on || []).every((k) => TERMINAL.includes(byKey.get(k)?.status)));
				if (!ready.length) break;
				for (const step of ready) await runStep(run, sq, step, steps);
			}
			run = await store.getRunById(runId);
			const status = await finalize(run, await store.getSteps(runId));
			return { status };
		} finally {
			await store.unlockRun(runId);
		}
	}

	// ── one step ───────────────────────────────────────────────────────────────

	async function runStep(run, squad, step, steps) {
		const started = await store.claimStep(step.id, ['queued'], 'running');
		if (!started) return;
		await emitStep(started);
		const ctx = { squad, step: started, userId, req, run };
		try {
			switch (step.kind) {
				case 'remember': {
					const out = await specialists.remember(ctx);
					await finish(started, out);
					const prefs = await loadPrefs(squad.policy_agent_id, squad.id);
					await emit(run.id, null, 'memory', { entries: prefs.entries, saved: out.evidence?.memory?.key || null });
					return;
				}
				case 'answer':
					await finish(started, { verdict: 'answered', summary: String(step.params?.text || '').slice(0, 400), evidence: {} });
					return;
				case 'research':
					await finish(started, await specialists.research(ctx));
					return;
				case 'entry_check':
					await finish(started, await specialists.entryCheck(ctx));
					return;
				case 'strategy':
					await finish(started, await specialists.draftStrategy(ctx));
					return;
				case 'launch':
					await launchGate(run, squad, started, await specialists.prepareLaunch(ctx));
					return;
				case 'transfer':
					await transferGate(run, squad, started, await specialists.prepareTransfer(ctx));
					return;
				case 'trade':
					await tradeGate(run, squad, started, steps);
					return;
				default:
					await settle(started, 'skipped', { error: `Unknown step kind "${step.kind}".` });
			}
		} catch (e) {
			const f = failMessage(e, step.role);
			await settle(started, 'failed', { error: f.message, evidence: { ...(started.evidence || {}), error_code: f.code, error_detail: f.detail } });
		}
	}

	async function finish(step, out) {
		await settle(step, 'done', { evidence: { ...(out.evidence || {}), verdict: out.verdict, summary: out.summary }, result: { verdict: out.verdict, summary: out.summary } });
	}

	async function settle(step, status, patch) {
		const row = await store.claimStep(step.id, [step.status], status, patch);
		if (row) await emitStep(row);
		return row;
	}

	async function pause(run, squad, step, approval, evidence) {
		const row = await store.claimStep(step.id, ['running'], 'needs_approval', { approval, evidence });
		if (!row) return;
		await emitStep(row);
		await emit(run.id, row.id, 'approval', { step_id: row.id, approval: publicStep(row).approval });
		if (!bridge || !(await bridge.shouldMirror(approval, run))) return;
		let mirrored;
		try {
			mirrored = await bridge.mirror({ userId, squad, run, step: row, approval });
		} catch (e) {
			console.warn('[team-chat] inbox mirror failed; approval stays in the chat', e?.message);
			return;
		}
		if (!mirrored?.request) return;
		await store.setApprovalRequestId(row.id, mirrored.request.id);
		const inboxUrl = await bridge.link(mirrored.request);
		const linked = await store.claimStep(row.id, ['needs_approval'], 'needs_approval', { approval: { ...approval, inbox_url: inboxUrl } });
		if (linked) await emitStep(linked);
		if (mirrored.autoApproved) {
			await emit(run.id, row.id, 'note', { text: 'Your auto-approve policy covers this trade, so the Trader is executing it now.' });
			await bridge.runAuto(mirrored.request, (claim) => executeApprovedStep(row.id, { inboxRow: claim }));
		}
	}

	async function tradeGate(run, squad, step, steps) {
		const p = step.params;
		const deps = steps.filter((s) => (step.depends_on || []).includes(s.step_key));
		const current = new Map((await store.getSteps(run.id)).map((s) => [s.id, s]));
		const research = deps.map((d) => current.get(d.id)).find((d) => d?.kind === 'research');
		const entry = deps.map((d) => current.get(d.id)).find((d) => d?.kind === 'entry_check');
		const riskNotes = [];

		if (p.side === 'buy') {
			if (!research || research.status !== 'done') {
				await settle(step, 'skipped', { error: 'There is no research verdict for this coin to cite, so the Trader will not buy it.' });
				return;
			}
			const verdict = research.evidence?.verdict;
			if (research.evidence?.risk_note) riskNotes.push(research.evidence.risk_note);
			if (verdict === 'avoid') {
				await settle(step, 'skipped', { error: 'Research says avoid this coin, so the Trader will not buy it.' });
				return;
			}
			if (verdict === 'caution') {
				const allowed = squad.kind === 'team' ? squad.policy?.allow_caution === true : run.plan?.prefs?.risk !== 'low';
				if (!allowed) {
					const why = squad.kind === 'team' ? 'the team only trades on a pass' : 'your remembered risk preference is low';
					await settle(step, 'skipped', { error: `Research flagged caution and ${why}, so the Trader will not buy it.` });
					return;
				}
				riskNotes.push('Research flagged caution on this coin.');
			}
		}

		const condition = entry?.params?.condition || null;
		const agent = await specialists.loadPolicyAgent(squad, userId);
		const cap = specialists.tradeCapSol(squad, agent.meta);
		const requested = p.side === 'buy' ? Number(p.amount) : null;
		const amount = p.side === 'buy' && cap != null && requested > cap ? cap : p.amount;

		if (condition && entry?.status !== 'done') {
			await settle(step, 'skipped', { error: 'The entry check could not run, so the Trader cannot confirm your condition.' });
			return;
		}
		if (condition && entry.evidence?.verdict !== 'met') {
			const why = entry.evidence?.verdict === 'unknown' ? 'could not be confirmed from live data' : 'is not met yet';
			if (run.mode !== 'live') {
				await settle(step, 'skipped', { error: `Your entry condition ${why}, so there was nothing to simulate. In live mode the Trader proposes a standing order that fires when it holds.` });
				return;
			}
			const sellAmount = p.side === 'sell' ? (p.amount_unit === 'max' || p.amount_unit === 'percent' ? (Number(p.amount) >= 100 || p.amount_unit === 'max' ? 'max' : null) : Number(p.amount)) : null;
			if (p.side === 'sell' && sellAmount == null) {
				await settle(step, 'skipped', { error: `Your condition ${why}. A standing sell needs an exact token count or "all".` });
				return;
			}
			const approval = buildOrderApproval({ run, squad, step, condition, amount: p.side === 'buy' ? amount : sellAmount, slippageBps: p.slippage_bps, cap, requested, wallet: agent.meta.solana_address || null });
			approval.risk_notes.push(...riskNotes);
			await pause(run, squad, step, approval, { ...(step.evidence || {}), summary: approval.summary, cap_sol: cap });
			return;
		}

		const quoted = await specialists.quoteTrade({ squad, step, userId, amount, req });
		if (quoted.quote && quoted.quote.allowed === false) {
			const reason = quoted.quote.blocked_reason?.message || 'the spend guard would block it';
			await settle(step, 'failed', { error: `The spend guard stopped this trade before it reached you: ${reason}`, evidence: { quote: quoted.quote, cap_sol: cap } });
			return;
		}
		const approval = buildTradeApproval({ run, squad, step, quoted, cap, requested, riskNotes });
		await pause(run, squad, step, approval, { quote: quoted.quote, cap_sol: cap, summary: approval.summary });
	}

	async function launchGate(run, squad, step, out) {
		const ev = { ...(out.evidence || {}), verdict: out.verdict, summary: out.summary };
		if (out.verdict !== 'ready' || !out.evidence?.launch_url) {
			await settle(step, 'done', { evidence: ev, result: { verdict: out.verdict, summary: out.summary } });
			return;
		}
		const plan = out.evidence.plan;
		const table = [
			{ label: 'Action', value: `Launch ${plan.name} ($${plan.symbol})` },
			{ label: 'Signer', value: 'You, in your own wallet, on the launchpad' },
			{ label: 'Initial buy', value: plan.initial_buy_sol ? `${fmtSol(plan.initial_buy_sol)} (you confirm it on the launchpad)` : 'None unless you add one on the launchpad' },
			{ label: 'Chain', value: chainLabel(run.network) },
		];
		const approval = buildHandoffApproval({ run, squad, step, action: 'launch', table, summary: `Launch ${plan.name} ($${plan.symbol}) on ${chainLabel(run.network)}`, handoffUrl: out.evidence.launch_url, extra: { name: plan.name, symbol: plan.symbol } });
		await pause(run, squad, step, approval, ev);
	}

	async function transferGate(run, squad, step, out) {
		const e = out.evidence;
		const table = [
			{ label: 'Recipient', value: e.recipient.endsWith('.sol') ? e.recipient : shortAddr(e.recipient), full: e.recipient },
			{ label: 'Amount', value: `${e.amount} ${e.asset}` },
			{ label: 'Asset', value: e.asset },
			{ label: 'Chain', value: chainLabel(run.network) },
			{ label: 'From', value: e.from ? `${squad.name} Trader wallet (${shortAddr(e.from)})` : `${squad.name} Trader wallet` },
		];
		const approval = buildHandoffApproval({ run, squad, step, action: 'transfer', table, summary: `Send ${e.amount} ${e.asset} to ${e.recipient.endsWith('.sol') ? e.recipient : shortAddr(e.recipient)}`, handoffUrl: e.handoff_url, extra: { amount: e.amount, asset: e.asset, recipient: e.recipient } });
		await pause(run, squad, step, approval, { ...e, verdict: out.verdict, summary: out.summary });
	}

	// ── approval execution ─────────────────────────────────────────────────────

	/**
	 * Execute an approved step exactly once. Called by decide() for a chat-only
	 * approval and by the inbox executor for a mirrored one. Returns the inbox
	 * executor contract: { status: 'ok'|'error', signature?, note? }.
	 */
	async function executeApprovedStep(stepId, { inboxRow = null } = {}) {
		const step = await store.getStep(stepId);
		if (!step) return { status: 'error', note: 'The chat step for this approval no longer exists. Nothing was executed.' };
		const run = await store.getRunById(step.run_id);
		if (!run || run.user_id !== userId || (inboxRow && inboxRow.user_id !== run.user_id)) {
			return { status: 'error', note: 'This approval does not belong to this account. Nothing was executed.' };
		}
		const a = step.approval;
		const integrity = a && a.payload && a.payload_hash === sha256Hex(a.payload)
			&& a.payload.step_id === step.id && a.payload.run_id === run.id
			&& (!inboxRow || inboxRow.payload_hash === a.payload_hash)
			&& run.plan?.fingerprint === planFingerprint(run.plan);
		if (!integrity) {
			const row = await store.claimStep(step.id, ['needs_approval'], 'failed', { error: 'The approved action no longer matches the plan you saw. Nothing was executed.' });
			if (row) await emitStep(row);
			return { status: 'error', note: 'Integrity check failed. Nothing was executed.', integrity: false };
		}
		if (!inboxRow && new Date(a.expires_at).getTime() <= Date.now()) {
			const row = await store.claimStep(step.id, ['needs_approval'], 'expired', { error: 'The approval window closed before a decision. Nothing was signed.' });
			if (row) await emitStep(row);
			return { status: 'error', note: 'expired' };
		}
		const claimed = await store.claimStep(step.id, ['needs_approval'], 'executing');
		if (!claimed) return { status: 'skipped', note: `This step is already ${step.status}.` };
		await emitStep(claimed);

		const squad = await resolveSquad(run.squad_id, userId);
		if (!squad) {
			const row = await store.claimStep(step.id, ['executing'], 'failed', { error: 'This squad no longer exists. Nothing was executed.' });
			if (row) await emitStep(row);
			return { status: 'error', note: 'squad missing' };
		}
		const payload = a.payload;
		try {
			let result;
			if (payload.action === 'trade') {
				const { receipt } = await specialists.executeTrade({ squad, payload, userId, req });
				const verb = payload.side === 'buy' ? 'Bought' : 'Sold';
				const summary = receipt.simulated
					? `Simulated: ${payload.side} ${payload.side === 'buy' ? fmtSol(payload.amount) : payload.amount === 'max' ? 'the whole position' : `${payload.amount} tokens`} of ${mintLabel(payload.mint)} through the full trade pipeline. Nothing was signed.`
					: `${verb} ${payload.side === 'buy' ? fmtSol(payload.amount) : payload.amount === 'max' ? 'the whole position' : `${payload.amount} tokens`} of ${mintLabel(payload.mint)}.`;
				result = { verdict: receipt.simulated ? 'simulated' : 'executed', summary, receipt };
			} else if (payload.action === 'order') {
				const { receipt } = await specialists.placeConditionalOrder({ squad, payload, userId });
				result = { verdict: 'order_placed', summary: `Placed a standing order: ${a.summary}. It fires inside your spend guards when the condition holds.`, receipt };
			} else {
				result = { verdict: 'handed_off', summary: payload.action === 'launch' ? 'Opened the launchpad with your coin plan. You sign the launch there.' : 'Opened the agent wallet with this send. You confirm and sign it there.', receipt: { handoff_url: payload.handoff_url } };
			}
			const done = await store.claimStep(step.id, ['executing'], 'done', { result, evidence: { ...(step.evidence || {}), verdict: result.verdict, summary: result.summary } });
			if (done) await emitStep(done);
			return { status: 'ok', signature: result.receipt?.signature || null, note: result.summary.slice(0, 240) };
		} catch (e) {
			const f = failMessage(e, step.role);
			const row = await store.claimStep(step.id, ['executing'], 'failed', { error: f.message, evidence: { ...(step.evidence || {}), error_code: f.code, error_detail: f.detail } });
			if (row) await emitStep(row);
			return { status: 'error', note: f.message.slice(0, 240) };
		}
	}

	/**
	 * The owner's decision on a paused step. Returns the refreshed step.
	 * Throws { status, code, message } on a stale hash or a step that is not paused.
	 */
	async function decide({ stepId, decision, payloadHash }) {
		const step = await store.getStep(stepId);
		const run = step ? await store.getRunById(step.run_id) : null;
		if (!step || !run || run.user_id !== userId) throw Object.assign(new Error('That step was not found.'), { status: 404, code: 'not_found' });
		if (step.status !== 'needs_approval') {
			return { step: publicStep(step), idempotent: true };
		}
		if (decision === 'approve' && payloadHash !== step.approval?.payload_hash) {
			throw Object.assign(new Error('The action on file differs from the one you approved, so nothing was executed. Reload and review it again.'), { status: 409, code: 'payload_mismatch' });
		}

		if (step.approval_request_id && bridge) {
			try {
				await bridge.decide({ userId, approvalRequestId: step.approval_request_id, decision, payloadHash, req });
			} catch (e) {
				if (e?.code === 'expired') {
					const row = await store.claimStep(step.id, ['needs_approval'], 'expired', { error: e.message });
					if (row) await emitStep(row);
				} else if (e?.code === 'already_denied' || e?.code === 'already_decided') {
					await syncInbox([step]);
				} else {
					throw e;
				}
			}
			if (decision === 'deny') {
				const row = await store.claimStep(step.id, ['needs_approval'], 'denied', { error: 'You declined this step. Nothing was signed.' });
				if (row) await emitStep(row);
			}
		} else if (decision === 'approve') {
			await executeApprovedStep(step.id);
		} else {
			const row = await store.claimStep(step.id, ['needs_approval'], 'denied', { error: 'You declined this step. Nothing was signed.' });
			if (row) await emitStep(row);
		}
		await advance(run.id);
		return { step: publicStep(await store.getStep(step.id)), idempotent: false };
	}

	/** Pick up decisions taken elsewhere and continue whatever can move. */
	async function refresh(runId) {
		return advance(runId);
	}

	return { start, advance, refresh, decide, executeApprovedStep, emit };
}
