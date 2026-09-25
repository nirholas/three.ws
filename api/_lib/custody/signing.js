// The signing contract every fund-moving route and tool calls.
//
// An agent's fund-moving actions are signed one of three ways (agent_signers):
//
//   platform  the default. The platform decrypts the agent's custodial key and
//             signs, behind the confirm flag and the spend policy.
//   external  the platform never signs. Every fund-moving route returns an
//             unsigned, simulated transaction plus a tx_id for the owner's own
//             wallet; POST /api/tx/submit broadcasts the signed copy and records
//             it in the custody ledger. The signature is the confirmation.
//   session   the owner granted a delegate key from their own wallet with an
//             on-chain SPL approval capped at N units of one mint, valid until
//             an expiry. The agent acts unattended within that cap; anything
//             the session cannot cover falls back to the external path.
//
// A caller may also ask for `signer: "external"` on any single request, which
// builds for the owner's wallet even when the agent is in platform mode.
//
// Route authors use three functions:
//
//   resolveSigningPath()        which path this request takes
//   prepareForExternalSigner()  build + simulate + store an unsigned transaction
//   reserveSessionSpend()       atomically claim session headroom before signing
//
// and assertPlatformSigningAllowed() is enforced centrally by
// recoverSolanaAgentKeypair, so no custodial signature can happen for an agent
// whose owner opted out of platform custody, even from a route that forgot to
// ask.

import { sql } from '../db.js';
import { prepareExternalTx } from './external-tx.js';
import { clientError } from './builders.js';

export const SIGNER_MODES = Object.freeze(['platform', 'external', 'session']);

// Session limits a grant may ask for. The cap ceiling keeps a typo from
// approving a delegate over the owner's whole balance; the owner can always
// grant again.
export const SESSION_MAX_CAP_UI = 10_000;
export const SESSION_MAX_HOURS = 24 * 30;
export const SESSION_MIN_HOURS = 1;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Normalize a `signer` request field. Absent means "use the agent's mode".
 * @returns {'platform'|'external'|'session'|null}
 */
export function parseSignerChoice(value) {
	if (value === undefined || value === null || value === '') return null;
	const v = String(value).trim().toLowerCase();
	if (!SIGNER_MODES.includes(v)) {
		throw clientError('invalid_parameter', 'signer must be "platform", "external" or "session"');
	}
	return v;
}

/** The agent's signer row, or the implicit platform default. */
export async function getAgentSigner(agentId) {
	const [row] = await sql`SELECT * FROM agent_signers WHERE agent_id = ${agentId}`;
	return row || { agent_id: agentId, mode: 'platform' };
}

/** A session row's effective status, folding in the expiry clock. */
export function sessionStatus(row, now = Date.now()) {
	if (!row || !row.session_pubkey) return null;
	if (row.session_status === 'active' && row.session_expires_at && new Date(row.session_expires_at).getTime() <= now) {
		return 'expired';
	}
	return row.session_status || null;
}

/** Owner-safe view of a signer row. The session secret never leaves the server. */
export function publicSigner(row, now = Date.now()) {
	const mode = row?.mode || 'platform';
	const status = sessionStatus(row, now);
	const session = row?.session_pubkey
		? {
			delegate: row.session_pubkey,
			owner: row.external_pubkey || null,
			network: row.session_network || 'mainnet',
			mint: row.session_mint || null,
			decimals: row.session_decimals ?? null,
			cap_raw: row.session_cap_raw != null ? String(row.session_cap_raw) : null,
			cap: row.session_cap_raw != null && row.session_decimals != null
				? Number(row.session_cap_raw) / 10 ** row.session_decimals
				: null,
			spent_raw: String(row.session_spent_raw ?? 0),
			spent: row.session_decimals != null ? Number(row.session_spent_raw ?? 0) / 10 ** row.session_decimals : null,
			remaining: row.session_cap_raw != null && row.session_decimals != null
				? Math.max(0, Number(row.session_cap_raw) - Number(row.session_spent_raw ?? 0)) / 10 ** row.session_decimals
				: null,
			expires_at: row.session_expires_at || null,
			status,
			grant_signature: row.session_grant_signature || null,
		}
		: null;
	return {
		agent_id: row?.agent_id ?? null,
		mode,
		external_pubkey: row?.external_pubkey || null,
		custodial: mode === 'platform',
		session,
		updated_at: row?.updated_at || null,
	};
}

/**
 * The user's primary linked Solana wallet (SIWS or wallet link), or null.
 * Used as the external signer when the caller names none.
 */
export async function primaryLinkedSolanaWallet(userId) {
	const [row] = await sql`
		SELECT address FROM user_wallets
		WHERE user_id = ${userId} AND chain_type = 'solana'
		ORDER BY is_primary DESC, last_used_at DESC NULLS LAST, created_at ASC
		LIMIT 1
	`;
	return row?.address || null;
}

function normalizePubkey(value, field) {
	const s = String(value || '').trim();
	if (!BASE58_RE.test(s)) throw clientError('invalid_parameter', `${field} must be a base58 Solana address`);
	return s;
}

/**
 * Decide how one fund-moving request is signed.
 *
 * @param {object} p
 * @param {string|null} p.agentId       null for a user-level (no agent) build
 * @param {string} p.userId
 * @param {string|null} [p.requested]   parsed `signer` field (parseSignerChoice)
 * @param {string|null} [p.signerPubkey] caller-named wallet for the external path
 * @param {boolean} [p.sessionCapable]  true when this action can run under a session key
 * @param {object} [p.signerRow]        preloaded agent_signers row (tests, batching)
 * @returns {Promise<{ path: 'custodial' }
 *   | { path: 'external', pubkey: string, reason: string }
 *   | { path: 'session', signer: object }>}
 */
export async function resolveSigningPath({ agentId, userId, requested = null, signerPubkey = null, sessionCapable = false, signerRow = null }) {
	const named = signerPubkey ? normalizePubkey(signerPubkey, 'signer_pubkey') : null;

	if (!agentId) {
		if (requested === 'platform' || requested === 'session') {
			throw clientError('invalid_parameter', 'a request without an agent can only be signed externally');
		}
		const pubkey = named || (await primaryLinkedSolanaWallet(userId));
		if (!pubkey) throw clientError('signer_pubkey_required', 'Name the wallet that will sign (signer_pubkey), or link a Solana wallet to your account.');
		return { path: 'external', pubkey, reason: 'no_agent' };
	}

	const row = signerRow || (await getAgentSigner(agentId));
	const mode = row.mode || 'platform';

	if (requested === 'platform' && mode !== 'platform') {
		throw clientError('platform_signing_disabled', `This agent is in ${mode} signing mode, so the platform will not sign for it. Use signer "external" or change the mode at PUT /api/agents/${agentId}/signer.`, 409);
	}
	if (requested === 'session' && mode !== 'session') {
		throw clientError('no_session', 'This agent has no active session key. Grant one at PUT /api/agents/' + agentId + '/signer.', 409);
	}

	const externalPubkey = async (reason) => {
		const registered = row.external_pubkey || null;
		if (registered && named && named !== registered) {
			throw clientError('signer_mismatch', `This agent's registered signer is ${registered}; a transaction for another wallet cannot be prepared for it.`, 409);
		}
		const pubkey = registered || named || (await primaryLinkedSolanaWallet(userId));
		if (!pubkey) throw clientError('signer_pubkey_required', 'Name the wallet that will sign (signer_pubkey), or link a Solana wallet to your account.');
		return { path: 'external', pubkey, reason };
	};

	if (requested === 'external') return externalPubkey('requested');
	if (mode === 'external') return externalPubkey('agent_external_mode');
	if (mode === 'session') {
		if (sessionCapable) return { path: 'session', signer: row };
		return externalPubkey('outside_session_scope');
	}
	return { path: 'custodial' };
}

/**
 * Build, simulate and store an unsigned transaction for an external signer.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {string|null} p.agentId
 * @param {string} p.kind          an EXTERNAL_TX_KINDS value (transfer, withdraw, swap, ...)
 * @param {'mainnet'|'devnet'} p.network
 * @param {string} p.pubkey        the wallet that signs and pays fees
 * @param {(pubkey: string) => Promise<{ transaction: import('@solana/web3.js').VersionedTransaction,
 *   summary: object, lastValidBlockHeight?: number|null }>} p.build
 * @param {object} [p.connection]
 * @param {boolean} [p.simulate=true]
 */
export async function prepareForExternalSigner({ userId, agentId = null, kind, network, pubkey, build, connection = null, simulate = true }) {
	const built = await build(pubkey);
	return prepareExternalTx({
		userId,
		agentId,
		kind,
		network,
		signer: pubkey,
		transaction: built.transaction,
		summary: built.summary,
		lastValidBlockHeight: built.lastValidBlockHeight ?? null,
		simulate,
		connection,
	});
}

/**
 * Pure check: may this session key spend `amountRaw` of `mint` right now?
 * @returns {{ ok: true } | { ok: false, status: number, code: string, message: string }}
 */
export function sessionAllows(row, { mint, amountRaw, network = null, now = Date.now() }) {
	const status = sessionStatus(row, now);
	if (!row || row.mode !== 'session' || !row.session_pubkey) {
		return { ok: false, status: 409, code: 'no_session', message: 'This agent has no session key.' };
	}
	if (status === 'expired') {
		return { ok: false, status: 403, code: 'session_expired', message: `The session key expired at ${new Date(row.session_expires_at).toISOString()}. Grant a new one to keep acting unattended.` };
	}
	if (status !== 'active') {
		return { ok: false, status: 403, code: 'session_inactive', message: `The session key is ${status || 'not active'}; it cannot sign.` };
	}
	if (network && row.session_network && network !== row.session_network) {
		return { ok: false, status: 403, code: 'session_wrong_network', message: `The session key covers ${row.session_network}, not ${network}.` };
	}
	if (!mint || mint !== row.session_mint) {
		return { ok: false, status: 403, code: 'session_wrong_asset', message: 'The session key only covers the token it was granted for.' };
	}
	const amount = BigInt(String(amountRaw));
	if (amount <= 0n) return { ok: false, status: 400, code: 'invalid_amount', message: 'amount must be positive' };
	const cap = BigInt(String(row.session_cap_raw ?? 0));
	const spent = BigInt(String(row.session_spent_raw ?? 0));
	if (spent + amount > cap) {
		const d = Number(row.session_decimals ?? 0);
		const ui = (v) => Number(v) / 10 ** d;
		return {
			ok: false,
			status: 403,
			code: 'session_cap_exceeded',
			message: `This transfer of ${ui(amount)} would exceed the session cap: ${ui(spent)} of ${ui(cap)} already used, ${ui(cap - spent > 0n ? cap - spent : 0n)} left.`,
		};
	}
	return { ok: true };
}

/**
 * Atomically claim `amountRaw` of session headroom. The UPDATE's WHERE clause
 * is the cap check, so two concurrent spends can never together exceed it.
 * Throws a tagged 4xx naming the reason when the claim is refused.
 * @returns {Promise<{ row: object, release: () => Promise<void> }>}
 */
export async function reserveSessionSpend(agentId, { mint, amountRaw, network = null }) {
	const amount = String(BigInt(String(amountRaw)));
	const [row] = await sql`
		UPDATE agent_signers
		SET session_spent_raw = session_spent_raw + ${amount}::numeric, updated_at = now()
		WHERE agent_id = ${agentId}
		  AND mode = 'session'
		  AND session_status = 'active'
		  AND session_expires_at > now()
		  AND session_mint = ${mint}
		  AND (${network}::text IS NULL OR session_network = ${network})
		  AND session_spent_raw + ${amount}::numeric <= session_cap_raw
		RETURNING *
	`;
	if (!row) {
		const current = await getAgentSigner(agentId);
		const verdict = sessionAllows(current, { mint, amountRaw: amount, network });
		const why = verdict.ok
			? { status: 409, code: 'session_contended', message: 'The session headroom changed while this was being claimed; try again.' }
			: verdict;
		throw clientError(why.code, why.message, why.status);
	}
	let released = false;
	return {
		row,
		release: async () => {
			if (released) return;
			released = true;
			await sql`
				UPDATE agent_signers
				SET session_spent_raw = GREATEST(0, session_spent_raw - ${amount}::numeric), updated_at = now()
				WHERE agent_id = ${agentId}
			`;
		},
	};
}

/**
 * Throw when the platform must not sign for this agent. Called by
 * recoverSolanaAgentKeypair for every audited key recovery.
 */
export async function assertPlatformSigningAllowed(agentId) {
	const [row] = await sql`SELECT mode FROM agent_signers WHERE agent_id = ${agentId}`;
	const mode = row?.mode;
	if (mode === 'external' || mode === 'session') {
		throw Object.assign(
			new Error(`This agent is in ${mode} signing mode, so the platform will not sign for it. Send signer "external" to get a transaction for your own wallet, or switch back to platform custody.`),
			{ status: 409, code: 'platform_signing_disabled', expose: true, signerMode: mode },
		);
	}
}
