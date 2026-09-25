// Shared plumbing for the agent-wallet trading tools: load an agent the caller
// owns, read its wallet balances, and check the real-funds agreement.
//
// Every financial trading tool acts on one agent's custodial Solana wallet and
// only for that agent's owner. These helpers are the one place that check is
// made, so the MCP tools and the v1 REST routes refuse the same way.

import { PublicKey } from '@solana/web3.js';

import { sql } from '../db.js';
import { solanaConnection } from '../agent-pumpfun.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { ToolInputError, WSOL_MINT } from './market.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The agent row, when `userId` owns it. Throws a ToolInputError otherwise.
 * @param {string} agentId
 * @param {string} userId
 */
export async function loadOwnedAgent(agentId, userId) {
	if (!userId) throw new ToolInputError('auth_required', 'Sign in to three.ws to act on your agents.');
	if (typeof agentId !== 'string' || !UUID_RE.test(agentId)) {
		throw new ToolInputError('invalid_agent', 'agent_id must be the uuid of one of your agents.');
	}
	const [row] = await sql`
		SELECT id, user_id, name, status, meta
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw new ToolInputError('agent_not_found', 'No agent with that id exists.');
	if (row.user_id !== userId) throw new ToolInputError('forbidden', 'Only the owner of this agent can use its wallet.');
	const meta = { ...(row.meta || {}) };
	return { ...row, meta, address: meta.solana_address || null, signable: Boolean(meta.encrypted_solana_secret) };
}

/** The agent's wallet address, or a designed refusal when it has none yet. */
export function requireWallet(agent) {
	if (!agent.address) {
		throw new ToolInputError('no_wallet', 'This agent has no Solana wallet yet. Create one with provision_wallet, fund it, then try again.');
	}
	return agent.address;
}

/**
 * Lamports and one token's raw balance for an address, read at 'confirmed'.
 * @param {string} address
 * @param {string|null} mint  null or wrapped SOL reads only the SOL balance
 * @returns {Promise<{ lamports: bigint, tokenRaw: bigint|null }>}
 */
export async function readBalances(address, mint = null) {
	const conn = solanaConnection('mainnet');
	const owner = new PublicKey(address);
	const lamports = BigInt(await conn.getBalance(owner, 'confirmed'));
	if (!mint || mint === WSOL_MINT) return { lamports, tokenRaw: null };
	const resp = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
	let raw = 0n;
	for (const { account } of resp.value || []) {
		const amt = account.data?.parsed?.info?.tokenAmount?.amount;
		if (amt) raw += BigInt(amt);
	}
	return { lamports, tokenRaw: raw };
}

/**
 * Whether the account signed the current real-funds agreements. Throws a
 * designed refusal naming the sign url when it has not.
 * @param {string} userId
 */
export async function requireAgreement(userId) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		throw new ToolInputError('agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing moved. Try again in a moment.');
	}
	if (!signed) {
		const r = agreementRequirement();
		throw new ToolInputError('risk_ack_required', `Sign the real-funds agreements before moving funds. Nothing moved. Sign at ${r.sign_url}`, r);
	}
	return signed;
}

/** Same check, as a guard row for a preview (never throws on "not signed"). */
export async function agreementCheck(userId) {
	try {
		const signed = await currentSignatureFor(userId);
		return { id: 'agreement', label: 'Real-funds agreements signed', ok: Boolean(signed), detail: signed ? null : agreementRequirement().sign_url };
	} catch {
		return { id: 'agreement', label: 'Real-funds agreements signed', ok: false, detail: 'could not be verified right now' };
	}
}

/** Shape a list of guard rows into the preview's verdict fields. */
export function verdict(checks) {
	const blocked = checks.filter((c) => !c.ok).map((c) => c.id);
	return { checks, executable: blocked.length === 0, blocked_by: blocked };
}
