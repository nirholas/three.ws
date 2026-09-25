// Settlement: the one idempotent state machine that turns an accepted bid into
// a paid seller and an agent the buyer alone controls.
//
//   pay_seller -> pay_fee -> prepare_keys -> sweep_wallet -> swap_keys
//     -> revoke_access -> detach_history -> reassign_owner -> destroy_old_key
//     -> finalize -> done
//
// `agent_transfers.step` is the resume point. A step runs, then the row
// advances with a compare-and-set on the step it ran, so a crash at any point
// re-runs at most the step in progress, and every step is written to be safe to
// re-run (on-chain legs through chain.js sendLeg, database writes conditional
// on the state they expect). A lease (`locked_until`) keeps two workers from
// driving one transfer at once; an expired lease is how a dead worker's
// transfer gets picked back up by the marketplace-escrow-sweep cron.

import { sql } from '../db.js';
import { insertNotification } from '../notify.js';
import { logAudit } from '../audit.js';
import { getFeeBps } from '../fee.js';
import { loadBuybackSigner } from '../token/buyback.js';
import { treasuryWalletOrNull } from '../token/config.js';
import { marketplaceFeeRecipient } from '../marketplace-platform-fee.js';
import { SOLANA_USDC_MINT } from '../../payments/_config.js';
import {
	currencyInfo, formatAtomics, marketConnection, marketNetwork, sendLeg, tokenProgramFor, transferIxs, withEscrowKeypair,
} from './chain.js';
import {
	destroyOldKey, detachHistory, loadAgent, prepareNewKeys, reassignOwner, repointPositions,
	revokeSellerAccess, swapKeys, sweepOldEvmWallet, sweepOldWallet,
} from './custody.js';
import { addHistory } from './store.js';
import { recordCustodyEvent } from '../agent-trade-guards.js';

export const STEPS = [
	'pay_seller',
	'pay_fee',
	'prepare_keys',
	'sweep_wallet',
	'swap_keys',
	'revoke_access',
	'detach_history',
	'reassign_owner',
	'destroy_old_key',
	'finalize',
];

export const STEP_LABELS = {
	pay_seller: 'Pay the seller from escrow',
	pay_fee: 'Route the platform fee',
	prepare_keys: 'Generate the new wallet keys',
	sweep_wallet: 'Sweep the old wallet',
	swap_keys: 'Install the new keys',
	revoke_access: "Revoke the seller's access",
	detach_history: 'Apply the history setting',
	reassign_owner: 'Transfer ownership',
	destroy_old_key: 'Destroy the old key',
	finalize: 'Close the sale',
};

// Long enough for the slowest step (a sweep of many token accounts, each leg
// confirming for up to 90 seconds); renewed on every step advance.
const LEASE_SECONDS = 600;
const MAX_FEE_BPS = 1000;

export function nextStep(step) {
	const i = STEPS.indexOf(step);
	if (i < 0) throw new Error(`unknown settlement step ${step}`);
	return i === STEPS.length - 1 ? 'done' : STEPS[i + 1];
}

// ── Fees ─────────────────────────────────────────────────────────────────────

/** The sale fee rate: AGENT_MARKET_FEE_BPS, else the platform rate, capped. */
export function saleFeeBps() {
	const raw = process.env.AGENT_MARKET_FEE_BPS;
	const n = raw == null || String(raw).trim() === '' ? getFeeBps() : parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(n, MAX_FEE_BPS);
}

/**
 * Where the sale fee goes: USDC to the $THREE buyback wallet, whose balance the
 * run-three-buyback cron turns into market buys routed to the treasury; $THREE
 * straight to the treasury. Falls back to the marketplace fee wallet. Null means
 * no fee can be routed, and the sale then charges none.
 */
export async function feeRecipient(currency) {
	if (currency === 'THREE') {
		const treasury = treasuryWalletOrNull();
		if (treasury) return treasury;
	} else {
		const signer = await loadBuybackSigner().catch(() => null);
		if (signer) return signer.publicKey.toBase58();
	}
	const fallback = await marketplaceFeeRecipient();
	return fallback ? fallback.toBase58() : null;
}

/** Fee rate to lock in at accept time: zero when nothing could receive it. */
export async function effectiveFeeBps(currency) {
	const bps = saleFeeBps();
	if (bps === 0) return 0;
	return (await feeRecipient(currency)) ? bps : 0;
}

// ── Store (swappable for tests) ──────────────────────────────────────────────

export const dbStore = {
	async lease(transferId) {
		const [row] = await sql`
			UPDATE agent_transfers
			SET locked_until = now() + make_interval(secs => ${LEASE_SECONDS}), attempts = attempts + 1,
			    status = 'in_progress', updated_at = now()
			WHERE id = ${transferId} AND status <> 'completed'
			  AND (locked_until IS NULL OR locked_until < now())
			RETURNING *
		`;
		return row || null;
	},
	async load(transferId) {
		const [row] = await sql`SELECT * FROM agent_transfers WHERE id = ${transferId}`;
		return row || null;
	},
	async advance(transferId, from, to) {
		const [row] = await sql`
			UPDATE agent_transfers
			SET step = ${to}, last_error = NULL, updated_at = now(),
			    locked_until = now() + make_interval(secs => ${LEASE_SECONDS}),
			    status = CASE WHEN ${to} = 'done' THEN 'completed' ELSE status END,
			    completed_at = CASE WHEN ${to} = 'done' THEN now() ELSE completed_at END
			WHERE id = ${transferId} AND step = ${from}
			RETURNING *
		`;
		if (!row) throw new Error(`transfer ${transferId} left step ${from} under another worker`);
		return row;
	},
	async fail(transferId, step, message) {
		await sql`
			UPDATE agent_transfers
			SET status = 'failed', last_error = ${`${step}: ${message}`.slice(0, 600)}, locked_until = NULL, updated_at = now()
			WHERE id = ${transferId}
		`;
	},
	async release(transferId) {
		await sql`UPDATE agent_transfers SET locked_until = NULL WHERE id = ${transferId}`;
	},
};

// ── Steps ────────────────────────────────────────────────────────────────────

async function loadListing(listingId) {
	const [row] = await sql`SELECT * FROM agent_listings WHERE id = ${listingId}`;
	return row;
}

function legRecorder(transferId, column) {
	return async (legId, rec) => {
		await sql`
			UPDATE agent_transfers
			SET legs = legs || jsonb_build_object(${legId}::text, ${JSON.stringify(rec)}::jsonb),
			    payout_signature = CASE WHEN ${column} = 'payout' THEN ${rec.signature} ELSE payout_signature END,
			    fee_signature = CASE WHEN ${column} = 'fee' THEN ${rec.signature} ELSE fee_signature END,
			    updated_at = now()
			WHERE id = ${transferId}
		`;
	};
}

async function escrowPay({ transfer, listing, legId, column, to, atomics }) {
	const connection = marketConnection();
	const info = currencyInfo(transfer.currency);
	const programId = await tokenProgramFor(connection, info.mint);
	const record = legRecorder(transfer.id, column);
	return withEscrowKeypair(listing, (escrow) =>
		sendLeg({
			connection,
			legId,
			prior: transfer.legs?.[legId] || null,
			signers: [escrow],
			build: (reference, payer) =>
				transferIxs({
					owner: escrow.publicKey.toBase58(), recipient: to, mint: info.mint, programId,
					decimals: info.decimals, atomics: BigInt(String(atomics)), rentPayer: payer.toBase58(), reference,
				}),
			onPrepared: (rec) => record(legId, rec),
		}),
	);
}

async function recordFeeRevenue(transfer, signature) {
	if (transfer.currency !== 'USDC') return;
	const intentId = `agent-market:${transfer.id}`;
	const fee = String(transfer.fee_atomics);
	await sql`
		INSERT INTO agent_payment_intents
			(id, payer_user_id, agent_id, currency_mint, amount, memo, start_time, end_time, status, cluster, tx_signature, paid_at, payload, expires_at)
		VALUES (
			${intentId}, ${transfer.buyer_user_id}, ${transfer.agent_id}, ${SOLANA_USDC_MINT}, ${String(transfer.amount_atomics)},
			${`agent sale ${transfer.listing_id}`}, now(), now(), 'paid', ${marketNetwork()}, ${signature}, now(),
			${JSON.stringify({ kind: 'agent_sale', transfer_id: transfer.id, listing_id: transfer.listing_id })}::jsonb, now()
		)
		ON CONFLICT (id) DO NOTHING
	`;
	// gross = net = the platform's share only: the sale proceeds are the
	// seller's, not the agent's earnings, so the agent is credited nothing.
	await sql`
		INSERT INTO agent_revenue_events
			(agent_id, intent_id, skill, gross_amount, fee_amount, net_amount, currency_mint, chain, payer_address, owner_user_id)
		VALUES (${transfer.agent_id}, ${intentId}, 'marketplace:agent_sale', ${fee}, ${fee}, 0, ${SOLANA_USDC_MINT}, 'solana', NULL, ${transfer.seller_user_id})
		ON CONFLICT (intent_id) DO NOTHING
	`;
}

export const defaultSteps = {
	async pay_seller({ transfer, listing }) {
		const legId = `payout:${transfer.id}`;
		const { signature } = await escrowPay({
			transfer, listing, legId, column: 'payout', to: listing.payout_address, atomics: transfer.seller_net_atomics,
		});
		await addHistory({
			agentId: transfer.agent_id, listingId: listing.id, bidId: transfer.bid_id, transferId: transfer.id,
			actorUserId: transfer.seller_user_id, event: 'seller_paid', currency: transfer.currency,
			amount: transfer.seller_net_atomics, signature, meta: { to: listing.payout_address },
		});
	},

	async pay_fee({ transfer, listing }) {
		if (BigInt(String(transfer.fee_atomics)) <= 0n) return;
		const to = await feeRecipient(transfer.currency);
		if (!to) throw Object.assign(new Error('no fee wallet is configured'), { code: 'fee_wallet_unavailable' });
		const legId = `fee:${transfer.id}`;
		const { signature } = await escrowPay({ transfer, listing, legId, column: 'fee', to, atomics: transfer.fee_atomics });
		await recordFeeRevenue(transfer, signature);
		await addHistory({
			agentId: transfer.agent_id, listingId: listing.id, transferId: transfer.id, event: 'fee_routed',
			currency: transfer.currency, amount: transfer.fee_atomics, signature, meta: { to },
		});
	},

	async prepare_keys({ transfer, agent }) {
		await prepareNewKeys(transfer, agent);
	},

	async sweep_wallet({ transfer, listing, agent }) {
		const pending = transfer.rotation?.pending;
		const destination = listing.include_balance ? pending.solana_address : listing.payout_address;
		await sweepOldWallet({ transfer, agent, destination });
		if (pending?.old_evm_address) {
			// Base funds follow the balance setting when the seller named an EVM
			// payout address; otherwise they transfer with the agent.
			const evmDest = listing.include_balance || !listing.snapshot?.payout_evm_address
				? pending.evm_address
				: listing.snapshot.payout_evm_address;
			await sweepOldEvmWallet({ transfer: await dbStore.load(transfer.id), agent, destination: evmDest });
		}
		await repointPositions({ transfer, agent, includeBalance: listing.include_balance });
	},

	async swap_keys({ transfer, agent }) {
		await swapKeys({ transfer, agent });
	},

	async revoke_access({ transfer, agent }) {
		await revokeSellerAccess({ transfer, agent });
	},

	async detach_history({ transfer, listing, agent }) {
		if (listing.include_history) return;
		await detachHistory({ transfer, agent });
	},

	async reassign_owner({ transfer, agent }) {
		await reassignOwner({ transfer, agent });
	},

	async destroy_old_key({ transfer, agent }) {
		await destroyOldKey({ transfer, agent });
	},

	async finalize({ transfer, listing }) {
		await sql`
			UPDATE agent_listings SET status = 'sold', closed_at = coalesce(closed_at, now()), updated_at = now()
			WHERE id = ${listing.id} AND status = 'settling'
		`;
		const [existing] = await sql`
			SELECT 1 FROM agent_marketplace_history WHERE transfer_id = ${transfer.id} AND event = 'sold' LIMIT 1
		`;
		if (!existing) {
			await addHistory({
				agentId: transfer.agent_id, listingId: listing.id, bidId: transfer.bid_id, transferId: transfer.id,
				actorUserId: transfer.buyer_user_id, event: 'sold', currency: transfer.currency, amount: transfer.amount_atomics,
				signature: transfer.payout_signature,
				meta: { buyer: transfer.buyer_user_id, seller: transfer.seller_user_id, new_wallet: transfer.new_wallet_address },
			});
			const info = currencyInfo(transfer.currency);
			const amount = `${formatAtomics(transfer.amount_atomics, info.decimals)} ${info.symbol}`;
			insertNotification(transfer.buyer_user_id, 'agent_purchased', {
				agent_id: transfer.agent_id, transfer_id: transfer.id, amount,
				message: 'The agent is yours. Its wallet starts frozen with conservative limits; unfreeze it under Limits & Safety.',
			});
			insertNotification(transfer.seller_user_id, 'agent_sold', {
				agent_id: transfer.agent_id, transfer_id: transfer.id, amount,
				net: `${formatAtomics(transfer.seller_net_atomics, info.decimals)} ${info.symbol}`,
				signature: transfer.payout_signature,
			});
			logAudit({
				userId: transfer.buyer_user_id, action: 'agent_market.transfer_completed', resourceId: transfer.agent_id,
				meta: { transfer_id: transfer.id, seller: transfer.seller_user_id, amount_atomics: String(transfer.amount_atomics), currency: transfer.currency },
			});
		}
	},
};

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * One agent_custody_events row per completed step, so the agent's custody
 * ledger shows the whole rotation next to its trades and withdrawals. The
 * idempotency key is unique per (agent, key), and a step advances exactly once
 * (compare-and-set), so a resumed run never writes a step twice.
 */
export async function recordStepCustody(transfer, step) {
	const ownerFlipped = STEPS.indexOf(step) >= STEPS.indexOf('reassign_owner');
	await recordCustodyEvent({
		agentId: transfer.agent_id,
		userId: ownerFlipped ? transfer.buyer_user_id : transfer.seller_user_id,
		eventType: 'marketplace_transfer',
		category: 'marketplace_transfer',
		reason: `marketplace_${step}`,
		status: 'confirmed',
		signature: step === 'pay_seller' ? transfer.payout_signature || null : step === 'pay_fee' ? transfer.fee_signature || null : null,
		idempotencyKey: `agent-market:${transfer.id}:${step}`,
		meta: {
			transfer_id: transfer.id, listing_id: transfer.listing_id, step, label: STEP_LABELS[step],
			buyer: transfer.buyer_user_id, seller: transfer.seller_user_id,
			old_wallet: transfer.old_wallet_address || null, new_wallet: transfer.new_wallet_address || null,
		},
	}).catch((err) => {
		if (err?.code !== '23505') console.warn('[agent-market] custody step record failed', transfer.id, step, err?.message);
	});
}

async function defaultContext(transfer) {
	const [listing, agent] = await Promise.all([loadListing(transfer.listing_id), loadAgent(transfer.agent_id)]);
	return { transfer, listing, agent };
}

/**
 * Drive a transfer from its current step to done, or until a step fails.
 * Returns the final row and, on failure, the error. Never throws for a step
 * failure: the failure is recorded on the row and the next run resumes it.
 *
 * @param {string} transferId
 * @param {{ store?: typeof dbStore, steps?: typeof defaultSteps, context?: (t: object) => Promise<object>,
 *           deadlineMs?: number }} [deps]
 */
export async function runTransfer(transferId, deps = {}) {
	const store = deps.store || dbStore;
	const steps = deps.steps || defaultSteps;
	const context = deps.context || defaultContext;
	const deadline = Date.now() + (deps.deadlineMs ?? 240_000);

	let transfer = await store.lease(transferId);
	if (!transfer) {
		const current = await store.load(transferId);
		return { transfer: current, busy: current ? current.status !== 'completed' : false };
	}
	while (transfer.step !== 'done') {
		if (Date.now() > deadline) {
			await store.release(transferId);
			return { transfer, paused: true };
		}
		const step = transfer.step;
		try {
			const ctx = await context(transfer);
			await steps[step](ctx);
		} catch (err) {
			const message = err?.message || String(err);
			await store.fail(transferId, step, message);
			if (deps.log !== false) console.warn('[agent-market] settlement step failed', transferId, step, message);
			return { transfer: await store.load(transferId), error: { step, code: err?.code || 'step_failed', message } };
		}
		transfer = await store.advance(transferId, step, nextStep(step));
		if (store === dbStore) {
			await addHistory({
				agentId: transfer.agent_id, listingId: transfer.listing_id, transferId, event: 'transfer_step',
				meta: { step, label: STEP_LABELS[step] },
			}).catch(() => {});
			await recordStepCustody(transfer, step);
		}
	}
	return { transfer };
}

/** Public shape of a transfer for the UI and tools: step-by-step progress. */
export function transferView(row, { viewerId = null } = {}) {
	const info = currencyInfo(row.currency);
	const doneIndex = row.step === 'done' ? STEPS.length : STEPS.indexOf(row.step);
	const party = viewerId === row.buyer_user_id ? 'buyer' : viewerId === row.seller_user_id ? 'seller' : null;
	return {
		id: row.id,
		listing_id: row.listing_id,
		agent_id: row.agent_id,
		status: row.status,
		step: row.step,
		viewer_role: party,
		amount: { atomics: String(row.amount_atomics), amount: formatAtomics(row.amount_atomics, info.decimals), symbol: info.symbol },
		fee: { atomics: String(row.fee_atomics), amount: formatAtomics(row.fee_atomics, info.decimals), symbol: info.symbol },
		seller_net: { atomics: String(row.seller_net_atomics), amount: formatAtomics(row.seller_net_atomics, info.decimals), symbol: info.symbol },
		steps: STEPS.map((s, i) => ({
			id: s,
			label: STEP_LABELS[s],
			state: i < doneIndex ? 'done' : i === doneIndex ? (row.status === 'failed' ? 'failed' : 'running') : 'pending',
		})),
		payout_signature: row.payout_signature || null,
		fee_signature: row.fee_signature || null,
		old_wallet_address: row.old_wallet_address || null,
		new_wallet_address: row.new_wallet_address || null,
		stranded: row.rotation?.sweep?.stranded || [],
		last_error: party ? row.last_error || null : undefined,
		attempts: row.attempts,
		can_resume: row.status === 'failed' && Boolean(party),
		completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
		updated_at: new Date(row.updated_at).toISOString(),
	};
}
