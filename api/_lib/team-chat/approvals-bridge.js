// Bridge between coordinator steps and the approval inbox (api/_lib/approvals.js).
//
// A live trade or standing order the chat pauses on is mirrored into the inbox
// as a `team_chat` request, so the owner can answer it from /approvals, a push
// notification, Telegram or email, and any of those resumes the same run (the
// inbox runs EXECUTORS.team_chat, which is approval-executor.js). The step and
// the inbox row carry the same payload and the same hash; the runner refuses to
// execute when they differ.
//
// Paper trades never sign, and launch and transfer approvals hand the owner a
// page where they sign themselves, so those stay in the chat. When the inbox is
// not installed (no approval_requests table, or no team_chat executor), every
// approval stays in the chat and works the same way.

import { sql } from '../db.js';

const MIRRORED_ACTIONS = new Set(['trade', 'order']);

let inboxReady = null;
async function inbox() {
	if (inboxReady === false) return null;
	try {
		const mod = await import('../approvals.js');
		if (!mod.hasExecutor('team_chat') || !mod.VENUES?.team_trade) {
			inboxReady = false;
			return null;
		}
		if (inboxReady !== true) {
			const [row] = await sql`select to_regclass('public.approval_requests') is not null as ok`;
			inboxReady = Boolean(row?.ok);
			if (!inboxReady) return null;
		}
		return mod;
	} catch {
		inboxReady = false;
		return null;
	}
}

export function createApprovalsBridge() {
	return {
		/** Whether this approval should live in the inbox too. */
		async shouldMirror(approval, run) {
			return run.mode === 'live' && MIRRORED_ACTIONS.has(approval.payload.action) && Boolean(await inbox());
		},

		/**
		 * Create (or find) the inbox row for a paused step.
		 * @returns {Promise<{ request: object, autoApproved: boolean } | null>}
		 */
		async mirror({ userId, squad, run, step, approval }) {
			const mod = await inbox();
			if (!mod) return null;
			const p = approval.payload;
			const ttlMs = Math.max(60_000, new Date(approval.expires_at).getTime() - Date.now());
			const isBuy = p.side === 'buy';
			const out = await mod.createApprovalRequest({
				userId,
				agentId: p.agent_id,
				teamId: squad.kind === 'team' ? squad.id : null,
				requesterRole: step.role,
				source: 'team_chat',
				sourceRef: step.id,
				actionType: p.action === 'order' ? `conditional_${p.side}` : p.side,
				venue: 'team_trade',
				payload: p,
				summary: approval.summary,
				amount: isBuy ? p.amount : p.amount === 'max' ? null : Number(p.amount),
				amountUsd: approval.amount_usd ?? null,
				asset: isBuy ? 'SOL' : approval.token_label,
				chain: 'solana',
				network: run.network,
				recipient: approval.wallet || null,
				recipientLabel: approval.wallet ? `${squad.name} Trader wallet` : null,
				riskNotes: approval.risk_notes,
				gateReason: approval.gate_reasons.join(', '),
				idempotencyKey: `team_chat:${step.id}`,
				ttlMs,
				autoApprovable: true,
			});
			return { request: out.request, autoApproved: out.autoApproved };
		},

		/** Run an auto-approved inbox row through the inline executor, exactly once. */
		async runAuto(request, run) {
			const mod = await inbox();
			return mod.runApproved(request, run);
		},

		/** Decide a mirrored step through the inbox, which runs EXECUTORS.team_chat on approve. */
		async decide({ userId, approvalRequestId, decision, payloadHash, req }) {
			const mod = await inbox();
			if (!mod) return null;
			return mod.decideApproval({ userId, id: approvalRequestId, decision, payloadHash, via: 'web', req });
		},

		/** The inbox status of mirrored rows, keyed by id, for decisions taken elsewhere. */
		async statuses(ids) {
			if (!ids.length) return new Map();
			const mod = await inbox();
			if (!mod) return new Map();
			const rows = await sql`select id, status, expires_at from approval_requests where id = any(${ids}::uuid[])`;
			return new Map(rows.map((r) => [r.id, mod.effectiveStatus(r)]));
		},

		/** The inbox deep link for a mirrored row. */
		async link(request) {
			const mod = await inbox();
			return mod ? mod.approvalPath(request) : null;
		},
	};
}
