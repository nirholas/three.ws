// @ts-check
// Agent activation — the onboarding "Go Live" welcome grant.
//
// Distinct from USER activation (api/_lib/activation.js, the first-3D-win
// milestone): this is the AGENT-wallet cold-start fix.
//
// The cold-start problem: a freshly created agent gets a custodial wallet, but on
// mainnet that wallet starts at ◎0. With no funds it can never make its first
// transaction, so it never appears on the Money Pulse and never counts as an
// active wallet. The funnel dead-ends at "wallet created".
//
// Activation fixes that with a real, one-time, on-chain platform grant: the
// treasury sends a small amount of SOL to the agent's wallet and the transfer is
// recorded as a genuine `tip` custody event. The agent is now BOTH funded (it can
// transact) AND active (it shows on the Pulse, in tips, and in active-wallet
// counts) — from a single, honest, explorer-verifiable transaction the owner can
// see. It is a welcome bonus, framed as exactly that; there is nothing synthetic.
//
// Guarantees:
//   · Exactly one grant per agent — enforced by the agent_activations primary key
//     and a pending→confirmed status mutex, so concurrent POSTs can't double-spend.
//   · Owner-only, real agents only (platform circulation agents are excluded).
//   · A rolling daily cap bounds spend; per-IP/user rate limiting lives at the route.
//   · Fully inert + graceful when no treasury is configured (status: not_configured).

import { sql } from './db.js';
import {
	getTreasuryKeypair,
	transferSol,
	lamportBalance,
	signatureLanded,
	treasuryConnection,
	FEE_BUFFER,
	SOL,
} from './platform-treasury.js';
import { ensureAgentWallet } from './agent-wallet.js';
import { recordCustodyEvent } from './agent-trade-guards.js';
import { solUsdPrice, explorerTxUrl } from './avatar-wallet.js';
import { publishFeedEvent } from './feed.js';
import { insertNotification } from './notify.js';
import { markActivated } from './activation.js';

// Env override so a flow can point activation at its own funded wallet; otherwise
// the shared operator treasury (CIRCULATION_TREASURY_SECRET) funds the grant.
const TREASURY_ENV_OVERRIDE = 'AGENT_ACTIVATION_TREASURY_SECRET';

function clampNumber(v, dflt, lo, hi) {
	const n = Number(v);
	if (!Number.isFinite(n)) return dflt;
	return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolved activation configuration. Cheap + side-effect free. Reads from `env`
 * (process.env by default) so it can be unit-tested without globals.
 * @param {Record<string, any>} [env]
 */
export function activationConfig(env = process.env) {
	const enabledRaw = String(env.AGENT_ACTIVATION_ENABLED ?? '').toLowerCase();
	const enabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes';
	// Grant size in SOL. Small on purpose: enough to fund a first real action +
	// fees, not a faucet to farm. 0.0001–0.05 SOL hard-bounded.
	const grantSol = clampNumber(env.AGENT_ACTIVATION_GRANT_SOL, 0.004, 0.0001, 0.05);
	const dailyCap = clampNumber(env.AGENT_ACTIVATION_DAILY_CAP, 500, 1, 100_000);
	const configured = !!(
		String(env[TREASURY_ENV_OVERRIDE] || '').trim() ||
		String(env.CIRCULATION_TREASURY_SECRET || '').trim()
	);
	return {
		enabled,
		configured,
		network: env.CIRCULATION_NETWORK === 'devnet' ? 'devnet' : 'mainnet',
		grantSol,
		grantLamports: Math.round(grantSol * SOL),
		dailyCap,
	};
}

/** True when this agent is platform-operated (circulation) rather than a real user's. */
function isCirculationAgent(agent) {
	return String(agent?.meta?.circulation ?? '') === 'true';
}

// Load the activation ledger row for an agent (or null). Tolerates the table not
// existing yet (pre-migration) so status reads never 500 a profile.
async function loadActivationRow(agentId) {
	try {
		const [row] = await sql`
			select agent_id, user_id, network, status, signature, lamports, usd, created_at, confirmed_at
			from agent_activations where agent_id = ${agentId} limit 1
		`;
		return row || null;
	} catch (err) {
		if (err?.code === '42P01') return null; // table not migrated yet
		throw err;
	}
}

// Shape a confirmed ledger row into the public activation receipt.
function receipt(row, network) {
	if (!row || row.status !== 'confirmed') return null;
	const sol = row.lamports != null ? Number(row.lamports) / SOL : null;
	return {
		signature: row.signature,
		explorer: row.signature ? explorerTxUrl(row.signature, row.network || network) : null,
		sol,
		usd: row.usd != null ? Number(row.usd) : null,
		activated_at: row.confirmed_at || row.created_at,
		network: row.network || network,
	};
}

/**
 * Pure activation decision. Given the loaded facts, return the single next move —
 * no DB, no I/O — so the full branch matrix is exhaustively unit-testable and the
 * status reader and the mutating path can never drift apart. The rolling daily cap
 * is the one check left to the caller (it needs a live count) and only matters once
 * this returns `proceed`.
 *
 * @param {{ owner: boolean, circulation: boolean, status: 'confirmed'|'pending'|null,
 *   enabled: boolean, configured: boolean }} facts
 * @returns {{ decision: 'forbidden'|'platform_agent'|'already'|'pending'|'not_configured'|'proceed', reason: string|null }}
 */
export function evaluateActivation({ owner, circulation, status, enabled, configured }) {
	if (!owner) return { decision: 'forbidden', reason: 'not_owner' };
	if (circulation) return { decision: 'platform_agent', reason: 'platform_agent' };
	if (status === 'confirmed') return { decision: 'already', reason: 'already_activated' };
	if (status === 'pending') return { decision: 'pending', reason: 'in_progress' };
	if (!enabled || !configured) return { decision: 'not_configured', reason: 'not_configured' };
	return { decision: 'proceed', reason: null };
}

/**
 * Read-only activation status for an agent, from the owner's perspective. Used by
 * the wallet hub to decide which state to render. Never mutates, never throws on
 * infra trouble (degrades to a safe "can't determine" shape).
 *
 * @param {{ agent: any, isOwner: boolean }} args
 */
export async function getActivationStatus({ agent, isOwner }) {
	const cfg = activationConfig();
	const row = await loadActivationRow(agent.id).catch(() => null);
	const status = row?.status === 'confirmed' ? 'confirmed' : row?.status === 'pending' ? 'pending' : null;
	const { decision, reason } = evaluateActivation({
		owner: isOwner,
		circulation: isCirculationAgent(agent),
		status,
		enabled: cfg.enabled,
		configured: cfg.configured,
	});

	return {
		enabled: cfg.enabled && cfg.configured,
		network: cfg.network,
		grant_sol: cfg.grantSol,
		activated: status === 'confirmed',
		pending: status === 'pending',
		eligible: decision === 'proceed',
		reason,
		has_wallet: !!(agent.solana_address || agent.meta?.solana_address),
		receipt: status === 'confirmed' ? receipt(row, cfg.network) : null,
	};
}

// Count grants in the last 24h for the rolling daily cap. Counts BOTH pending and
// confirmed so in-flight claims reserve a slot — checked AFTER this request has
// inserted its own pending row, so a concurrent burst can overshoot the cap by at
// most the read-skew window rather than the full burst width.
async function recentActivationCount() {
	try {
		const [r] = await sql`
			select count(*)::int as count from agent_activations
			where status in ('pending', 'confirmed') and created_at > now() - interval '24 hours'
		`;
		return r?.count ?? 0;
	} catch (err) {
		if (err?.code === '42P01') return 0;
		throw err;
	}
}

// Ensure the ledger table exists even if the migration hasn't run yet (mirrors the
// circulation engine's self-healing schema guard). Idempotent + cheap.
let _ensured = false;
async function ensureSchema() {
	if (_ensured) return;
	await sql`
		create table if not exists agent_activations (
			agent_id     uuid primary key,
			user_id      uuid,
			network      text        not null default 'mainnet',
			status       text        not null default 'pending',
			signature    text,
			lamports     bigint,
			usd          numeric,
			created_at   timestamptz not null default now(),
			confirmed_at timestamptz
		)
	`;
	await sql`create index if not exists agent_activations_confirmed on agent_activations (created_at desc) where status = 'confirmed'`;
	_ensured = true;
}

/**
 * Activate an agent: send the one-time on-chain welcome grant and record it as a
 * real tip custody event. Idempotent and concurrency-safe. Never throws for an
 * expected condition — returns a typed `{ ok, code }` the route maps to HTTP.
 *
 * @param {{ agentId: string, userId: string }} args
 * @returns {Promise<{ ok: boolean, code?: string, message?: string, already?: boolean,
 *   pending?: boolean, signature?: string, explorer?: string|null, sol?: number,
 *   usd?: number|null, network?: string }>}
 */
export async function activateAgent({ agentId, userId }) {
	const [agent] = await sql`
		select id, user_id, name, meta from agent_identities
		where id = ${agentId} and deleted_at is null limit 1
	`;
	if (!agent) return { ok: false, code: 'not_found', message: 'agent not found' };

	const cfg = activationConfig();
	const existing = await loadActivationRow(agentId).catch(() => null);
	const status = existing?.status === 'confirmed' ? 'confirmed' : existing?.status === 'pending' ? 'pending' : null;

	// One shared decision — identical matrix to the read-only status reader.
	const { decision } = evaluateActivation({
		owner: agent.user_id === userId,
		circulation: isCirculationAgent(agent),
		status,
		enabled: cfg.enabled,
		configured: cfg.configured,
	});
	switch (decision) {
		case 'forbidden':
			return { ok: false, code: 'forbidden', message: 'not your agent' };
		case 'platform_agent':
			return { ok: false, code: 'platform_agent', message: 'platform agents are already live' };
		case 'already': // idempotent — return the existing receipt, never a second grant
			return { ok: true, already: true, ...receipt(existing, cfg.network) };
		case 'pending':
			return { ok: true, already: true, pending: true, network: existing.network || cfg.network };
		case 'not_configured':
			return { ok: false, code: 'not_configured', message: 'activation is not available right now' };
		// 'proceed' falls through
	}

	await ensureSchema();

	// Claim the single grant slot FIRST. ON CONFLICT DO NOTHING is the mutex: if a
	// concurrent request already inserted, we get no row back and bail as "pending".
	const [claim] = await sql`
		insert into agent_activations (agent_id, user_id, network, status)
		values (${agentId}, ${userId}, ${cfg.network}, 'pending')
		on conflict (agent_id) do nothing
		returning agent_id
	`;
	if (!claim) {
		const row = await loadActivationRow(agentId).catch(() => null);
		if (row?.status === 'confirmed') return { ok: true, already: true, ...receipt(row, cfg.network) };
		return { ok: true, already: true, pending: true, network: cfg.network };
	}

	// Release the claim so the owner can retry — but ONLY for failures that prove
	// the grant never went on-chain. A send/confirm ambiguity must keep the claim
	// (see the transfer catch), or a timed-out-but-landed tx would be re-granted.
	const releaseClaim = () =>
		sql`delete from agent_activations where agent_id = ${agentId} and status = 'pending'`.catch(
			() => {},
		);

	// Everything from here can fail. The invariant: release the claim ONLY when no
	// grant could have left the treasury. `transferStarted` flips true the instant
	// before we broadcast — after that, an unexpected throw must leave the row
	// `pending` (which blocks any re-grant) rather than release it and risk a
	// double-spend. The outer catch is the backstop for any fail-able call (e.g. the
	// cap query, an RPC hiccup) that isn't already handled inline below.
	let transferStarted = false;
	try {
		// Rolling daily cap — checked AFTER claiming so this request's own pending row
		// is counted; a concurrent burst can overshoot only by the read-skew window.
		if ((await recentActivationCount()) > cfg.dailyCap) {
			await releaseClaim();
			return { ok: false, code: 'cap_reached', message: 'daily activation cap reached — try again tomorrow' };
		}

		// Provision the wallet if it isn't already (lazy-mint path), then resolve the
		// destination address.
		let address = agent.meta?.solana_address || null;
		const w = await ensureAgentWallet(agentId, userId, { reason: 'activation' }).catch((err) => {
			console.error('[agent-activation] wallet provision failed', err?.message);
			return null;
		});
		if (w?.address) address = w.address;
		if (!address) {
			await releaseClaim();
			return { ok: false, code: 'wallet_unavailable', message: 'could not prepare the agent wallet' };
		}

		let treasuryKp;
		try {
			treasuryKp = await getTreasuryKeypair(TREASURY_ENV_OVERRIDE);
		} catch (err) {
			await releaseClaim();
			return { ok: false, code: 'not_configured', message: 'activation is not available right now' };
		}

		const conn = treasuryConnection(cfg.network);
		const lamports = cfg.grantLamports;

		// Confirm the treasury can cover the grant + a fee buffer before sending, so a
		// dry treasury yields a clean message instead of a raw RPC failure.
		try {
			const have = await lamportBalance(conn, treasuryKp.publicKey.toBase58());
			if (have < BigInt(lamports) + BigInt(FEE_BUFFER)) {
				await releaseClaim();
				return { ok: false, code: 'treasury_low', message: 'activation is temporarily paused' };
			}
		} catch {
			/* balance probe is best-effort; the transfer below is the real gate */
		}

		let signature;
		transferStarted = true; // past this point, never auto-release the claim
		try {
			signature = await transferSol(conn, treasuryKp, address, lamports);
		} catch (err) {
			console.error('[agent-activation] grant transfer failed', err?.message);
			// A confirmation timeout can throw even though the transfer actually landed
			// on-chain (common under RPC congestion). transferSol attaches the broadcast
			// signature to the error; before releasing the claim — which would let the
			// owner retry and DOUBLE-SPEND the treasury — probe the chain. Release only
			// when the grant provably did NOT land.
			const broadcastSig = err?.signature || null;
			const landed = broadcastSig ? await signatureLanded(conn, broadcastSig).catch(() => false) : false;
			if (!landed) {
				await releaseClaim();
				return { ok: false, code: 'transfer_failed', message: 'the grant could not be sent — try again' };
			}
			signature = broadcastSig;
		}

		// Price the grant in USD (best-effort) so the Pulse can value it.
		let usd = null;
		try {
			const px = await solUsdPrice();
			if (px) usd = (lamports / SOL) * px;
		} catch {
			/* usd is decoration */
		}

		// Record the grant as a real inbound tip — this is what lands the agent on the
		// Money Pulse and in active-wallet / tip counts. Idempotent on (agent, key).
		await recordCustodyEvent({
			agentId,
			userId: null,
			eventType: 'tip',
			category: 'tip',
			network: cfg.network,
			asset: 'SOL',
			amountLamports: lamports,
			usd,
			destination: address,
			signature,
			status: 'confirmed',
			idempotencyKey: `activation:${agentId}`,
			meta: {
				source: 'activation_grant',
				from: 'three.ws',
				label: 'Activation welcome grant',
				block_time: new Date().toISOString(),
				decimals: 9,
			},
		}).catch((e) => console.warn('[agent-activation] custody event failed', e?.message));

		await sql`
			update agent_activations
			set status = 'confirmed', signature = ${signature}, lamports = ${String(lamports)},
			    usd = ${usd}, confirmed_at = now()
			where agent_id = ${agentId}
		`;

		// Announce on the live ticker + notify the owner. Fire-and-forget — never block.
		publishFeedEvent({
			type: 'agent-activated',
			ts: Date.now(),
			actor: agent.name,
			agentId,
			name: agent.name,
		}).catch(() => {});
		insertNotification(userId, 'agent_activated', {
			agent_id: agentId,
			agent_name: agent.name,
			sol: lamports / SOL,
			signature,
		}).catch(() => {});

		// Ramp value: make the agent able to EARN the moment it's live. Register its
		// custodial wallet as the default payout destination so any skill it lists
		// resolves a recipient for real marketplace buyers. Best-effort — never blocks
		// the grant.
		sql`
			insert into agent_payout_wallets (user_id, agent_id, address, chain, is_default, preferred_network, approved_at, effective_at, set_by)
			values (${userId}, ${agentId}, ${address}, 'solana', true, 'mainnet', now(), now(), 'platform')
			on conflict (user_id, agent_id, chain) do update set address = excluded.address, is_default = true, approved_at = now(), effective_at = now(), set_by = 'platform'
		`.catch((e) => console.warn('[agent-activation] payout wallet upsert failed', e?.message));

		// Cross-system milestone: funding your first agent IS a "first win" — stamp the
		// owner's user-activation milestone, which fires the two-sided referral reward
		// when they were referred. Best-effort, never blocks the grant return.
		markActivated(userId, {
			source: 'agent_activation',
			meta: { agentId, grantSol: cfg.grantSol },
		}).catch(() => {});

		return {
			ok: true,
			signature,
			explorer: explorerTxUrl(signature, cfg.network),
			sol: lamports / SOL,
			usd,
			activated_at: new Date().toISOString(),
			network: cfg.network,
		};
	} catch (err) {
		console.error('[agent-activation] unexpected failure', err?.message);
		// Safe backstop: only release before any broadcast. After a transfer may have
		// gone out, leave the row `pending` — it blocks a re-grant (no double-spend);
		// if the grant did land, the custody event already marked the agent live.
		if (!transferStarted) await releaseClaim();
		return { ok: false, code: 'transfer_failed', message: 'activation could not complete — try again' };
	}
}
