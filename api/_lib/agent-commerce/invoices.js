// Agent invoices: issued by an agent (over MCP) or its owner (on /invoices),
// paid with any Solana wallet through a Solana Pay link or QR, and verified
// on-chain by reading the invoice's reference key.
//
// Lifecycle: open -> underpaid -> paid, or open|underpaid -> expired, or
// open -> cancelled. Every transition is a conditional UPDATE guarded on the
// status it read, so two verifiers racing (the cron and a payer pressing
// "I've paid") fire each webhook and notification exactly once.
//
// A payment that lands after the due date still settles the invoice (marked
// paid_late): the money has already moved, and an invoice that kept saying
// "expired" over a received payment would be a lie. The watcher keeps reading
// expired invoices for LATE_WATCH_HOURS for that reason.
//
// Income: paid_usd is fixed when the invoice becomes paid, from the amount
// actually received at the live price of that moment. Only mainnet invoices
// carry it; devnet is test traffic and never counts as earnings.

import { Keypair } from '@solana/web3.js';
import { sql } from '../db.js';
import { env } from '../env.js';
import { solanaConnection } from '../solana/connection.js';
import { insertNotification } from '../notify.js';
import { dispatchWebhooks } from '../webhook-dispatch.js';
import { validateSolanaAddress } from '../agent-trade-guards.js';
import { getOrCreateAgentSolanaWallet } from '../agent-wallet.js';
import {
	CommerceError, assetSpec, atomicsToUsd, formatAtomics, normalizeAsset, normalizeNetwork, parseAmount,
} from './assets.js';
import { classifyPayment, explorerTxUrl, findReferenceTransactions, invoiceChainMemo, solanaPayUrl } from './solana-pay.js';

export const INVOICE_STATUSES = Object.freeze(['open', 'underpaid', 'paid', 'expired', 'cancelled']);
export const DEFAULT_DUE_HOURS = 72;
export const MIN_DUE_MINUTES = 5;
export const MAX_DUE_DAYS = 90;
export const LATE_WATCH_HOURS = 24;
export const MEMO_MAX = 140;
export const DESCRIPTION_MAX = 1000;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A short, unambiguous invoice number: INV-7K3QX9MD. */
export function newInvoiceNumber() {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return `INV-${Array.from(bytes, (b) => CROCKFORD[b % 32]).join('')}`;
}

function cleanText(raw, max, field, { required = false } = {}) {
	const s = String(raw ?? '')
		// Control characters would end up in a wallet prompt and an on-chain memo.
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (required && !s) throw new CommerceError('invalid_' + field, `${field} is required`);
	if (s.length > max) throw new CommerceError('invalid_' + field, `${field} must be at most ${max} characters`);
	return s || null;
}

/** Resolve due_at / due_in_hours into a Date inside the allowed window. */
export function resolveDueAt({ due_at, due_in_hours } = {}, now = new Date()) {
	let due;
	if (due_at != null && due_at !== '') {
		due = new Date(due_at);
		if (Number.isNaN(due.getTime())) throw new CommerceError('invalid_due_at', 'due_at must be an ISO 8601 timestamp');
	} else {
		const hours = due_in_hours == null || due_in_hours === '' ? DEFAULT_DUE_HOURS : Number(due_in_hours);
		if (!Number.isFinite(hours) || hours <= 0) throw new CommerceError('invalid_due_at', 'due_in_hours must be a positive number');
		due = new Date(now.getTime() + hours * 3600_000);
	}
	const ms = due.getTime() - now.getTime();
	if (ms < MIN_DUE_MINUTES * 60_000) {
		throw new CommerceError('invalid_due_at', `the due date must be at least ${MIN_DUE_MINUTES} minutes away`);
	}
	if (ms > MAX_DUE_DAYS * 86_400_000) throw new CommerceError('invalid_due_at', `the due date must be within ${MAX_DUE_DAYS} days`);
	return due;
}

async function loadAgentForUser(agentId, userId) {
	if (!agentId) throw new CommerceError('agent_required', 'agent_id is required', 400);
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw new CommerceError('agent_not_found', 'agent not found', 404);
	if (row.user_id !== userId) throw new CommerceError('forbidden', 'that agent is not yours', 403);
	return row;
}

export function invoicePageUrl(id) {
	return `${env.APP_ORIGIN}/invoices/${id}`;
}

/**
 * The invoice as callers see it. `owner` adds the fields only the issuer
 * should read (USD income, metadata, the linked order).
 */
export function shapeInvoice(row, { owner = false, payments = null, events = null } = {}) {
	if (!row) return null;
	const amount = BigInt(row.amount_atomics);
	const paid = BigInt(row.paid_atomics || 0);
	const remaining = amount > paid ? amount - paid : 0n;
	const settled = row.status === 'paid' || row.status === 'cancelled';
	const out = {
		id: row.id,
		number: row.number,
		status: row.status,
		asset: row.asset,
		symbol: row.asset === 'THREE' ? '$THREE' : row.asset,
		network: row.network,
		chain: 'solana',
		mint: row.mint,
		decimals: row.decimals,
		amount: formatAtomics(amount, row.decimals),
		amount_atomics: amount.toString(),
		paid: formatAtomics(paid, row.decimals),
		paid_atomics: paid.toString(),
		remaining: formatAtomics(remaining, row.decimals),
		memo: row.memo,
		description: row.description || null,
		chain_memo: invoiceChainMemo(row.number),
		reference: row.reference,
		payer: row.payer_address ? { address: row.payer_address, label: row.payer_label || null } : null,
		open_to_anyone: !row.payer_address,
		recipient: row.recipient_address,
		agent: row.agent_id ? { id: row.agent_id, name: row.agent_name || null } : null,
		created_by: row.created_by,
		due_at: iso(row.due_at),
		created_at: iso(row.created_at),
		paid_at: iso(row.paid_at),
		paid_late: row.paid_late === true,
		paid_by: row.paid_by || null,
		expired_at: iso(row.expired_at),
		cancelled_at: iso(row.cancelled_at),
		pay_url: settled ? null : solanaPayUrl(row),
		page_url: invoicePageUrl(row.id),
		qr_url: settled ? null : `${env.APP_ORIGIN}/api/agent-commerce/pay/${row.id}/qr.svg`,
	};
	if (payments) out.payments = payments.map((p) => shapePayment(p, row.network));
	if (events) out.timeline = events.map((e) => ({ type: e.type, at: iso(e.created_at), data: e.data || {} }));
	if (owner) {
		out.paid_usd = row.paid_usd != null ? Number(row.paid_usd) : null;
		out.cancel_reason = row.cancel_reason || null;
		out.order_id = row.order_id || null;
		out.last_checked_at = iso(row.last_checked_at);
		out.metadata = row.metadata || {};
	}
	return out;
}

function shapePayment(p, network) {
	return {
		signature: p.signature,
		payer: p.payer || null,
		amount_atomics: String(p.amount_atomics),
		counted: p.counted === true,
		reject_reason: p.reject_reason || null,
		memo: p.memo || null,
		block_time: iso(p.block_time),
		explorer_url: explorerTxUrl(p.signature, network),
	};
}

function iso(v) {
	if (!v) return null;
	const d = v instanceof Date ? v : new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function recordEvent(invoiceId, type, data = {}) {
	await sql`
		INSERT INTO agent_commerce_invoice_events (invoice_id, type, data)
		VALUES (${invoiceId}, ${type}, ${JSON.stringify(data)}::jsonb)
	`;
}

const SELECT_INVOICE = (where) => sql`
	SELECT i.*, a.name AS agent_name
	FROM agent_commerce_invoices i
	LEFT JOIN agent_identities a ON a.id = i.agent_id
	WHERE ${where}
`;

async function loadInvoice(id) {
	if (!isUuid(id)) return null;
	const [row] = await SELECT_INVOICE(sql`i.id = ${id}`);
	return row || null;
}

export function isUuid(v) {
	return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Create an invoice. The money always goes to the issuing agent's own Solana
 * wallet, so neither an agent nor a leaked token can point an invoice at an
 * address the owner does not control.
 */
export async function createInvoice({
	userId, agentId, createdBy = 'owner', amount, asset, network, memo, description,
	payer, payerLabel, dueAt, dueInHours, orderId = null, metadata = {},
}) {
	const agent = await loadAgentForUser(agentId, userId);
	const a = normalizeAsset(asset);
	const net = normalizeNetwork(network);
	const spec = assetSpec(a, net);
	const atomics = parseAmount(amount, spec.decimals);
	const memoText = cleanText(memo, MEMO_MAX, 'memo', { required: true });
	const desc = cleanText(description, DESCRIPTION_MAX, 'description');
	const due = resolveDueAt({ due_at: dueAt, due_in_hours: dueInHours });

	const { address: recipient } = await getOrCreateAgentSolanaWallet(agent.id);
	let payerAddress = null;
	if (payer != null && payer !== '') {
		const v = validateSolanaAddress(String(payer).trim());
		if (!v.valid) throw new CommerceError('invalid_payer', `payer is not a valid Solana address (${v.reason})`);
		if (v.base58 === recipient) throw new CommerceError('invalid_payer', 'an agent cannot invoice its own wallet');
		payerAddress = v.base58;
	}
	const label = cleanText(payerLabel, 80, 'payer_label');

	let row;
	for (let attempt = 0; attempt < 4 && !row; attempt++) {
		const number = newInvoiceNumber();
		const reference = Keypair.generate().publicKey.toBase58();
		const rows = await sql`
			INSERT INTO agent_commerce_invoices
				(number, user_id, agent_id, created_by, payer_address, payer_label, recipient_address,
				 network, asset, mint, decimals, amount_atomics, memo, description, reference, due_at,
				 order_id, metadata)
			VALUES
				(${number}, ${userId}, ${agent.id}, ${createdBy === 'agent' ? 'agent' : 'owner'},
				 ${payerAddress}, ${label}, ${recipient}, ${net}, ${a}, ${spec.mint}, ${spec.decimals},
				 ${atomics.toString()}, ${memoText}, ${desc}, ${reference}, ${due.toISOString()},
				 ${orderId}, ${JSON.stringify(metadata || {})}::jsonb)
			ON CONFLICT (number) DO NOTHING
			RETURNING *
		`;
		row = rows[0];
	}
	if (!row) throw new CommerceError('number_exhausted', 'could not allocate an invoice number, try again', 503);
	row.agent_name = agent.name;

	await recordEvent(row.id, 'created', { created_by: row.created_by, amount: formatAtomics(atomics, spec.decimals), asset: a, network: net });
	const shaped = shapeInvoice(row, { owner: true });
	await announce(row, 'invoice.created', shaped);
	return shaped;
}

/** The issuer's view of one invoice, with payments and timeline. */
export async function getInvoiceForOwner(userId, id) {
	const row = await loadInvoice(id);
	if (!row || row.user_id !== userId) throw new CommerceError('not_found', 'invoice not found', 404);
	return shapeWithHistory(row, { owner: true });
}

/** The public view: what a payer or a receipt reader may see. */
export async function getInvoicePublic(id) {
	const row = await loadInvoice(id);
	if (!row) throw new CommerceError('not_found', 'invoice not found', 404);
	return shapeWithHistory(row, { owner: false });
}

async function shapeWithHistory(row, { owner }) {
	const [payments, events] = await Promise.all([
		sql`SELECT * FROM agent_commerce_invoice_payments WHERE invoice_id = ${row.id} ORDER BY block_time NULLS LAST, created_at`,
		sql`SELECT type, data, created_at FROM agent_commerce_invoice_events WHERE invoice_id = ${row.id} ORDER BY id`,
	]);
	return shapeInvoice(row, { owner, payments, events });
}

/** The raw row (for callers inside the commerce layer). */
export async function loadInvoiceRow(id) {
	return loadInvoice(id);
}

/**
 * The issuer's invoices, newest first. Narrow by agent and/or status. Cursor
 * pagination on created_at so a long ledger never needs an OFFSET scan.
 */
export async function listInvoices({ userId, agentId = null, status = null, limit = 25, before = null }) {
	const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
	if (status && !INVOICE_STATUSES.includes(status)) {
		throw new CommerceError('invalid_status', `status must be one of ${INVOICE_STATUSES.join(', ')}`);
	}
	if (agentId && !isUuid(agentId)) throw new CommerceError('invalid_agent_id', 'agent_id must be a uuid');
	const beforeDate = before ? new Date(before) : null;
	if (beforeDate && Number.isNaN(beforeDate.getTime())) throw new CommerceError('invalid_cursor', 'before must be an ISO timestamp');
	const rows = await sql`
		SELECT i.*, a.name AS agent_name
		FROM agent_commerce_invoices i
		LEFT JOIN agent_identities a ON a.id = i.agent_id
		WHERE i.user_id = ${userId}
		  AND (${agentId}::uuid IS NULL OR i.agent_id = ${agentId}::uuid)
		  AND (${status}::text IS NULL OR i.status = ${status}::text)
		  AND (${beforeDate ? beforeDate.toISOString() : null}::timestamptz IS NULL OR i.created_at < ${beforeDate ? beforeDate.toISOString() : null}::timestamptz)
		ORDER BY i.created_at DESC
		LIMIT ${lim + 1}
	`;
	const page = rows.slice(0, lim);
	const [totals] = await sql`
		SELECT
			count(*) FILTER (WHERE status IN ('open', 'underpaid'))::int AS outstanding,
			count(*) FILTER (WHERE status = 'paid')::int AS paid,
			count(*) FILTER (WHERE status = 'expired')::int AS expired,
			COALESCE(sum(paid_usd) FILTER (WHERE status = 'paid' AND network = 'mainnet'), 0)::float8 AS paid_usd
		FROM agent_commerce_invoices
		WHERE user_id = ${userId} AND (${agentId}::uuid IS NULL OR agent_id = ${agentId}::uuid)
	`;
	return {
		invoices: page.map((r) => shapeInvoice(r, { owner: true })),
		next_before: rows.length > lim ? iso(page[page.length - 1].created_at) : null,
		totals: {
			outstanding: totals?.outstanding || 0,
			paid: totals?.paid || 0,
			expired: totals?.expired || 0,
			paid_usd: Math.round((totals?.paid_usd || 0) * 100) / 100,
		},
	};
}

/**
 * Cancel an invoice nobody has paid yet. A partly paid invoice cannot be
 * cancelled: money arrived against it, and cancelling would hide that.
 * `agentId`, when given, limits the cancel to invoices that agent issued.
 */
export async function cancelInvoice({ userId, id, agentId = null, reason = null }) {
	const row = await loadInvoice(id);
	if (!row || row.user_id !== userId || (agentId && row.agent_id !== agentId)) {
		throw new CommerceError('not_found', 'invoice not found', 404);
	}
	if (row.status === 'cancelled') return shapeInvoice(row, { owner: true });
	if (row.status !== 'open') {
		throw new CommerceError(
			'not_cancellable',
			row.status === 'underpaid'
				? 'This invoice is partly paid, so it cannot be cancelled. Settle or refund the payer instead.'
				: `A ${row.status} invoice cannot be cancelled.`,
			409,
		);
	}
	// Read the chain once more first: a payment that landed seconds ago must
	// settle the invoice rather than be cancelled out from under the payer.
	const fresh = await verifyInvoice(id).catch(() => null);
	if (fresh && fresh.status !== 'open') {
		throw new CommerceError('not_cancellable', `A payment just arrived; the invoice is now ${fresh.status}.`, 409);
	}
	const why = cleanText(reason, 200, 'reason');
	const [updated] = await sql`
		UPDATE agent_commerce_invoices
		SET status = 'cancelled', cancelled_at = now(), cancel_reason = ${why}, updated_at = now()
		WHERE id = ${id} AND status = 'open'
		RETURNING *
	`;
	if (!updated) throw new CommerceError('not_cancellable', 'The invoice changed while cancelling; reload it.', 409);
	updated.agent_name = row.agent_name;
	await recordEvent(id, 'cancelled', { reason: why });
	const shaped = shapeInvoice(updated, { owner: true });
	await announce(updated, 'invoice.cancelled', shaped);
	return shaped;
}

/**
 * Read the chain for an invoice and apply whatever it shows. Safe to call any
 * number of times from anywhere: payments are keyed by signature and every
 * status move is guarded on the status it read.
 *
 * @param {string} id
 * @param {{ connection?: import('@solana/web3.js').Connection, now?: Date }} [opts]
 */
export async function verifyInvoice(id, { connection = null, now = new Date() } = {}) {
	const row = await loadInvoice(id);
	if (!row) throw new CommerceError('not_found', 'invoice not found', 404);
	if (row.status === 'paid') return shapeWithHistory(row, { owner: false });

	const conn = connection || solanaConnection({ network: row.network });
	const txs = await findReferenceTransactions(conn, row.reference);

	const fresh = [];
	for (const { signature, slot, blockTime, tx } of txs) {
		const c = classifyPayment(tx, row);
		const inserted = await sql`
			INSERT INTO agent_commerce_invoice_payments
				(invoice_id, signature, payer, amount_atomics, memo, counted, reject_reason, slot, block_time)
			VALUES (${row.id}, ${signature}, ${c.payer}, ${c.amount.toString()}, ${c.memo}, ${c.counted},
			        ${c.reason}, ${slot ?? null}, ${blockTime ? new Date(blockTime * 1000).toISOString() : null})
			ON CONFLICT (signature) DO NOTHING
			RETURNING *
		`;
		if (inserted[0]) fresh.push(inserted[0]);
	}
	for (const p of fresh) {
		await recordEvent(row.id, p.counted ? 'payment' : 'payment_ignored', {
			signature: p.signature,
			payer: p.payer,
			amount: formatAtomics(BigInt(p.amount_atomics), row.decimals),
			...(p.counted ? {} : { reason: p.reject_reason }),
		});
	}

	const counted = await sql`
		SELECT signature, payer, amount_atomics, block_time FROM agent_commerce_invoice_payments
		WHERE invoice_id = ${row.id} AND counted
		ORDER BY block_time NULLS LAST, created_at
	`;
	const due = BigInt(row.amount_atomics);
	let paid = 0n;
	let crossedAt = null;
	for (const p of counted) {
		paid += BigInt(p.amount_atomics);
		if (!crossedAt && paid >= due) crossedAt = p.block_time ? new Date(p.block_time) : now;
	}
	const firstPayer = counted[0]?.payer || null;
	const next = nextStatus({ status: row.status, due, paid, dueAt: new Date(row.due_at), now });

	let current = row;
	if (next !== row.status || paid !== BigInt(row.paid_atomics || 0)) {
		const paidLate = next === 'paid' && crossedAt ? crossedAt.getTime() > new Date(row.due_at).getTime() : false;
		const paidUsd = next === 'paid' && row.network === 'mainnet' ? await atomicsToUsd(row.asset, paid, row.decimals) : null;
		const [updated] = await sql`
			UPDATE agent_commerce_invoices SET
				status = ${next},
				paid_atomics = ${paid.toString()},
				paid_by = COALESCE(paid_by, ${firstPayer}),
				paid_at = CASE WHEN ${next} = 'paid' THEN ${crossedAt ? crossedAt.toISOString() : now.toISOString()}::timestamptz ELSE paid_at END,
				paid_late = CASE WHEN ${next} = 'paid' THEN ${paidLate} ELSE paid_late END,
				paid_usd = CASE WHEN ${next} = 'paid' THEN ${paidUsd}::numeric ELSE paid_usd END,
				expired_at = CASE WHEN ${next} = 'expired' AND expired_at IS NULL THEN now() ELSE expired_at END,
				last_checked_at = now(),
				updated_at = now()
			WHERE id = ${row.id} AND status = ${row.status}
			RETURNING *
		`;
		if (updated) {
			updated.agent_name = row.agent_name;
			current = updated;
			await onTransition(row, updated, fresh.filter((p) => p.counted));
		} else {
			// Another verifier moved it first; report what it wrote.
			current = (await loadInvoice(row.id)) || row;
		}
	} else {
		await sql`UPDATE agent_commerce_invoices SET last_checked_at = now() WHERE id = ${row.id}`;
	}
	return shapeWithHistory(current, { owner: false });
}

/** Where an invoice stands given what has been received and the clock. */
export function nextStatus({ status, due, paid, dueAt, now }) {
	if (status === 'cancelled') return 'cancelled';
	if (paid >= due) return 'paid';
	if (now.getTime() > dueAt.getTime()) return 'expired';
	if (paid > 0n) return 'underpaid';
	return 'open';
}

async function onTransition(before, after, newCounted) {
	const shaped = shapeInvoice(after, { owner: true });
	if (after.status === 'paid') {
		await recordEvent(after.id, 'paid', { paid: shaped.paid, paid_late: shaped.paid_late, paid_usd: shaped.paid_usd });
		await announce(after, 'invoice.paid', shaped);
		if (after.order_id) await settleOrder(after);
		return;
	}
	if (after.status === 'expired' && before.status !== 'expired') {
		await recordEvent(after.id, 'expired', { paid: shaped.paid, remaining: shaped.remaining });
		await announce(after, 'invoice.expired', shaped);
		if (after.order_id) await failOrder(after.order_id, 'invoice_expired');
		return;
	}
	if (after.status === 'underpaid' && newCounted.length) {
		await recordEvent(after.id, 'underpaid', { paid: shaped.paid, remaining: shaped.remaining });
		await announce(after, 'invoice.underpaid', shaped);
	}
}

const NOTIFY_TYPE = {
	'invoice.paid': 'invoice_paid',
	'invoice.underpaid': 'invoice_underpaid',
	'invoice.expired': 'invoice_expired',
};

/** Webhook + in-app notification for one invoice event. Never throws. */
async function announce(row, eventType, shaped) {
	const data = { invoice: { ...shaped, metadata: undefined, last_checked_at: undefined } };
	await dispatchWebhooks({ userId: row.user_id, eventType, data, agentId: row.agent_id || null }).catch((err) =>
		console.warn('[agent-commerce] webhook dispatch failed', eventType, err?.message),
	);
	const type = NOTIFY_TYPE[eventType];
	if (!type) return;
	await insertNotification(row.user_id, type, {
		invoice_id: row.id,
		number: row.number,
		amount: shaped.amount,
		paid: shaped.paid,
		remaining: shaped.remaining,
		symbol: shaped.symbol,
		network: row.network,
		agent_id: row.agent_id,
		agent_name: row.agent_name || null,
		link: `/invoices/${row.id}`,
	});
}

// ── Orders paid through invoices ─────────────────────────────────────────────

async function settleOrder(inv) {
	const [order] = await sql`
		UPDATE agent_commerce_orders
		SET status = 'paid', delivered_at = now(), updated_at = now()
		WHERE id = ${inv.order_id} AND status IN ('pending', 'submitted', 'failed')
		RETURNING *
	`;
	if (!order) return;
	const [offer] = await sql`
		UPDATE agent_commerce_offers SET sold_count = sold_count + 1, updated_at = now()
		WHERE id = ${order.offer_id}
		RETURNING title
	`;
	await insertNotification(order.buyer_user_id, 'commerce_order_delivered', {
		order_id: order.id,
		offer_title: offer?.title || null,
		invoice_id: inv.id,
		link: `/invoices/${inv.id}`,
	});
}

async function failOrder(orderId, reason) {
	await sql`
		UPDATE agent_commerce_orders SET status = 'failed', error = ${reason}, updated_at = now()
		WHERE id = ${orderId} AND status IN ('pending', 'submitted')
	`;
}

// ── The watcher ──────────────────────────────────────────────────────────────

/**
 * One watcher pass: verify every invoice still waiting for money (oldest
 * check first), then expired invoices from the last LATE_WATCH_HOURS so a late
 * payment still settles. Bounded by `limit` and a wall-clock deadline; the
 * next tick continues where this one stopped because last_checked_at moved.
 */
export async function sweepInvoices({ limit = 60, concurrency = 4, deadlineMs = 50_000 } = {}) {
	const started = Date.now();
	const rows = await sql`
		(SELECT id FROM agent_commerce_invoices
		 WHERE status IN ('open', 'underpaid')
		 ORDER BY last_checked_at NULLS FIRST
		 LIMIT ${limit})
		UNION ALL
		(SELECT id FROM agent_commerce_invoices
		 WHERE status = 'expired'
		   AND expired_at > now() - make_interval(hours => ${LATE_WATCH_HOURS})
		   AND (last_checked_at IS NULL OR last_checked_at < now() - interval '5 minutes')
		 ORDER BY last_checked_at NULLS FIRST
		 LIMIT ${Math.max(1, Math.floor(limit / 4))})
	`;
	const queue = rows.map((r) => r.id);
	const result = { checked: 0, paid: 0, underpaid: 0, expired: 0, errors: 0, remaining: 0 };
	const connections = new Map();
	const connFor = (network) => {
		if (!connections.has(network)) connections.set(network, solanaConnection({ network }));
		return connections.get(network);
	};
	const networks = new Map(
		(await sql`SELECT id, network, status FROM agent_commerce_invoices WHERE id = ANY(${queue}::uuid[])`).map((r) => [r.id, r]),
	);
	async function worker() {
		while (queue.length && Date.now() - started < deadlineMs) {
			const id = queue.shift();
			const before = networks.get(id);
			try {
				const after = await verifyInvoice(id, { connection: connFor(before?.network || 'mainnet') });
				result.checked++;
				if (after.status !== before?.status && after.status in result) result[after.status]++;
			} catch (err) {
				result.errors++;
				console.warn('[agent-commerce] verify failed', id, err?.message);
				// Push it to the back of the queue for the next tick rather than
				// retrying a failing RPC lane in a hot loop.
				await sql`UPDATE agent_commerce_invoices SET last_checked_at = now() WHERE id = ${id}`.catch(() => {});
			}
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
	result.remaining = queue.length;
	return result;
}

