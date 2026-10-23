// Creator-fee payouts: the payout wallet, the distribution run and the reads the
// earnings page and API are built on. Pure rules (held reasons, the signed
// message, the per-$100 flow) live in creator-payouts-core.js.
//
// The money path, end to end:
//   1. launcher-claimer claims creator fees into the agent wallet and records a
//      launcher_claims row (claimed lamports, and the buyback share earmarked).
//   2. runDistribution() ingests each claim as a creator_payout_distributions
//      row holding the creator's share (claim minus the earmark).
//   3. For each agent with unsent rows it asks holdReason(): no registered
//      wallet, a wallet change in its cooldown, below the minimum, the agent
//      wallet too low, or distribution switched off. A held row says why.
//   4. Otherwise the rows are locked as one batch and ONE SOL transfer from the
//      agent wallet to the registered payout wallet is sent. The wallet was
//      registered by the owner signing a message with it (Ed25519, timestamp,
//      one-use nonce) after a step-up, so the destination is the owner's
//      explicit, signed choice. Sending is off unless CREATOR_PAYOUTS_LIVE=true.

import { randomBytes } from 'node:crypto';
import { sql } from './db.js';
import { logAudit } from './audit.js';
import { sendOpsAlert } from './alerts.js';
import { verifySiwsSignature } from './siws.js';
import { WhitelistError, buildOp, consumeGrant } from './destination-whitelist.js';
import {
	HOLD_REASONS, LAMPORTS_PER_SOL, MIN_PAYOUT_LAMPORTS, WALLET_CHANGE_COOLDOWN_MS, WALLET_RESERVE_LAMPORTS,
	buildRegistrationMessage, checkRegistrationMessage, holdReason, isSolanaAddress, solFromLamports, summarizeDistributions,
} from './creator-payouts-core.js';

const MAX_INGEST = 500;
const STUCK_SENDING_MS = 10 * 60_000;
/** Held reasons that are the normal state of the system, not news worth a notification. */
const QUIET_REASONS = new Set(['below_minimum', 'payouts_paused']);

export const payoutsLive = () => String(process.env.CREATOR_PAYOUTS_LIVE ?? '') === 'true';

const sol = (lamports) => Number(solFromLamports(lamports));

// ── Ownership ────────────────────────────────────────────────────────────────

async function loadOwnedAgent(agentId, userId) {
	if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) throw new WhitelistError(400, 'invalid_agent_id', 'agent_id must be a UUID');
	const [agent] = await sql`SELECT id, user_id, name FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!agent) throw new WhitelistError(404, 'agent_not_found', 'Agent not found.');
	if (agent.user_id !== userId) throw new WhitelistError(403, 'forbidden', 'Only the owner of this agent can manage its payout wallet.');
	return agent;
}

function requireBrowserSession(actor) {
	if (!actor?.sessionId || actor.kind !== 'owner') {
		throw new WhitelistError(403, 'session_required', 'This needs the owner signed in to the three.ws site. API keys, OAuth tokens and agents cannot change a payout wallet.');
	}
}

// ── Wallet state ─────────────────────────────────────────────────────────────

/** Promote any staged wallet whose cooldown has ended. One agent, or all. */
export async function promoteDueWallets(agentId = null) {
	return sql`
		UPDATE creator_payout_wallets
		SET wallet = pending_wallet, registered_at = pending_effective_at, changes = changes + 1,
		    pending_wallet = NULL, pending_effective_at = NULL, pending_requested_at = NULL, updated_at = now()
		WHERE pending_wallet IS NOT NULL AND pending_effective_at <= now()
		  AND (${agentId}::uuid IS NULL OR agent_id = ${agentId}::uuid)
		RETURNING agent_id, user_id, wallet`;
}

export function walletView(row) {
	if (!row) return { wallet: null, registered_at: null, pending: null, cooldown_hours: WALLET_CHANGE_COOLDOWN_MS / 3_600_000 };
	return {
		wallet: row.wallet || null,
		registered_at: row.registered_at || null,
		pending: row.pending_wallet
			? { wallet: row.pending_wallet, effective_at: row.pending_effective_at, requested_at: row.pending_requested_at }
			: null,
		cooldown_hours: WALLET_CHANGE_COOLDOWN_MS / 3_600_000,
	};
}

export async function getPayoutWallet(agentId) {
	await promoteDueWallets(agentId).catch(() => {});
	const [row] = await sql`SELECT * FROM creator_payout_wallets WHERE agent_id = ${agentId}`;
	return walletView(row);
}

// ── Registration ─────────────────────────────────────────────────────────────

/** The message to sign. Stateless: the nonce is spent when the signature arrives. */
export async function issueRegistrationChallenge({ agentId, userId, wallet }) {
	await loadOwnedAgent(agentId, userId);
	if (!isSolanaAddress(wallet)) throw new WhitelistError(400, 'invalid_address', 'That is not a valid Solana address.');
	const nonce = randomBytes(16).toString('hex');
	const issuedAt = new Date().toISOString();
	return {
		agent_id: agentId,
		wallet,
		nonce,
		issued_at: issuedAt,
		message: buildRegistrationMessage({ agentId, wallet, nonce, issuedAt }),
		expires_in_seconds: 300,
		cooldown_hours: WALLET_CHANGE_COOLDOWN_MS / 3_600_000,
	};
}

/**
 * Register or change the payout wallet.
 *
 * Requires, in this order: an owner browser session; the wallet's own Ed25519
 * signature over the challenge message (fresh timestamp); a nonce never seen
 * before (replay guard, an atomic insert); and a step-up grant bound to this
 * agent and this wallet. The first wallet is active at once. A change is staged
 * and takes effect after the cooldown, and payouts are held until it does.
 */
export async function registerPayoutWallet({ actor, agentId, wallet, message, signature, grantId, req = null, now = Date.now() }) {
	requireBrowserSession(actor);
	const agent = await loadOwnedAgent(agentId, actor.userId);
	if (!isSolanaAddress(wallet)) throw new WhitelistError(400, 'invalid_address', 'That is not a valid Solana address.');

	const checked = checkRegistrationMessage(message, { agentId, wallet, now });
	if (!checked.ok) throw new WhitelistError(400, checked.code, checked.message);

	let valid = false;
	try {
		valid = verifySiwsSignature(String(message), String(signature || ''), wallet);
	} catch {
		valid = false;
	}
	if (!valid) throw new WhitelistError(401, 'bad_signature', 'That signature was not made by the payout wallet.');

	const [spent] = await sql`
		INSERT INTO creator_payout_nonces (nonce, agent_id, wallet, issued_at)
		VALUES (${checked.nonce}, ${agentId}, ${wallet}, ${checked.issuedAt})
		ON CONFLICT (nonce) DO NOTHING RETURNING nonce`;
	if (!spent) throw new WhitelistError(409, 'nonce_used', 'That signed message was already used. Request a new one and sign again.');

	await consumeGrant({ grantId, actor, agentId, op: buildOp('payout_wallet', agentId, { wallet }) });

	await promoteDueWallets(agentId);
	const [existing] = await sql`SELECT * FROM creator_payout_wallets WHERE agent_id = ${agentId}`;
	let outcome;
	if (!existing || (!existing.wallet && !existing.pending_wallet)) {
		await sql`
			INSERT INTO creator_payout_wallets (agent_id, user_id, wallet, registered_at)
			VALUES (${agentId}, ${actor.userId}, ${wallet}, now())
			ON CONFLICT (agent_id) DO UPDATE SET wallet = EXCLUDED.wallet, registered_at = now(), updated_at = now()`;
		outcome = 'registered';
	} else if (existing.wallet === wallet && !existing.pending_wallet) {
		outcome = 'unchanged';
	} else if (existing.wallet === wallet) {
		await sql`
			UPDATE creator_payout_wallets
			SET pending_wallet = NULL, pending_effective_at = NULL, pending_requested_at = NULL, updated_at = now()
			WHERE agent_id = ${agentId}`;
		outcome = 'change_cancelled';
	} else {
		const effectiveAt = new Date(now + WALLET_CHANGE_COOLDOWN_MS).toISOString();
		await sql`
			UPDATE creator_payout_wallets
			SET pending_wallet = ${wallet}, pending_effective_at = ${effectiveAt}, pending_requested_at = now(), updated_at = now()
			WHERE agent_id = ${agentId}`;
		outcome = 'change_staged';
	}

	logAudit({ userId: actor.userId, action: `creator_payout.${outcome}`, resourceId: agentId, meta: { wallet }, req });
	if (outcome === 'registered' || outcome === 'change_staged') {
		await notifyOwner(actor.userId, 'creator_payout_wallet', {
			agent_id: agentId,
			agent_name: agent.name,
			message:
				outcome === 'registered'
					? `Payout wallet registered for ${agent.name || 'your agent'}. Creator-fee shares will be sent to it.`
					: `Payout wallet change staged for ${agent.name || 'your agent'}. It takes effect in ${WALLET_CHANGE_COOLDOWN_MS / 3_600_000} hours, and payouts are held until then. Cancel it if this was not you.`,
			link: `/creator/payouts?agent=${agentId}`,
		});
	}
	return { outcome, ...(await getPayoutWallet(agentId)) };
}

/** Drop a staged wallet change. Instant, no step-up: it can only make the account safer. */
export async function cancelPendingWallet({ actor, agentId, req = null }) {
	requireBrowserSession(actor);
	await loadOwnedAgent(agentId, actor.userId);
	const [row] = await sql`
		UPDATE creator_payout_wallets
		SET pending_wallet = NULL, pending_effective_at = NULL, pending_requested_at = NULL, updated_at = now()
		WHERE agent_id = ${agentId} AND pending_wallet IS NOT NULL AND user_id = ${actor.userId}
		RETURNING agent_id`;
	if (!row) throw new WhitelistError(404, 'no_pending_change', 'There is no pending payout wallet change to cancel.');
	logAudit({ userId: actor.userId, action: 'creator_payout.change_cancelled', resourceId: agentId, req });
	return getPayoutWallet(agentId);
}

async function notifyOwner(userId, type, payload) {
	try {
		const { insertNotification } = await import('./notify.js');
		await insertNotification(userId, type, payload);
	} catch (e) {
		console.warn('[creator-payouts] notify failed', e?.message);
	}
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Distribution rows for an agent, newest first. */
export async function listDistributions(agentId, { limit = 50, offset = 0 } = {}) {
	return sql`
		SELECT id, agent_id, mint, network, claim_sig, creator_lamports::text AS creator_lamports, status, hold_reason,
		       payout_wallet, tx_signature, sent_at, created_at
		FROM creator_payout_distributions
		WHERE agent_id = ${agentId}
		ORDER BY created_at DESC, id
		LIMIT ${limit} OFFSET ${offset}`;
}

const distView = (r) => ({
	id: r.id,
	mint: r.mint,
	status: r.status === 'sending' ? 'pending' : r.status,
	sol: sol(r.creator_lamports),
	hold_reason: r.hold_reason || null,
	hold: r.hold_reason ? { code: r.hold_reason, ...(HOLD_REASONS[r.hold_reason] || { label: r.hold_reason, fix: '' }) } : null,
	payout_wallet: r.payout_wallet || null,
	claim_signature: r.claim_sig || null,
	signature: r.tx_signature || null,
	explorer: r.tx_signature ? `https://solscan.io/tx/${r.tx_signature}` : null,
	at: r.sent_at || r.created_at,
});

/**
 * The payouts block of GET /api/agents/:id/earnings: the payout wallet, the
 * sent/pending/held totals, the same split per coin, why anything is held, and
 * the latest distributions with their transaction signatures.
 */
export async function getAgentPayouts(agentId) {
	const [wallet, rows] = await Promise.all([
		getPayoutWallet(agentId),
		sql`
			SELECT id, mint, claim_sig, creator_lamports::text AS creator_lamports, status, hold_reason, payout_wallet,
			       tx_signature, sent_at, created_at
			FROM creator_payout_distributions
			WHERE agent_id = ${agentId} AND network = 'mainnet'
			ORDER BY created_at DESC, id`,
	]);
	const total = summarizeDistributions(rows);
	const byMint = new Map();
	for (const r of rows) {
		if (!byMint.has(r.mint)) byMint.set(r.mint, []);
		byMint.get(r.mint).push(r);
	}
	const perCoin = {};
	for (const [mint, list] of byMint) {
		const t = summarizeDistributions(list);
		perCoin[mint] = { sent_sol: sol(t.sent), pending_sol: sol(t.pending), held_sol: sol(t.held) };
	}
	const heldReasons = Object.entries(total.held_by_reason).map(([code, lamports]) => ({
		code,
		sol: sol(lamports),
		...(HOLD_REASONS[code] || { label: code, fix: '' }),
	}));
	return {
		wallet,
		minimum_payout_sol: MIN_PAYOUT_LAMPORTS / LAMPORTS_PER_SOL,
		live: payoutsLive(),
		total_sent_sol: sol(total.sent),
		total_pending_sol: sol(total.pending),
		total_held_sol: sol(total.held),
		held_reasons: heldReasons,
		per_coin: perCoin,
		recent_distributions: rows.slice(0, 20).map(distView),
	};
}

// ── Distribution run ─────────────────────────────────────────────────────────

/** Record each unrecorded claim's creator share. Returns the number ingested. */
export async function ingestClaims() {
	const rows = await sql`
		INSERT INTO creator_payout_distributions (claim_id, agent_id, user_id, mint, network, claim_sig, creator_lamports, status)
		SELECT lc.id, lc.agent_id, ai.user_id, lc.mint, lc.network, lc.claim_sig,
		       greatest(lc.claimed_lamports - round(lc.buyback_sol * 1000000000)::bigint, 0), 'pending'
		FROM launcher_claims lc
		JOIN agent_identities ai ON ai.id = lc.agent_id AND ai.deleted_at IS NULL
		WHERE lc.network = 'mainnet' AND lc.claim_sig IS NOT NULL AND lc.claimed_lamports > 0
		  AND lc.agent_id IS NOT NULL
		  AND greatest(lc.claimed_lamports - round(lc.buyback_sol * 1000000000)::bigint, 0) > 0
		  AND NOT EXISTS (SELECT 1 FROM creator_payout_distributions d WHERE d.claim_id = lc.id)
		ORDER BY lc.created_at
		LIMIT ${MAX_INGEST}
		ON CONFLICT (claim_id) DO NOTHING
		RETURNING id`;
	return rows.length;
}

/** Send `lamports` of SOL from the agent's custodial wallet. Returns { signature }. */
async function sendFromAgentWallet({ agentId, userId, fromSecret, fromAddress, to, lamports, batchId }) {
	const { recoverSolanaAgentKeypair } = await import('./agent-wallet.js');
	const { Connection, PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
	const { getConnection } = await import('./pump.js');
	/** @type {Connection} */
	const conn = getConnection({ network: 'mainnet' });
	const kp = await recoverSolanaAgentKeypair(fromSecret, { agentId, userId, reason: 'creator_payout', meta: { batch_id: batchId, to } });
	if (kp.publicKey.toBase58() !== fromAddress) throw new Error('agent wallet key does not match its recorded address');
	const balance = await conn.getBalance(kp.publicKey, 'confirmed');
	if (BigInt(balance) < BigInt(lamports) + BigInt(WALLET_RESERVE_LAMPORTS)) {
		const err = new Error('agent wallet balance too low');
		err.code = 'agent_wallet_low';
		throw err;
	}
	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
		SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports: BigInt(lamports) }),
	);
	tx.sign(kp);
	const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	return { signature, conn, blockhash, lastValidBlockHeight };
}

async function holdRows(agentId, reason) {
	await sql`
		UPDATE creator_payout_distributions
		SET status = 'held', hold_reason = ${reason}, payout_wallet = NULL, updated_at = now()
		WHERE agent_id = ${agentId} AND status IN ('pending', 'held')`;
}

async function maybeNotifyHeld(agentId, userId, agentName, reason, lamports) {
	const [state] = await sql`SELECT last_held_reason FROM creator_payout_state WHERE agent_id = ${agentId}`;
	if (state?.last_held_reason === reason) return false;
	await sql`
		INSERT INTO creator_payout_state (agent_id, last_held_reason, notified_at) VALUES (${agentId}, ${reason}, now())
		ON CONFLICT (agent_id) DO UPDATE SET last_held_reason = EXCLUDED.last_held_reason, notified_at = now()`;
	if (QUIET_REASONS.has(reason)) return false;
	const info = HOLD_REASONS[reason];
	await notifyOwner(userId, 'creator_payout_held', {
		agent_id: agentId,
		agent_name: agentName,
		reason,
		message: `${solFromLamports(lamports)} SOL of creator fees for ${agentName || 'your agent'} is held: ${info?.label || reason}. ${info?.fix || ''}`.trim(),
		link: `/creator/payouts?agent=${agentId}`,
	});
	return true;
}

/**
 * One distribution pass. Idempotent: ingest is keyed by claim, the send locks its
 * batch with a status transition, so a re-run (or a second runner) cannot pay a
 * claim twice.
 * @param {{ live?: boolean, now?: number, send?: typeof sendFromAgentWallet }} [opts]
 */
export async function runDistribution({ live = payoutsLive(), now = Date.now(), send = sendFromAgentWallet } = {}) {
	const out = { ingested: 0, agents: 0, sent_batches: 0, sent_sol: 0, held_agents: 0, failed: [], promoted: 0 };
	out.promoted = (await promoteDueWallets()).length;
	out.ingested = await ingestClaims();

	const agents = await sql`
		SELECT d.agent_id, ai.user_id, ai.name, ai.meta->>'solana_address' AS solana_address,
		       ai.meta->>'encrypted_solana_secret' AS secret,
		       sum(d.creator_lamports)::text AS unsent
		FROM creator_payout_distributions d
		JOIN agent_identities ai ON ai.id = d.agent_id AND ai.deleted_at IS NULL
		WHERE d.status IN ('pending', 'held') AND d.network = 'mainnet'
		GROUP BY d.agent_id, ai.user_id, ai.name, ai.meta
		LIMIT 200`;
	out.agents = agents.length;

	for (const a of agents) {
		try {
			const [w] = await sql`SELECT * FROM creator_payout_wallets WHERE agent_id = ${a.agent_id}`;
			const unsent = BigInt(a.unsent);
			const reason = holdReason({
				activeWallet: w?.wallet || null,
				pendingWallet: w?.pending_wallet || null,
				pendingEffectiveAt: w?.pending_effective_at || null,
				unsentLamports: unsent,
				live,
				now,
			});
			if (reason) {
				await holdRows(a.agent_id, reason);
				await maybeNotifyHeld(a.agent_id, a.user_id, a.name, reason, unsent);
				out.held_agents++;
				continue;
			}
			if (!a.solana_address || !a.secret) {
				await holdRows(a.agent_id, 'signing_unavailable');
				await maybeNotifyHeld(a.agent_id, a.user_id, a.name, 'signing_unavailable', unsent);
				out.held_agents++;
				continue;
			}

			const batchId = (await sql`SELECT gen_random_uuid() AS id`)[0].id;
			const locked = await sql`
				UPDATE creator_payout_distributions
				SET status = 'sending', batch_id = ${batchId}, payout_wallet = ${w.wallet}, hold_reason = NULL, updated_at = now()
				WHERE agent_id = ${a.agent_id} AND status IN ('pending', 'held') AND network = 'mainnet'
				RETURNING creator_lamports::text AS creator_lamports`;
			const total = locked.reduce((s, r) => s + BigInt(r.creator_lamports), 0n);
			if (total === 0n) continue;

			let sent;
			try {
				sent = await send({ agentId: a.agent_id, userId: a.user_id, fromSecret: a.secret, fromAddress: a.solana_address, to: w.wallet, lamports: total, batchId });
			} catch (err) {
				const code = err?.code === 'agent_wallet_low' ? 'agent_wallet_low' : 'signing_unavailable';
				await sql`
					UPDATE creator_payout_distributions
					SET status = 'held', hold_reason = ${code}, batch_id = NULL, payout_wallet = NULL, updated_at = now()
					WHERE batch_id = ${batchId} AND status = 'sending'`;
				await maybeNotifyHeld(a.agent_id, a.user_id, a.name, code, total);
				if (code === 'signing_unavailable') out.failed.push({ agent_id: a.agent_id, error: String(err?.message || err).slice(0, 200) });
				out.held_agents++;
				continue;
			}

			// Broadcast: record the signature before waiting, so a confirmation that
			// never returns is resolved by the reconcile job instead of re-sent.
			await sql`UPDATE creator_payout_distributions SET tx_signature = ${sent.signature}, updated_at = now() WHERE batch_id = ${batchId}`;
			try {
				if (sent.conn) {
					const res = await sent.conn.confirmTransaction(
						{ signature: sent.signature, blockhash: sent.blockhash, lastValidBlockHeight: sent.lastValidBlockHeight },
						'confirmed',
					);
					if (res?.value?.err) throw new Error(`transfer failed on-chain: ${JSON.stringify(res.value.err)}`);
				}
			} catch (err) {
				out.failed.push({ agent_id: a.agent_id, signature: sent.signature, error: String(err?.message || err).slice(0, 200) });
				await sendOpsAlert('Creator payout confirmation unresolved', `agent ${a.agent_id} batch ${batchId} signature ${sent.signature}: ${err?.message || err}. The reconcile job resolves it.`, { severity: 'warning' }).catch(() => {});
				continue;
			}
			await markBatchSent(batchId);
			await sql`UPDATE creator_payout_state SET last_held_reason = NULL WHERE agent_id = ${a.agent_id}`;
			out.sent_batches++;
			out.sent_sol += sol(total);
			await notifyOwner(a.user_id, 'creator_payout_sent', {
				agent_id: a.agent_id,
				agent_name: a.name,
				sol: sol(total),
				signature: sent.signature,
				message: `${solFromLamports(total)} SOL of creator fees from ${a.name || 'your agent'} was sent to your payout wallet.`,
				link: `/creator/payouts?agent=${a.agent_id}`,
			});
		} catch (err) {
			out.failed.push({ agent_id: a.agent_id, error: String(err?.message || err).slice(0, 200) });
		}
	}
	return out;
}

async function markBatchSent(batchId) {
	await sql`
		UPDATE creator_payout_distributions
		SET status = 'sent', hold_reason = NULL, sent_at = now(), updated_at = now()
		WHERE batch_id = ${batchId} AND status = 'sending'`;
}

// ── Reconcile ────────────────────────────────────────────────────────────────

/**
 * Compare what we recorded with the chain, and alert on drift:
 *  - sending batches that never resolved: confirmed on-chain becomes sent, a
 *    transfer the cluster never saw is returned to pending, anything else alerts;
 *  - every recently sent signature must exist on-chain without error;
 *  - each agent's pump.fun vault balance on-chain against the unclaimed figure in
 *    the last earnings snapshot (drift beyond tolerance alerts: fees accrue
 *    between snapshots, so only a vault far BELOW what we recorded is drift).
 * Read-only on the chain.
 * @param {{ connection?: any, now?: number }} [opts]
 */
export async function reconcilePayouts({ connection = null, now = Date.now() } = {}) {
	const drift = [];
	const checked = { stuck_batches: 0, sent_signatures: 0, vaults: 0 };
	const { getConnection } = await import('./pump.js');
	const conn = connection || getConnection({ network: 'mainnet' });

	const stuck = await sql`
		SELECT batch_id, agent_id, min(tx_signature) AS sig, sum(creator_lamports)::text AS lamports
		FROM creator_payout_distributions
		WHERE status = 'sending' AND updated_at < ${new Date(now - STUCK_SENDING_MS).toISOString()}
		GROUP BY batch_id, agent_id`;
	for (const b of stuck) {
		checked.stuck_batches++;
		if (!b.sig) {
			await sql`UPDATE creator_payout_distributions SET status = 'pending', batch_id = NULL, payout_wallet = NULL, updated_at = now() WHERE batch_id = ${b.batch_id} AND status = 'sending'`;
			continue;
		}
		const st = (await conn.getSignatureStatuses([b.sig], { searchTransactionHistory: true }).catch(() => null))?.value?.[0];
		if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
			await markBatchSent(b.batch_id);
		} else if (!st) {
			await sql`UPDATE creator_payout_distributions SET status = 'pending', batch_id = NULL, tx_signature = NULL, payout_wallet = NULL, updated_at = now() WHERE batch_id = ${b.batch_id} AND status = 'sending'`;
		} else {
			drift.push({ kind: 'transfer_failed', agent_id: b.agent_id, signature: b.sig, lamports: b.lamports, detail: st.err ? JSON.stringify(st.err) : st.confirmationStatus });
		}
	}

	const sentSigs = await sql`
		SELECT tx_signature AS sig, agent_id, sum(creator_lamports)::text AS lamports, max(payout_wallet) AS wallet
		FROM creator_payout_distributions
		WHERE status = 'sent' AND tx_signature IS NOT NULL AND sent_at > ${new Date(now - 72 * 3_600_000).toISOString()}
		GROUP BY tx_signature, agent_id
		LIMIT 100`;
	for (const s of sentSigs) {
		checked.sent_signatures++;
		const st = (await conn.getSignatureStatuses([s.sig], { searchTransactionHistory: true }).catch(() => null))?.value?.[0];
		if (!st) drift.push({ kind: 'sent_signature_missing', agent_id: s.agent_id, signature: s.sig, lamports: s.lamports });
		else if (st.err) drift.push({ kind: 'sent_signature_failed', agent_id: s.agent_id, signature: s.sig, lamports: s.lamports, detail: JSON.stringify(st.err) });
	}

	const vaults = await sql`
		SELECT e.creator AS wallet, max(e.unclaimed_lamports)::text AS recorded_unclaimed, max(e.refreshed_at) AS refreshed_at
		FROM agent_coin_earnings e
		WHERE e.network = 'mainnet' AND e.source = 'pumpfun_creator_fees' AND e.creator IS NOT NULL AND e.unclaimed_lamports IS NOT NULL
		GROUP BY e.creator
		HAVING max(e.unclaimed_lamports) > 0
		ORDER BY max(e.refreshed_at) DESC
		LIMIT 40`;
	const { readUnclaimedLamports } = await import('./pump-creator-fees.js');
	for (const v of vaults) {
		const onchain = await readUnclaimedLamports(conn, v.wallet);
		if (onchain == null) continue;
		checked.vaults++;
		const recorded = BigInt(v.recorded_unclaimed);
		// Fees accrue between snapshots, so a vault above the record is expected.
		// A vault well below it means fees left without our claim path recording them.
		const shortfall = recorded - onchain;
		const tolerance = recorded / 20n + 1_000_000n;
		if (shortfall > tolerance) {
			drift.push({ kind: 'vault_below_record', wallet: v.wallet, recorded_lamports: recorded.toString(), onchain_lamports: onchain.toString(), shortfall_lamports: shortfall.toString() });
		}
	}

	const ok = drift.length === 0;
	await sql`INSERT INTO creator_payout_reconcile_runs (ok, checked, drift) VALUES (${ok}, ${JSON.stringify(checked)}::jsonb, ${JSON.stringify(drift)}::jsonb)`;
	if (!ok) {
		await sendOpsAlert(
			`Creator payout drift: ${drift.length} item${drift.length === 1 ? '' : 's'}`,
			drift.slice(0, 10).map((d) => `${d.kind} ${d.agent_id || d.wallet || ''} ${d.signature || ''}`.trim()).join('\n'),
			{ severity: 'critical', signature: `creator-payout-drift:${drift.map((d) => d.kind).sort().join(',')}` },
		).catch(() => {});
	}
	return { ok, checked, drift };
}
