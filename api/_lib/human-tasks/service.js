// Human-task marketplace: every business rule in one place. The REST routes
// (api/human-tasks/[...route].js), the MCP tools (api/_mcpagent/human-task-tools.js)
// and the sweep cron are thin adapters over these functions.
//
// Money moves in exactly four places, each guarded:
//   postTask      locks bounty + fee in the task's escrow from the poster agent's
//                 wallet, under that agent's spend limits (needs confirm + a quote)
//   approveTask   releases the escrow to the worker and the fee wallet (needs
//                 confirm + a preview the poster saw)
//   cancelTask / expiry / dispute decided for the poster   refund the escrow
//
// Every status change is a compare-and-set on the status that was read
// (state.js), and every on-chain leg goes through the exactly-once leg sender
// (chain.js), so concurrent actors and crashed workers can neither double-pay
// nor skip a payment.

import { randomUUID } from 'node:crypto';

import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { insertNotification } from '../notify.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { transferUsdcGuarded } from '../agent-usdc-transfer.js';
import { resolveMarketplacePayer } from '../solana/gasless-tx.js';
import { getFeeBps } from '../fee.js';
import { presignGet, presignUpload, headObject } from '../r2.js';
import { feeRecipient } from '../agent-market/settlement.js';
import { getSolanaAddressBalances } from '../agent-wallet.js';
import {
	TERMINAL, STATUS_LABELS, TransitionError, assertTransition, canReview, isAcceptable,
	posterActions, refundOwed, wasFunded, workerActions,
} from './state.js';
import { clampFeeBps, computeEscrow, parseBounty, refundLeg, releaseLegs, usdc, MAX_FEE_BPS } from './money.js';
import {
	closeTaskEscrow, escrowAddressFor, escrowBalance, isSolanaAddress, sendFromEscrow, taskNetwork,
} from './chain.js';
import { LEVELS, defaultLevelForBounty, levelInfo, workerStanding } from './verification.js';
import { activeAdapter, adapterByName, externalStatus } from './external.js';

export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const PREVIEW_TTL_MS = 10 * 60 * 1000;
export const REVIEW_WINDOW_MS = 72 * 3_600_000;
export const MIN_DEADLINE_HOURS = 1;
export const MAX_DEADLINE_HOURS = 30 * 24;
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const CATEGORIES = Object.freeze([
	'verification', 'photo', 'call', 'labeling', 'research', 'errand', 'translation', 'other',
]);
const UPLOAD_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const SETTLE_LEASE_SECONDS = 120;
const EXTERNAL_MIRROR_AFTER_MS = 15 * 60 * 1000;

function fail(status, code, message, extra = {}) {
	throw Object.assign(new Error(message), { status, code, expose: true, ...extra });
}

export function isUuid(v) {
	return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function requireUser(user) {
	if (!user?.id) fail(401, 'unauthorized', 'Sign in to use human tasks.');
}

function requireConfirm(confirm, what) {
	if (confirm !== true) fail(400, 'confirmation_required', `${what} moves real funds; pass confirm: true after showing the user the quote or preview.`);
}

async function requireAgreement(userId) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		fail(503, 'agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing moved.');
	}
	if (!signed) {
		const req = agreementRequirement();
		fail(403, 'risk_ack_required', `Sign the real-funds agreements first at ${req.sign_url}`, { requirement: req });
	}
}

async function event(taskId, actorKind, actorUserId, name, from = null, to = null, detail = {}) {
	await sql`
		INSERT INTO human_task_events (task_id, actor_kind, actor_user_id, event, from_status, to_status, detail)
		VALUES (${taskId}, ${actorKind}, ${actorUserId}, ${name}, ${from}, ${to}, ${JSON.stringify(detail)}::jsonb)
	`.catch((e) => console.warn('[human-tasks] event write failed', name, e?.message));
}

function notify(userId, type, payload) {
	if (userId) insertNotification(userId, type, payload).catch(() => {});
}

// Column assignments move() may apply alongside a status change. Explicit
// fragments (not interpolated identifiers) so no caller input names a column.
const ASSIGN = {
	escrow_signature: (v) => sql`escrow_signature = ${v}`,
	funded_at: (v) => sql`funded_at = ${v}`,
	custody_event_id: (v) => sql`custody_event_id = ${v}`,
	funding_error: (v) => sql`funding_error = ${v}`,
	cancelled_at: (v) => sql`cancelled_at = ${v}`,
	cancel_reason: (v) => sql`cancel_reason = ${v}`,
	refund_status: (v) => sql`refund_status = ${v}`,
	accepted_claim_id: (v) => sql`accepted_claim_id = ${v}`,
	payout_address: (v) => sql`payout_address = ${v}`,
	submitted_at: (v) => sql`submitted_at = ${v}`,
	review_due_at: (v) => sql`review_due_at = ${v}`,
	approved_at: (v) => sql`approved_at = ${v}`,
	approved_by: (v) => sql`approved_by = ${v}`,
	release_preview_id: (v) => sql`release_preview_id = ${v}`,
	release_preview_expires_at: (v) => sql`release_preview_expires_at = ${v}`,
	paid_at: (v) => sql`paid_at = ${v}`,
};

/** `, col = value` for each assignment, as a composable fragment. */
function setFragment(set) {
	let out = sql``;
	for (const [col, raw] of Object.entries(set)) {
		const assign = ASSIGN[col];
		if (!assign) throw new Error(`human_tasks column ${col} is not settable through move()`);
		out = sql`${out}, ${assign(raw instanceof Date ? raw.toISOString() : raw)}`;
	}
	return out;
}

/**
 * Compare-and-set a status change. Returns the updated row, or null when the
 * task is no longer in `from` (someone else moved it first).
 */
async function move(taskId, from, to, set = {}) {
	return moveIf(taskId, from, to, set, sql`TRUE`);
}

async function loadTask(taskId) {
	if (!isUuid(taskId)) fail(400, 'bad_request', 'task id must be a uuid');
	const [row] = await sql`SELECT * FROM human_tasks WHERE id = ${taskId}`;
	if (!row) fail(404, 'task_not_found', 'Task not found.');
	return row;
}

async function loadOwnedTask(user, taskId) {
	const task = await loadTask(taskId);
	if (task.poster_user_id !== user.id) fail(403, 'forbidden', 'Only the owner of the agent that posted this task can do that.');
	return task;
}

async function loadOwnedAgent(agentId, userId) {
	if (!isUuid(agentId)) fail(400, 'bad_request', 'agent_id must be a uuid');
	const [row] = await sql`
		SELECT id, user_id, name, meta, deleted_at FROM agent_identities WHERE id = ${agentId} LIMIT 1
	`;
	if (!row || row.deleted_at) fail(404, 'agent_not_found', 'Agent not found.');
	if (row.user_id !== userId) fail(403, 'forbidden', "That agent isn't on your account.");
	return row;
}

function taskFeeBps() {
	const raw = process.env.HUMAN_TASK_FEE_BPS;
	const n = raw == null || String(raw).trim() === '' ? getFeeBps() : parseInt(raw, 10);
	return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_FEE_BPS) : 0;
}

/** Fee rate and recipient to lock in at quote time: zero when no wallet could receive the fee. */
async function feeTerms() {
	const bps = clampFeeBps(taskFeeBps());
	if (bps === 0) return { bps: 0, recipient: null };
	const recipient = await feeRecipient('USDC').catch(() => null);
	return recipient ? { bps, recipient } : { bps: 0, recipient: null };
}

// ── Param normalization ──────────────────────────────────────────────────────

function haversineM(a, b) {
	const R = 6_371_000;
	const rad = (d) => (d * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}
export { haversineM };

function text(value, field, min, max) {
	const s = String(value ?? '').trim();
	if (s.length < min) fail(400, 'bad_request', `${field} must be at least ${min} characters`);
	if (s.length > max) fail(400, 'bad_request', `${field} must be at most ${max} characters`);
	return s;
}

function normalizeTaskParams(p) {
	const title = text(p.title, 'title', 3, 120);
	const instructions = text(p.instructions, 'instructions', 10, 4000);
	const category = CATEGORIES.includes(p.category) ? p.category : 'other';
	const hours = Number(p.deadline_hours);
	if (!Number.isFinite(hours) || hours < MIN_DEADLINE_HOURS || hours > MAX_DEADLINE_HOURS) {
		fail(400, 'bad_deadline', `deadline_hours must be between ${MIN_DEADLINE_HOURS} and ${MAX_DEADLINE_HOURS}`);
	}
	const bounty = parseBounty(p.bounty_usdc);
	const onsite = p.location_kind === 'onsite';
	let loc = { kind: 'remote', label: null, lat: null, lng: null, radius_m: null };
	if (onsite) {
		const lat = Number(p.lat);
		const lng = Number(p.lng);
		if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180) || p.lat == null || p.lng == null) {
			fail(400, 'bad_location', 'An on-site task needs a valid lat and lng.');
		}
		const radius = p.radius_m == null ? 200 : Math.floor(Number(p.radius_m));
		if (!Number.isFinite(radius) || radius < 25 || radius > 50_000) fail(400, 'bad_location', 'radius_m must be between 25 and 50000.');
		loc = { kind: 'onsite', label: p.location_label ? text(p.location_label, 'location_label', 1, 160) : null, lat, lng, radius_m: radius };
	}
	const minVerification = p.min_verification == null || p.min_verification === ''
		? defaultLevelForBounty(bounty)
		: Math.floor(Number(p.min_verification));
	if (![0, 1, 2].includes(minVerification)) fail(400, 'bad_request', 'min_verification must be 0, 1 or 2');
	return {
		agent_id: p.agent_id,
		title,
		instructions,
		category,
		deadline_hours: hours,
		bounty_atomics: bounty.toString(),
		location: loc,
		min_verification: minVerification,
		proof_requirements: p.proof_requirements ? text(p.proof_requirements, 'proof_requirements', 1, 1000) : null,
		allow_external: p.allow_external === true,
	};
}

// ── Quote and post ───────────────────────────────────────────────────────────

/**
 * Price a task without posting it. Returns the confirmation table the poster
 * must see, and a quote_id good for ten minutes that postTask redeems.
 */
export async function quoteTask(user, p) {
	requireUser(user);
	const agent = await loadOwnedAgent(p.agent_id, user.id);
	if (!agent.meta?.solana_address || !agent.meta?.encrypted_solana_secret) {
		fail(409, 'wallet_preparing', 'That agent has no Solana wallet yet, so it cannot fund a task.');
	}
	const params = normalizeTaskParams(p);
	const terms = await feeTerms();
	const e = computeEscrow(BigInt(params.bounty_atomics), terms.bps);
	const network = taskNetwork();
	const id = randomUUID();
	const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
	const stored = { ...params, fee_recipient: terms.recipient };
	await sql`
		INSERT INTO human_task_quotes (id, agent_id, user_id, params, bounty_atomics, fee_atomics, fee_bps, escrow_atomics, network, expires_at)
		VALUES (${id}, ${agent.id}, ${user.id}, ${JSON.stringify(stored)}::jsonb, ${e.bounty.toString()}, ${e.fee.toString()},
		        ${e.feeBps}, ${e.escrow.toString()}, ${network}, ${expiresAt.toISOString()})
	`;
	const deadline = new Date(Date.now() + params.deadline_hours * 3_600_000);
	const table = [
		{ label: 'Task', value: params.title },
		{ label: 'Poster agent', value: `${agent.name} (${agent.id})` },
		{ label: 'Bounty to the worker', value: `${usdc(e.bounty)} USDC` },
		{ label: 'Platform fee', value: `${usdc(e.fee)} USDC (${e.feeBps / 100}%, charged only if the task pays out)` },
		{ label: 'Locked in escrow now', value: `${usdc(e.escrow)} USDC from ${agent.meta.solana_address}` },
		{ label: 'Refund if nobody completes it', value: `${usdc(e.escrow)} USDC back to the same wallet` },
		{ label: 'Deadline', value: deadline.toISOString() },
		{ label: 'Who can accept', value: `${levelInfo(params.min_verification).label} workers and above` },
		{ label: 'Chain', value: `Solana ${network}` },
	];
	return {
		quote_id: id,
		expires_at: expiresAt.toISOString(),
		bounty_usdc: usdc(e.bounty),
		fee_usdc: usdc(e.fee),
		escrow_usdc: usdc(e.escrow),
		fee_bps: e.feeBps,
		network,
		table,
		text: ['| Field | Value |', '|---|---|', ...table.map((r) => `| ${r.label} | ${String(r.value).replace(/\|/g, '/')} |`)].join('\n'),
	};
}

async function fundEscrow(task, agent) {
	const result = await transferUsdcGuarded({
		fromAgentId: agent.id,
		fromUserId: agent.user_id,
		fromMeta: agent.meta,
		toAddress: task.escrow_address,
		usdc: Number(usdc(task.escrow_atomics)),
		amountAtomics: BigInt(String(task.escrow_atomics)),
		network: task.network,
		category: 'human_task',
		destinationTrust: 'system',
		idempotencyKey: `human-task:${task.id}`,
		rowMeta: { task_id: task.id, escrow: task.escrow_address },
	});
	return result;
}

const FUNDING_MESSAGES = {
	wallet_frozen: "That agent's wallet is frozen, so it cannot fund a task. Unfreeze it under Limits & Safety.",
	daily_limit: "This task would exceed that agent's daily spend limit. Raise the limit or post a smaller bounty.",
	per_tx_limit: "This task is above that agent's per-transaction limit. Raise the limit or post a smaller bounty.",
	wallet_preparing: 'That agent has no Solana wallet yet.',
	send_failed: 'The escrow transfer could not be sent. Nothing left the wallet; check its USDC and SOL balance and try again.',
};

/** Mark a funding task open after its escrow transfer landed. */
async function markFunded(task, signature, custodyEventId = null) {
	const row = await move(task.id, 'funding', 'open', {
		escrow_signature: signature, funded_at: new Date(), custody_event_id: custodyEventId, funding_error: null,
	});
	if (row) await event(task.id, 'system', null, 'funded', 'funding', 'open', { signature });
	return row;
}

/**
 * Post a quoted task and lock its escrow. Committing: real USDC leaves the
 * poster agent's wallet. Synchronous; returns once the transfer confirmed.
 */
export async function postTask(user, { quote_id: quoteId, confirm = false } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Posting a task');
	if (!isUuid(quoteId)) fail(400, 'bad_request', 'quote_id is required: call the quote first and show the user its table.');
	await requireAgreement(user.id);
	if (!(await resolveMarketplacePayer())) fail(503, 'fee_payer_unavailable', 'The marketplace fee payer is not configured, so escrow cannot settle.');

	const [claimed] = await sql`
		UPDATE human_task_quotes SET used_at = now()
		WHERE id = ${quoteId} AND user_id = ${user.id} AND used_at IS NULL AND expires_at > now()
		RETURNING *
	`;
	if (!claimed) fail(409, 'quote_stale', 'That quote is missing, already used, or older than ten minutes. Request a fresh quote.');

	const agent = await loadOwnedAgent(claimed.agent_id, user.id);
	const params = claimed.params;
	const id = randomUUID();
	const escrowAddress = escrowAddressFor(id);
	const deadline = new Date(Date.now() + params.deadline_hours * 3_600_000);
	const loc = params.location;
	await sql`
		INSERT INTO human_tasks (
			id, poster_agent_id, poster_user_id, status, title, instructions, category,
			location_kind, location_label, lat, lng, radius_m, deadline_at,
			bounty_atomics, fee_atomics, fee_bps, escrow_atomics, network, escrow_address,
			min_verification, proof_requirements, allow_external, quote_id, fee_recipient)
		VALUES (
			${id}, ${agent.id}, ${user.id}, 'funding', ${params.title}, ${params.instructions}, ${params.category},
			${loc.kind}, ${loc.label}, ${loc.lat}, ${loc.lng}, ${loc.radius_m}, ${deadline.toISOString()},
			${claimed.bounty_atomics}, ${claimed.fee_atomics}, ${claimed.fee_bps}, ${claimed.escrow_atomics}, ${claimed.network}, ${escrowAddress},
			${params.min_verification}, ${params.proof_requirements}, ${params.allow_external}, ${quoteId}, ${params.fee_recipient || null})
	`;
	await sql`UPDATE human_task_quotes SET task_id = ${id} WHERE id = ${quoteId}`;
	await event(id, 'poster', user.id, 'posted', null, 'funding', { escrow: escrowAddress });
	const [task] = await sql`SELECT * FROM human_tasks WHERE id = ${id}`;

	const result = await fundEscrow(task, agent);
	if (result.status === 'paid' || result.status === 'replayed') {
		const open = await markFunded(task, result.signature, result.custodyEventId ?? null);
		logAudit({ userId: user.id, action: 'human_task.post', resourceId: id, meta: { escrow_usdc: usdc(task.escrow_atomics), signature: result.signature } });
		return { task: await taskView(open || (await loadTask(id)), { viewerId: user.id }), signature: result.signature };
	}
	if (result.code === 'unconfirmed' || result.code === 'in_flight') {
		return { task: await taskView(await loadTask(id), { viewerId: user.id }), signature: result.signature || null, pending: true };
	}
	await move(id, 'funding', 'cancelled', { funding_error: String(result.code || result.message || 'funding_failed').slice(0, 200), cancelled_at: new Date(), cancel_reason: 'funding_failed' });
	await event(id, 'system', null, 'funding_failed', 'funding', 'cancelled', { code: result.code || null });
	fail(
		result.status === 'blocked' ? 403 : 502,
		result.code || 'funding_failed',
		FUNDING_MESSAGES[result.code] || result.message || 'The escrow transfer failed. Nothing moved.',
		{ signature: result.signature || null },
	);
}

// ── Views ────────────────────────────────────────────────────────────────────

function iso(v) {
	return v ? new Date(v).toISOString() : null;
}

function publicTask(t) {
	return {
		id: t.id,
		status: t.status,
		status_label: STATUS_LABELS[t.status] || t.status,
		title: t.title,
		instructions: t.instructions,
		category: t.category,
		location: t.location_kind === 'onsite'
			? { kind: 'onsite', label: t.location_label, lat: t.lat, lng: t.lng, radius_m: t.radius_m }
			: { kind: 'remote' },
		deadline_at: iso(t.deadline_at),
		bounty_usdc: usdc(t.bounty_atomics),
		min_verification: t.min_verification,
		min_verification_label: levelInfo(t.min_verification).label,
		proof_requirements: t.proof_requirements,
		network: t.network,
		escrow_address: t.escrow_address,
		poster_agent: t.poster_agent_name ? { id: t.poster_agent_id, name: t.poster_agent_name } : { id: t.poster_agent_id },
		external: t.external_ref ? { provider: t.external_provider } : null,
		created_at: iso(t.created_at),
		url: `/tasks/${t.id}`,
	};
}

async function reviewedFlags(taskId) {
	const rows = await sql`SELECT reviewer_role FROM human_task_reviews WHERE task_id = ${taskId}`;
	return Object.fromEntries(rows.map((r) => [r.reviewer_role, true]));
}

async function viewerClaim(task, viewerId) {
	if (!viewerId) return null;
	const [row] = await sql`
		SELECT * FROM human_task_claims
		WHERE task_id = ${task.id} AND worker_user_id = ${viewerId}
		ORDER BY created_at DESC LIMIT 1
	`;
	return row || null;
}

/** A full task view for one viewer: public fields plus whatever their role may see. */
export async function taskView(task, { viewerId = null, withTimeline = false } = {}) {
	const [agent] = await sql`SELECT name FROM agent_identities WHERE id = ${task.poster_agent_id}`;
	const view = publicTask({ ...task, poster_agent_name: agent?.name });
	const isPoster = Boolean(viewerId) && task.poster_user_id === viewerId;
	const claim = await viewerClaim(task, viewerId);
	const reviewed = await reviewedFlags(task.id);
	const t = { ...task, reviewed };
	view.viewer = {
		role: isPoster ? 'poster' : claim && claim.id === task.accepted_claim_id ? 'worker' : viewerId ? 'visitor' : 'anonymous',
		poster_actions: isPoster ? posterActions(t) : [],
		worker_actions: claim && claim.id === task.accepted_claim_id ? workerActions(t, claim) : [],
		can_claim: Boolean(viewerId) && !isPoster && isAcceptable(task),
	};
	if (isPoster) {
		view.fee_usdc = usdc(task.fee_atomics);
		view.escrow_usdc = usdc(task.escrow_atomics);
		view.funding_error = task.funding_error;
		view.review_due_at = iso(task.review_due_at);
	}
	if (isPoster || view.viewer.role === 'worker') {
		view.payout_address = task.payout_address;
		view.payout_signature = task.payout_signature;
		view.fee_signature = task.fee_signature;
		view.refund_signature = task.refund_signature;
		view.paid_at = iso(task.paid_at);
		view.cancel_reason = task.cancel_reason;
		const [sub] = task.accepted_claim_id
			? await sql`SELECT * FROM human_task_submissions WHERE claim_id = ${task.accepted_claim_id} ORDER BY created_at DESC LIMIT 1`
			: [];
		if (sub) view.submission = await submissionView(sub);
		const [dispute] = await sql`SELECT * FROM human_task_disputes WHERE task_id = ${task.id} ORDER BY created_at DESC LIMIT 1`;
		if (dispute) {
			view.dispute = {
				id: dispute.id, status: dispute.status, reason: dispute.reason, worker_response: dispute.worker_response,
				outcome: dispute.outcome, resolution_note: dispute.resolution_note, opened_at: iso(dispute.created_at),
			};
		}
	}
	if (task.accepted_claim_id) {
		const [c] = await sql`SELECT verification_level, worker_kind, external_provider FROM human_task_claims WHERE id = ${task.accepted_claim_id}`;
		view.worker = c ? { level: c.verification_level, level_label: levelInfo(c.verification_level).label, kind: c.worker_kind, provider: c.external_provider } : null;
	}
	if (withTimeline) {
		const rows = await sql`
			SELECT event, from_status, to_status, actor_kind, created_at FROM human_task_events WHERE task_id = ${task.id} ORDER BY id
		`;
		view.timeline = rows.map((r) => ({ event: r.event, from: r.from_status, to: r.to_status, actor: r.actor_kind, at: iso(r.created_at) }));
	}
	return view;
}

async function submissionView(sub) {
	const photos = Array.isArray(sub.photos) ? sub.photos : [];
	const urls = await Promise.all(photos.map(async (p) => {
		if (typeof p === 'string' && /^https:\/\//.test(p)) return p;
		return presignGet({ key: String(p), expiresIn: 900 }).catch(() => null);
	}));
	return {
		id: sub.id, notes: sub.notes, photos: urls.filter(Boolean), lat: sub.lat, lng: sub.lng, submitted_at: iso(sub.created_at),
	};
}

// ── Browse and detail ────────────────────────────────────────────────────────

/** Open tasks for the board. Public. */
export async function browseTasks({ q = '', category = null, location = null, lat = null, lng = null, radius_km = null, limit = 24, cursor = 0, status = 'open' } = {}) {
	const lim = Math.min(Math.max(Math.floor(Number(limit)) || 24, 1), 48);
	const off = Math.max(Math.floor(Number(cursor)) || 0, 0);
	const like = q ? `%${String(q).slice(0, 80).replace(/[%_]/g, '')}%` : null;
	const st = status === 'all' ? null : 'open';
	const cat = CATEGORIES.includes(category) ? category : null;
	const kind = location === 'remote' || location === 'onsite' ? location : null;
	const rows = await sql`
		SELECT t.*, a.name AS poster_agent_name FROM human_tasks t
		JOIN agent_identities a ON a.id = t.poster_agent_id
		WHERE t.status = ${st ?? 'open'}
		  AND t.deadline_at > now()
		  AND (${like}::text IS NULL OR t.title ILIKE ${like} OR t.instructions ILIKE ${like})
		  AND (${cat}::text IS NULL OR t.category = ${cat})
		  AND (${kind}::text IS NULL OR t.location_kind = ${kind})
		ORDER BY t.created_at DESC
		OFFSET ${off} LIMIT ${lim + 1}
	`;
	let items = rows.slice(0, lim).map(publicTask);
	const nlat = Number(lat);
	const nlng = Number(lng);
	if (lat != null && lng != null && Number.isFinite(nlat) && Number.isFinite(nlng)) {
		const maxM = (Number(radius_km) > 0 ? Number(radius_km) : 25) * 1000;
		items = items
			.map((t) => ({ ...t, distance_m: t.location.kind === 'onsite' ? Math.round(haversineM({ lat: nlat, lng: nlng }, t.location)) : null }))
			.filter((t) => t.distance_m == null || t.distance_m <= maxM)
			.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
	}
	return { items, next_cursor: rows.length > lim ? String(off + lim) : null, external: externalStatus() };
}

export async function getTaskDetail(taskId, viewerId = null) {
	const task = await loadTask(taskId);
	if (task.status === 'funding' && task.poster_user_id !== viewerId) fail(404, 'task_not_found', 'Task not found.');
	return taskView(task, { viewerId, withTimeline: true });
}

/** The tasks my agents posted. */
export async function myPostedTasks(user, { status = null, limit = 50 } = {}) {
	requireUser(user);
	const rows = await sql`
		SELECT t.*, a.name AS poster_agent_name FROM human_tasks t
		JOIN agent_identities a ON a.id = t.poster_agent_id
		WHERE t.poster_user_id = ${user.id} AND (${status}::text IS NULL OR t.status = ${status})
		ORDER BY t.created_at DESC LIMIT ${Math.min(Math.max(Number(limit) || 50, 1), 200)}
	`;
	return { items: rows.map((t) => ({ ...publicTask(t), fee_usdc: usdc(t.fee_atomics), escrow_usdc: usdc(t.escrow_atomics), actions: posterActions(t) })) };
}

/** The tasks I am working on or have worked. */
export async function myWork(user) {
	requireUser(user);
	const rows = await sql`
		SELECT t.*, a.name AS poster_agent_name, c.status AS claim_status, c.id AS claim_id FROM human_task_claims c
		JOIN human_tasks t ON t.id = c.task_id
		JOIN agent_identities a ON a.id = t.poster_agent_id
		WHERE c.worker_user_id = ${user.id}
		ORDER BY c.created_at DESC LIMIT 100
	`;
	return {
		items: rows.map((t) => ({
			...publicTask(t),
			claim_status: t.claim_status,
			actions: t.accepted_claim_id === t.claim_id ? workerActions(t, { status: t.claim_status }) : [],
		})),
	};
}

/** My agents that can fund a task: wallet address and live USDC balance. */
export async function myAgents(user) {
	requireUser(user);
	const network = taskNetwork();
	const rows = await sql`
		SELECT id, name, meta->>'solana_address' AS wallet_address, (meta->>'encrypted_solana_secret') IS NOT NULL AS has_key
		FROM agent_identities WHERE user_id = ${user.id} AND deleted_at IS NULL
		ORDER BY updated_at DESC NULLS LAST LIMIT 100
	`;
	return Promise.all(rows.map(async (r) => {
		const bal = r.wallet_address && r.has_key ? await getSolanaAddressBalances(r.wallet_address, network).catch(() => null) : null;
		return { id: r.id, name: r.name, wallet_address: r.wallet_address, can_fund: Boolean(r.wallet_address && r.has_key), usdc: bal?.usdc ?? null, network };
	}));
}

export async function myStanding(user) {
	requireUser(user);
	const standing = await workerStanding(user.id);
	if (!standing) fail(404, 'user_not_found', 'Account not found.');
	return { ...standing, levels: LEVELS };
}

// ── Claim, unclaim, upload, submit ───────────────────────────────────────────

/** Accept a task as a signed-in worker. First valid claim wins. */
export async function claimTask(user, taskId, { payout_address: payoutRaw = null, note = null } = {}) {
	requireUser(user);
	const task = await loadTask(taskId);
	if (task.poster_user_id === user.id) fail(403, 'own_task', 'You cannot accept a task your own agent posted.');
	if (!isAcceptable(task)) fail(409, 'not_open', 'This task is no longer open.');
	const standing = await workerStanding(user.id);
	if (!standing || standing.level < 0) {
		fail(403, 'wallet_required', 'Link a Solana wallet to your account first so escrow can pay you.', { next_step: standing?.next_step });
	}
	if (standing.level < task.min_verification) {
		fail(403, 'verification_required', `This task needs a ${levelInfo(task.min_verification).label} worker. You are ${standing.level_label}.`, { next_step: standing.next_step });
	}
	const payout = payoutRaw ? String(payoutRaw).trim() : standing.wallets[0]?.address;
	if (!payout || !isSolanaAddress(payout)) fail(400, 'bad_address', 'payout_address must be a Solana wallet address.');
	if (!standing.wallets.some((w) => w.address === payout)) {
		fail(400, 'payout_not_linked', 'Payouts go only to a Solana wallet linked to your account.');
	}
	const claimId = randomUUID();
	try {
		await sql`
			INSERT INTO human_task_claims (id, task_id, worker_kind, worker_user_id, payout_address, verification_level, note)
			VALUES (${claimId}, ${task.id}, 'user', ${user.id}, ${payout}, ${standing.level}, ${note ? String(note).slice(0, 500) : null})
		`;
	} catch (err) {
		if (String(err?.message || '').includes('human_task_claims_one_live')) fail(409, 'already_claimed', 'Someone else just accepted this task.');
		throw err;
	}
	const row = await moveIf(task.id, 'open', 'accepted', { accepted_claim_id: claimId, payout_address: payout }, sql`deadline_at > now()`);
	if (!row) {
		await sql`UPDATE human_task_claims SET status = 'lost', updated_at = now() WHERE id = ${claimId}`;
		fail(409, 'already_claimed', 'Someone else just accepted this task, or its deadline passed.');
	}
	await event(task.id, 'worker', user.id, 'claimed', 'open', 'accepted', { level: standing.level });
	notify(task.poster_user_id, 'human_task_claimed', { task_id: task.id, title: task.title });
	if (task.external_ref) withdrawExternal(row).catch(() => {});
	return { task: await taskView(row, { viewerId: user.id }) };
}

async function moveIf(taskId, from, to, set, extra) {
	assertTransition(from, to);
	const [row] = await sql`
		UPDATE human_tasks SET status = ${to}, updated_at = now()${setFragment(set)}
		WHERE id = ${taskId} AND status = ${from} AND ${extra}
		RETURNING *
	`;
	return row || null;
}

/** The worker hands an accepted task back before the deadline; it reopens. */
export async function unclaimTask(user, taskId) {
	requireUser(user);
	const task = await loadTask(taskId);
	const claim = await viewerClaim(task, user.id);
	if (!claim || claim.id !== task.accepted_claim_id || claim.status !== 'active' || task.status !== 'accepted') {
		fail(409, 'not_claimed', 'You do not hold an active claim on this task.');
	}
	await sql`UPDATE human_task_claims SET status = 'released', released_at = now(), updated_at = now() WHERE id = ${claim.id} AND status = 'active'`;
	const row = await move(task.id, 'accepted', 'open', { accepted_claim_id: null, payout_address: null });
	if (!row) fail(409, 'invalid_transition', 'The task moved while you were releasing it.');
	await event(task.id, 'worker', user.id, 'unclaimed', 'accepted', 'open');
	return { task: await taskView(row, { viewerId: user.id }) };
}

/** A signed URL for the worker to upload one proof photo directly. */
export async function requestUpload(user, taskId, { content_type: contentType } = {}) {
	requireUser(user);
	const ext = UPLOAD_TYPES[contentType];
	if (!ext) fail(400, 'bad_content_type', 'Proof photos must be JPEG, PNG or WebP.');
	const task = await loadTask(taskId);
	const claim = await viewerClaim(task, user.id);
	if (!claim || claim.id !== task.accepted_claim_id || claim.status !== 'active' || task.status !== 'accepted') {
		fail(409, 'not_claimed', 'Accept the task before uploading proof.');
	}
	const [{ n }] = await sql`SELECT count(*)::int AS n FROM human_task_uploads WHERE claim_id = ${claim.id}`;
	if (n >= MAX_PHOTOS) fail(409, 'too_many_photos', `A submission can carry at most ${MAX_PHOTOS} photos.`);
	const key = `human-tasks/${task.id}/${claim.id}/${randomUUID()}.${ext}`;
	await sql`INSERT INTO human_task_uploads (task_id, claim_id, object_key, content_type) VALUES (${task.id}, ${claim.id}, ${key}, ${contentType})`;
	const url = await presignUpload({ key, contentType });
	return { upload_url: url, key, method: 'PUT', headers: { 'content-type': contentType }, max_bytes: MAX_PHOTO_BYTES, expires_in: 300 };
}

/** Submit proof. Moves the task to submitted and starts the poster's review window. */
export async function submitProof(user, taskId, { notes = '', photos = [], lat = null, lng = null } = {}) {
	requireUser(user);
	const task = await loadTask(taskId);
	const claim = await viewerClaim(task, user.id);
	if (!claim || claim.id !== task.accepted_claim_id || claim.status !== 'active' || task.status !== 'accepted') {
		fail(409, 'not_claimed', 'You do not hold an active claim on this task.');
	}
	if (new Date(task.deadline_at) <= new Date()) fail(409, 'deadline_passed', 'The deadline for this task has passed.');
	const body = String(notes || '').trim().slice(0, 4000);
	const keys = Array.isArray(photos) ? photos.map(String) : [];
	if (keys.length > MAX_PHOTOS) fail(400, 'too_many_photos', `A submission can carry at most ${MAX_PHOTOS} photos.`);
	if (!body && !keys.length) fail(400, 'empty_submission', 'Submit notes, at least one photo, or both.');
	if (keys.length) {
		const owned = await sql`SELECT object_key FROM human_task_uploads WHERE claim_id = ${claim.id} AND object_key = ANY(${keys})`;
		if (owned.length !== new Set(keys).size) fail(400, 'unknown_photo', 'A photo was not uploaded for this claim.');
		for (const k of keys) {
			const head = await headObject(k).catch(() => null);
			if (!head) fail(400, 'photo_missing', 'A photo upload did not finish. Upload it again.');
			if (Number(head.ContentLength || 0) > MAX_PHOTO_BYTES) fail(400, 'photo_too_large', 'A photo is larger than 10 MB.');
			await sql`UPDATE human_task_uploads SET bytes = ${Number(head.ContentLength || 0)} WHERE object_key = ${k}`;
		}
	}
	let sLat = null;
	let sLng = null;
	if (task.location_kind === 'onsite') {
		sLat = Number(lat);
		sLng = Number(lng);
		if (lat == null || lng == null || !Number.isFinite(sLat) || !Number.isFinite(sLng)) {
			fail(400, 'location_required', 'This is an on-site task: include the location you submitted from.');
		}
		const away = haversineM({ lat: task.lat, lng: task.lng }, { lat: sLat, lng: sLng });
		if (away > task.radius_m) {
			fail(400, 'outside_radius', `You submitted ${Math.round(away)} m from the task location; it must be within ${task.radius_m} m.`);
		}
	}
	await sql`
		INSERT INTO human_task_submissions (task_id, claim_id, notes, photos, lat, lng)
		VALUES (${task.id}, ${claim.id}, ${body}, ${JSON.stringify(keys)}::jsonb, ${sLat}, ${sLng})
	`;
	const dueAt = new Date(Date.now() + REVIEW_WINDOW_MS);
	const row = await moveIf(task.id, 'accepted', 'submitted', { submitted_at: new Date(), review_due_at: dueAt }, sql`deadline_at > now()`);
	if (!row) fail(409, 'invalid_transition', 'The task moved while you were submitting.');
	await sql`UPDATE human_task_claims SET status = 'submitted', updated_at = now() WHERE id = ${claim.id}`;
	await event(task.id, 'worker', user.id, 'submitted', 'accepted', 'submitted', { photos: keys.length });
	notify(task.poster_user_id, 'human_task_submitted', { task_id: task.id, title: task.title });
	return { task: await taskView(row, { viewerId: user.id }) };
}

// ── Approve and release ──────────────────────────────────────────────────────

function previewTable(task, legs) {
	return [
		{ label: 'Task', value: task.title },
		{ label: 'Pay the worker', value: `${usdc(legs[0].atomics)} USDC to ${legs[0].recipient}` },
		...(legs[1] ? [{ label: 'Platform fee', value: `${usdc(legs[1].atomics)} USDC to ${legs[1].recipient}` }] : []),
		{ label: 'Total leaving escrow', value: `${usdc(task.escrow_atomics)} USDC` },
		{ label: 'Chain', value: `Solana ${task.network}` },
		{ label: 'This cannot be undone', value: 'Approval pays out immediately. Dispute instead if the proof is wrong.' },
	];
}

/** The confirmation table for releasing a submitted task. Issues the preview id approveTask redeems. */
export async function previewApprove(user, taskId) {
	requireUser(user);
	const task = await loadOwnedTask(user, taskId);
	if (task.status !== 'submitted') fail(409, 'not_submitted', `Only a task with submitted proof can be approved; this one is ${STATUS_LABELS[task.status] || task.status}.`);
	const legs = releaseLegs(task);
	const id = `htp_${randomUUID().replace(/-/g, '')}`;
	const expires = new Date(Date.now() + PREVIEW_TTL_MS);
	await sql`UPDATE human_tasks SET release_preview_id = ${id}, release_preview_expires_at = ${expires.toISOString()} WHERE id = ${task.id} AND status = 'submitted'`;
	const table = previewTable(task, legs);
	return {
		preview_id: id, expires_at: expires.toISOString(), table,
		text: ['| Field | Value |', '|---|---|', ...table.map((r) => `| ${r.label} | ${String(r.value).replace(/\|/g, '/')} |`)].join('\n'),
	};
}

/** Approve the proof and pay the worker. Committing: real USDC leaves escrow. */
export async function approveTask(user, taskId, { confirm = false, preview_id: previewId = null } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Approving a task');
	const task = await loadOwnedTask(user, taskId);
	if (task.status !== 'submitted') throw new TransitionError(task.status, 'approved');
	if (!previewId || previewId !== task.release_preview_id || !task.release_preview_expires_at || new Date(task.release_preview_expires_at) <= new Date()) {
		fail(409, 'preview_stale', 'Show the payout preview first. That preview is missing, expired, or was for different terms.');
	}
	const row = await move(task.id, 'submitted', 'approved', { approved_at: new Date(), approved_by: user.id, release_preview_id: null, release_preview_expires_at: null });
	if (!row) fail(409, 'invalid_transition', 'The task moved while you were approving it.');
	await event(task.id, 'poster', user.id, 'approved', 'submitted', 'approved');
	logAudit({ userId: user.id, action: 'human_task.approve', resourceId: task.id, meta: { escrow_usdc: usdc(task.escrow_atomics) } });
	const settled = await settleTask(task.id);
	return { task: await taskView(settled || (await loadTask(task.id)), { viewerId: user.id }) };
}

// ── Settlement ───────────────────────────────────────────────────────────────

async function lease(taskId) {
	const [row] = await sql`
		UPDATE human_tasks SET settle_locked_until = now() + make_interval(secs => ${SETTLE_LEASE_SECONDS})
		WHERE id = ${taskId} AND (settle_locked_until IS NULL OR settle_locked_until < now())
		RETURNING *
	`;
	return row || null;
}

async function unlease(taskId) {
	await sql`UPDATE human_tasks SET settle_locked_until = NULL WHERE id = ${taskId}`;
}

async function posterRefundDestination(task) {
	const [agent] = await sql`SELECT meta FROM agent_identities WHERE id = ${task.poster_agent_id}`;
	return task.refund_address || agent?.meta?.solana_address || null;
}

/**
 * Drive an approved task to paid, or a refund-owed task to refunded. Safe to
 * call from many places: it leases the task and every leg is exactly-once.
 * Returns the task row, or null when another worker holds the lease.
 */
export async function settleTask(taskId) {
	const leased = await lease(taskId);
	if (!leased) return null;
	try {
		if (leased.status === 'approved') return await settleRelease(leased);
		if (refundOwed(leased) && leased.refund_status !== 'sent') return await settleRefund(leased);
		return leased;
	} finally {
		await unlease(taskId);
	}
}

async function settleRelease(task) {
	try {
		const legs = releaseLegs(task);
		let cur = task;
		for (const leg of legs) {
			const col = leg.kind === 'payout' ? 'payout' : 'fee';
			if (cur[`${col}_signature`]) continue;
			const sent = await sendFromEscrow({
				task: cur,
				legId: leg.legId,
				recipient: leg.recipient,
				atomics: leg.atomics,
				prior: cur[`${col}_leg`],
				onPrepared: async (rec) => {
					if (col === 'payout') await sql`UPDATE human_tasks SET payout_leg = ${JSON.stringify(rec)}::jsonb WHERE id = ${task.id}`;
					else await sql`UPDATE human_tasks SET fee_leg = ${JSON.stringify(rec)}::jsonb WHERE id = ${task.id}`;
				},
			});
			if (col === 'payout') await sql`UPDATE human_tasks SET payout_signature = ${sent.signature}, payout_error = NULL WHERE id = ${task.id}`;
			else await sql`UPDATE human_tasks SET fee_signature = ${sent.signature} WHERE id = ${task.id}`;
			[cur] = await sql`SELECT * FROM human_tasks WHERE id = ${task.id}`;
		}
		const paid = await move(task.id, 'approved', 'paid', { paid_at: new Date() });
		if (paid) {
			await sql`UPDATE human_task_claims SET status = 'completed', updated_at = now() WHERE id = ${task.accepted_claim_id}`;
			await event(task.id, 'system', null, 'paid', 'approved', 'paid', { payout_signature: paid.payout_signature, fee_signature: paid.fee_signature });
			const [claim] = await sql`SELECT worker_user_id FROM human_task_claims WHERE id = ${task.accepted_claim_id}`;
			notify(claim?.worker_user_id, 'human_task_paid', { task_id: task.id, title: task.title, amount_usdc: usdc(task.bounty_atomics) });
		}
		return paid || cur;
	} catch (err) {
		await sql`UPDATE human_tasks SET payout_error = ${String(err?.message || err).slice(0, 400)}, payout_attempts = payout_attempts + 1, updated_at = now() WHERE id = ${task.id}`;
		console.warn('[human-tasks] release failed', task.id, err?.message);
		return (await sql`SELECT * FROM human_tasks WHERE id = ${task.id}`)[0];
	}
}

async function settleRefund(task) {
	try {
		const destination = await posterRefundDestination(task);
		const leg = refundLeg(task, destination);
		await sql`UPDATE human_tasks SET refund_address = ${destination} WHERE id = ${task.id}`;
		const sent = await sendFromEscrow({
			task,
			legId: leg.legId,
			recipient: leg.recipient,
			atomics: leg.atomics,
			prior: task.refund_leg,
			onPrepared: async (rec) => {
				await sql`UPDATE human_tasks SET refund_leg = ${JSON.stringify(rec)}::jsonb WHERE id = ${task.id}`;
			},
		});
		const [row] = await sql`
			UPDATE human_tasks SET refund_status = 'sent', refund_signature = ${sent.signature}, refund_error = NULL, updated_at = now()
			WHERE id = ${task.id} RETURNING *
		`;
		await event(task.id, 'system', null, 'refunded', task.status, task.status, { signature: sent.signature });
		notify(task.poster_user_id, 'human_task_refunded', { task_id: task.id, title: task.title, amount_usdc: usdc(task.escrow_atomics) });
		return row;
	} catch (err) {
		await sql`UPDATE human_tasks SET refund_status = 'failed', refund_error = ${String(err?.message || err).slice(0, 400)}, refund_attempts = refund_attempts + 1, updated_at = now() WHERE id = ${task.id}`;
		console.warn('[human-tasks] refund failed', task.id, err?.message);
		return (await sql`SELECT * FROM human_tasks WHERE id = ${task.id}`)[0];
	}
}

/** Fields that end a task unpaid: queue the refund if the escrow was ever funded. */
function endUnpaid(task, reason) {
	return {
		cancelled_at: new Date(),
		cancel_reason: reason,
		refund_status: wasFunded(task) ? 'pending' : null,
	};
}

// ── Cancel, dispute, resolve ─────────────────────────────────────────────────

/** Cancel an open task and refund the escrow in full. Committing: moves real funds back. */
export async function cancelTask(user, taskId, { confirm = false } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Cancelling a task (the escrow refund)');
	const task = await loadOwnedTask(user, taskId);
	if (task.status !== 'open') throw new TransitionError(task.status, 'cancelled');
	const row = await move(task.id, 'open', 'cancelled', endUnpaid(task, 'poster_cancelled'));
	if (!row) fail(409, 'invalid_transition', 'The task was accepted or expired while you were cancelling.');
	await event(task.id, 'poster', user.id, 'cancelled', 'open', 'cancelled');
	logAudit({ userId: user.id, action: 'human_task.cancel', resourceId: task.id });
	if (row.external_ref) withdrawExternal(row).catch(() => {});
	const settled = await settleTask(task.id);
	return { task: await taskView(settled || row, { viewerId: user.id }) };
}

/** The poster disputes submitted proof inside the review window. Freezes release. */
export async function disputeTask(user, taskId, { reason } = {}) {
	requireUser(user);
	const task = await loadOwnedTask(user, taskId);
	if (task.status !== 'submitted') throw new TransitionError(task.status, 'disputed');
	if (task.review_due_at && new Date(task.review_due_at) <= new Date()) fail(409, 'review_window_closed', 'The review window for this task has closed.');
	const why = text(reason, 'reason', 10, 2000);
	const row = await move(task.id, 'submitted', 'disputed', {});
	if (!row) fail(409, 'invalid_transition', 'The task moved while you were disputing it.');
	await sql`
		INSERT INTO human_task_disputes (task_id, opened_by, opened_by_user_id, reason)
		VALUES (${task.id}, 'poster', ${user.id}, ${why})
	`;
	await event(task.id, 'poster', user.id, 'disputed', 'submitted', 'disputed');
	const [claim] = await sql`SELECT worker_user_id FROM human_task_claims WHERE id = ${task.accepted_claim_id}`;
	notify(claim?.worker_user_id, 'human_task_disputed', { task_id: task.id, title: task.title });
	return { task: await taskView(row, { viewerId: user.id }) };
}

/** The worker answers an open dispute. */
export async function respondToDispute(user, taskId, { response } = {}) {
	requireUser(user);
	const task = await loadTask(taskId);
	const claim = await viewerClaim(task, user.id);
	if (task.status !== 'disputed' || !claim || claim.id !== task.accepted_claim_id) fail(409, 'not_disputed', 'There is no open dispute on a task you hold.');
	const body = text(response, 'response', 1, 2000);
	const [d] = await sql`UPDATE human_task_disputes SET worker_response = ${body} WHERE task_id = ${task.id} AND status = 'open' RETURNING id`;
	if (!d) fail(409, 'not_disputed', 'There is no open dispute on this task.');
	await event(task.id, 'worker', user.id, 'dispute_response', 'disputed', 'disputed');
	return { ok: true };
}

/** The disputes waiting for an admin. */
export async function disputeQueue(admin) {
	requireUser(admin);
	const rows = await sql`
		SELECT d.*, t.title, t.bounty_atomics, t.escrow_atomics, t.payout_address FROM human_task_disputes d
		JOIN human_tasks t ON t.id = d.task_id WHERE d.status = 'open' ORDER BY d.created_at
	`;
	return { items: rows.map((d) => ({ id: d.id, task_id: d.task_id, title: d.title, reason: d.reason, worker_response: d.worker_response, bounty_usdc: usdc(d.bounty_atomics), opened_at: iso(d.created_at) })) };
}

/**
 * Admin decision on a dispute. Two steps: the first call (no confirm) records a
 * preview and returns the table; the second, with confirm and that preview id,
 * decides. outcome "worker" pays the worker; "poster" refunds the poster.
 */
export async function resolveDispute(admin, disputeId, { outcome, note = '', confirm = false, preview_id: previewId = null } = {}) {
	requireUser(admin);
	if (!isUuid(disputeId)) fail(400, 'bad_request', 'dispute id must be a uuid');
	if (outcome !== 'worker' && outcome !== 'poster') fail(400, 'bad_outcome', 'outcome must be "worker" or "poster"');
	const [d] = await sql`SELECT * FROM human_task_disputes WHERE id = ${disputeId}`;
	if (!d) fail(404, 'dispute_not_found', 'Dispute not found.');
	if (d.status !== 'open') fail(409, 'dispute_closed', 'That dispute is already resolved.');
	const task = await loadTask(d.task_id);
	if (task.status !== 'disputed') throw new TransitionError(task.status, outcome === 'worker' ? 'approved' : 'cancelled');
	if (!confirm) {
		const id = `htd_${randomUUID().replace(/-/g, '')}`;
		const expires = new Date(Date.now() + PREVIEW_TTL_MS);
		await sql`
			UPDATE human_task_disputes SET resolve_preview_id = ${id}, resolve_preview_outcome = ${outcome},
			       resolve_preview_by = ${admin.id}, resolve_preview_expires_at = ${expires.toISOString()}
			WHERE id = ${d.id}
		`;
		const table = outcome === 'worker'
			? previewTable(task, releaseLegs(task))
			: [{ label: 'Task', value: task.title }, { label: 'Refund to the poster agent', value: `${usdc(task.escrow_atomics)} USDC` }, { label: 'Chain', value: `Solana ${task.network}` }];
		return { preview_id: id, outcome, expires_at: expires.toISOString(), table };
	}
	if (!previewId || previewId !== d.resolve_preview_id || d.resolve_preview_outcome !== outcome || d.resolve_preview_by !== admin.id
		|| !d.resolve_preview_expires_at || new Date(d.resolve_preview_expires_at) <= new Date()) {
		fail(409, 'preview_stale', 'Preview this exact resolution first. That preview is missing, expired, or for a different outcome.');
	}
	const [closed] = await sql`
		UPDATE human_task_disputes SET status = 'resolved', outcome = ${outcome}, resolution_note = ${String(note).slice(0, 2000)},
		       resolved_by = ${admin.id}, resolved_at = now(), resolve_preview_id = NULL
		WHERE id = ${d.id} AND status = 'open' RETURNING id
	`;
	if (!closed) fail(409, 'dispute_closed', 'That dispute was resolved a moment ago.');
	if (outcome === 'worker') {
		await move(task.id, 'disputed', 'approved', { approved_at: new Date(), approved_by: `admin:${admin.id}` });
		await event(task.id, 'admin', admin.id, 'dispute_resolved_worker', 'disputed', 'approved');
	} else {
		await move(task.id, 'disputed', 'cancelled', endUnpaid(task, 'dispute_resolved_for_poster'));
		await sql`UPDATE human_task_claims SET status = 'lost', updated_at = now() WHERE id = ${task.accepted_claim_id}`;
		await event(task.id, 'admin', admin.id, 'dispute_resolved_poster', 'disputed', 'cancelled');
	}
	logAudit({ userId: admin.id, action: 'human_task.dispute_resolve', resourceId: task.id, meta: { outcome } });
	const settled = await settleTask(task.id);
	return { task: await taskView(settled || (await loadTask(task.id)), { viewerId: admin.id }) };
}

// ── Reviews ──────────────────────────────────────────────────────────────────

/** Rate the other side once the task is over. Poster rates the worker; the worker rates the poster agent. */
export async function reviewTask(user, taskId, { rating, comment = '' } = {}) {
	requireUser(user);
	const task = await loadTask(taskId);
	const r = Math.floor(Number(rating));
	if (!(r >= 1 && r <= 5)) fail(400, 'bad_rating', 'rating must be 1 to 5');
	const isPoster = task.poster_user_id === user.id;
	const claim = isPoster ? null : await viewerClaim(task, user.id);
	if (!isPoster && !(claim && claim.id === task.accepted_claim_id)) fail(403, 'forbidden', 'Only the poster or the worker on this task can review it.');
	const role = isPoster ? 'poster' : 'worker';
	if (!canReview({ ...task, reviewed: await reviewedFlags(task.id) }, role)) fail(409, 'not_reviewable', 'This task cannot be reviewed yet, or you already reviewed it.');
	const [workerRow] = await sql`SELECT worker_user_id FROM human_task_claims WHERE id = ${task.accepted_claim_id}`;
	try {
		await sql`
			INSERT INTO human_task_reviews (task_id, reviewer_role, reviewer_user_id, subject_agent_id, subject_user_id, rating, comment)
			VALUES (${task.id}, ${role}, ${user.id}, ${isPoster ? null : task.poster_agent_id}, ${isPoster ? workerRow?.worker_user_id ?? null : null}, ${r}, ${String(comment || '').slice(0, 1000) || null})
		`;
	} catch (err) {
		if (String(err?.message || '').includes('human_task_reviews_once')) fail(409, 'not_reviewable', 'You already reviewed this task.');
		throw err;
	}
	await event(task.id, role, user.id, 'reviewed', task.status, task.status, { rating: r });
	return { ok: true, rating: r };
}

// ── External fulfillment ─────────────────────────────────────────────────────

async function withdrawExternal(task) {
	const adapter = adapterByName(task.external_provider);
	if (!adapter?.configured()) return;
	await adapter.withdraw(task);
}

/** Mirror stale open tasks to the external network, and withdraw mirrors for tasks that no longer need them. */
async function syncExternal(summary) {
	const adapter = activeAdapter();
	if (!adapter) return;
	const stale = await sql`
		SELECT * FROM human_tasks
		WHERE status = 'open' AND allow_external AND external_ref IS NULL AND deadline_at > now()
		  AND created_at < now() - make_interval(secs => ${EXTERNAL_MIRROR_AFTER_MS / 1000})
		  AND (external_error IS NULL OR updated_at < now() - interval '1 hour')
		ORDER BY created_at LIMIT 10
	`;
	for (const t of stale) {
		try {
			const { ref } = await adapter.mirror(t);
			await sql`UPDATE human_tasks SET external_provider = ${adapter.name}, external_ref = ${ref}, external_mirrored_at = now(), external_error = NULL WHERE id = ${t.id}`;
			await event(t.id, 'system', null, 'mirrored', 'open', 'open', { provider: adapter.name });
			summary.mirrored++;
		} catch (err) {
			await sql`UPDATE human_tasks SET external_error = ${String(err?.message).slice(0, 300)}, updated_at = now() WHERE id = ${t.id}`;
			summary.errors.push({ stage: 'mirror', task: t.id, message: err?.message });
		}
	}
	const done = await sql`
		SELECT * FROM human_tasks WHERE external_ref IS NOT NULL AND external_error IS NULL AND status <> 'open' AND external_mirrored_at IS NOT NULL
		ORDER BY updated_at DESC LIMIT 10
	`;
	for (const t of done) {
		try {
			await withdrawExternal(t);
			await sql`UPDATE human_tasks SET external_mirrored_at = NULL WHERE id = ${t.id}`;
			summary.withdrawn++;
		} catch (err) {
			summary.errors.push({ stage: 'withdraw', task: t.id, message: err?.message });
		}
	}
}

/**
 * Inbound callback from an external network. Never moves money: a submission
 * waits for the poster's approval like any other.
 */
export async function handleExternalCallback(event_) {
	const task = await loadTask(event_.task_id);
	const provider = task.external_provider;
	if (!provider || !task.external_ref) fail(409, 'not_mirrored', 'That task was not mirrored to an external network.');
	const workerRef = String(event_.worker_ref || '').slice(0, 200);
	if (!workerRef) fail(400, 'bad_event', 'worker_ref is required.');
	if (event_.event === 'claim') {
		const payout = String(event_.payout_address || '').trim();
		if (!isSolanaAddress(payout)) fail(400, 'bad_address', 'payout_address must be a Solana wallet address.');
		const claimId = randomUUID();
		await sql`
			INSERT INTO human_task_claims (id, task_id, worker_kind, external_provider, external_worker_ref, payout_address, verification_level)
			VALUES (${claimId}, ${task.id}, 'external', ${provider}, ${workerRef}, ${payout}, 0)
		`.catch((err) => {
			if (String(err?.message || '').includes('human_task_claims_one_live')) fail(409, 'already_claimed', 'The task already has a worker.');
			throw err;
		});
		const row = await moveIf(task.id, 'open', 'accepted', { accepted_claim_id: claimId, payout_address: payout }, sql`deadline_at > now()`);
		if (!row) {
			await sql`UPDATE human_task_claims SET status = 'lost', updated_at = now() WHERE id = ${claimId}`;
			fail(409, 'not_open', 'The task is no longer open.');
		}
		await event(task.id, 'external', null, 'claimed', 'open', 'accepted', { provider });
		return { ok: true };
	}
	const [claim] = await sql`
		SELECT * FROM human_task_claims WHERE id = ${task.accepted_claim_id} AND external_worker_ref = ${workerRef} AND worker_kind = 'external'
	`;
	if (!claim) fail(409, 'not_claimed', 'That worker does not hold this task.');
	if (event_.event === 'submit') {
		const urls = (Array.isArray(event_.photo_urls) ? event_.photo_urls : []).map(String).filter((u) => /^https:\/\//.test(u)).slice(0, MAX_PHOTOS);
		const notes = String(event_.notes || '').slice(0, 4000);
		if (!notes && !urls.length) fail(400, 'empty_submission', 'Submit notes, photos, or both.');
		await sql`INSERT INTO human_task_submissions (task_id, claim_id, notes, photos) VALUES (${task.id}, ${claim.id}, ${notes}, ${JSON.stringify(urls)}::jsonb)`;
		const row = await moveIf(task.id, 'accepted', 'submitted', { submitted_at: new Date(), review_due_at: new Date(Date.now() + REVIEW_WINDOW_MS) }, sql`deadline_at > now()`);
		if (!row) fail(409, 'invalid_transition', 'The task cannot take a submission now.');
		await sql`UPDATE human_task_claims SET status = 'submitted', updated_at = now() WHERE id = ${claim.id}`;
		await event(task.id, 'external', null, 'submitted', 'accepted', 'submitted', { provider });
		notify(task.poster_user_id, 'human_task_submitted', { task_id: task.id, title: task.title });
		return { ok: true };
	}
	if (event_.event === 'release') {
		await sql`UPDATE human_task_claims SET status = 'released', released_at = now(), updated_at = now() WHERE id = ${claim.id} AND status = 'active'`;
		const row = await move(task.id, 'accepted', 'open', { accepted_claim_id: null, payout_address: null });
		if (!row) fail(409, 'invalid_transition', 'The task cannot be released now.');
		await event(task.id, 'external', null, 'unclaimed', 'accepted', 'open', { provider });
		return { ok: true };
	}
	return fail(400, 'bad_event', `Unknown event "${event_.event}".`);
}

// ── Sweep ────────────────────────────────────────────────────────────────────

const BATCH = 25;

async function reconcileFunding(summary) {
	const stuck = await sql`
		SELECT t.* FROM human_tasks t WHERE t.status = 'funding' AND t.created_at < now() - interval '2 minutes' ORDER BY t.created_at LIMIT ${BATCH}
	`;
	for (const t of stuck) {
		const [ev] = await sql`
			SELECT status, signature, id FROM agent_custody_events
			WHERE agent_id = ${t.poster_agent_id} AND idempotency_key = ${`human-task:${t.id}`} LIMIT 1
		`;
		if (ev?.status === 'confirmed' && ev.signature) {
			if (await markFunded(t, ev.signature, Number(ev.id))) summary.funded++;
		} else if (ev?.status === 'pending' && new Date(t.created_at) > new Date(Date.now() - 30 * 60_000)) {
			continue;
		} else {
			const row = await move(t.id, 'funding', 'cancelled', { funding_error: 'escrow transfer never confirmed', cancelled_at: new Date(), cancel_reason: 'funding_failed' });
			if (row) {
				await event(t.id, 'system', null, 'funding_failed', 'funding', 'cancelled');
				summary.funding_cancelled++;
			}
		}
	}
}

async function expireTasks(summary) {
	const lapsed = await sql`
		SELECT * FROM human_tasks WHERE status IN ('open', 'accepted') AND deadline_at <= now() ORDER BY deadline_at LIMIT ${BATCH}
	`;
	for (const t of lapsed) {
		const row = await move(t.id, t.status, 'expired', endUnpaid(t, t.status === 'open' ? 'unclaimed_at_deadline' : 'no_proof_at_deadline'));
		if (!row) continue;
		if (t.status === 'accepted') await sql`UPDATE human_task_claims SET status = 'lapsed', updated_at = now() WHERE id = ${t.accepted_claim_id}`;
		await event(t.id, 'system', null, 'expired', t.status, 'expired');
		notify(t.poster_user_id, 'human_task_expired', { task_id: t.id, title: t.title });
		summary.expired++;
	}
}

async function autoApprove(summary) {
	const due = await sql`SELECT * FROM human_tasks WHERE status = 'submitted' AND review_due_at <= now() ORDER BY review_due_at LIMIT ${BATCH}`;
	for (const t of due) {
		const row = await move(t.id, 'submitted', 'approved', { approved_at: new Date(), approved_by: 'auto_review_deadline' });
		if (!row) continue;
		await event(t.id, 'system', null, 'auto_approved', 'submitted', 'approved');
		summary.auto_approved++;
	}
}

async function settleDue(summary) {
	const due = await sql`
		SELECT id FROM human_tasks
		WHERE (status = 'approved' OR (refund_status IN ('pending', 'failed') AND status IN ('cancelled', 'expired')))
		  AND (settle_locked_until IS NULL OR settle_locked_until < now())
		  AND updated_at < now() - interval '20 seconds'
		ORDER BY updated_at LIMIT ${BATCH}
	`;
	for (const { id } of due) {
		const row = await settleTask(id);
		if (row?.status === 'paid') summary.paid++;
		else if (row?.refund_status === 'sent') summary.refunded++;
		else if (row?.payout_error || row?.refund_error) summary.errors.push({ stage: 'settle', task: id, message: row.payout_error || row.refund_error });
	}
}

async function closeEscrows(summary) {
	const due = await sql`
		SELECT * FROM human_tasks
		WHERE escrow_closed_at IS NULL AND status IN ('paid', 'cancelled', 'expired')
		  AND (status = 'paid' OR refund_status IS NULL OR refund_status = 'sent')
		  AND funded_at IS NOT NULL
		ORDER BY updated_at LIMIT ${BATCH}
	`;
	for (const t of due) {
		try {
			const bal = await escrowBalance(t);
			if (bal > 0n) {
				summary.errors.push({ stage: 'close', task: t.id, message: `escrow still holds ${usdc(bal)} USDC` });
				continue;
			}
			const r = await closeTaskEscrow(t);
			if (r.closed) {
				await sql`UPDATE human_tasks SET escrow_closed_at = now(), escrow_close_signature = ${r.signature || null} WHERE id = ${t.id}`;
				summary.escrows_closed++;
			}
		} catch (err) {
			summary.errors.push({ stage: 'close', task: t.id, message: err?.message });
		}
	}
}

/** The cron tick. Each stage is bounded and idempotent, so an overlapping tick is safe. */
export async function runHumanTasksSweep() {
	const summary = {
		funded: 0, funding_cancelled: 0, expired: 0, auto_approved: 0, paid: 0, refunded: 0,
		escrows_closed: 0, mirrored: 0, withdrawn: 0, errors: [],
	};
	const stages = [reconcileFunding, expireTasks, autoApprove, settleDue, closeEscrows, syncExternal];
	for (const stage of stages) {
		try {
			await stage(summary);
		} catch (err) {
			summary.errors.push({ stage: stage.name, message: err?.message });
		}
	}
	return summary;
}

export { TERMINAL };
