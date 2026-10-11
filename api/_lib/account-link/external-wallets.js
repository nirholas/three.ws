// External wallets proved by a signed message.
//
// An owner or an agent attaches a wallet the platform does not hold the key
// for, in one of two roles:
//
//   owner    a sign-in wallet on the account (user_wallets). Proves the person
//            at the keyboard controls the key, the same way /api/auth/wallets
//            does, and refuses an address that already signs in elsewhere.
//   payout   where an agent's earnings are sent (agent_payout_wallets). The
//            first payout wallet for a (user, agent, chain) is live at once.
//            Replacing one is how an attacker with a stolen session or key
//            would drain an account, so it is slower on purpose:
//              - an owner in a signed-in session confirms with a password or
//                a fresh re-authentication (step-up) and the new address only
//                takes effect after PAYOUT_COOLDOWN_HOURS;
//              - an agent (an API key, an MCP tool) files an approval request
//                the owner decides from the inbox, and the cooldown starts at
//                the approval.
//            Withdrawals only ever read approved rows whose cooldown has run.
//
// Proof is a Sign-In with Solana or Sign-In with Ethereum message that names
// the role, bound to this origin, carrying a single-use nonce issued to the
// caller. Nothing here signs anything or moves funds.

import { createHash } from 'node:crypto';
import { verifyMessage, getAddress } from 'ethers';
import { sql } from '../db.js';
import { env } from '../env.js';
import { logAudit } from '../audit.js';
import { parseSiweMessage } from '../siwe.js';
import { parseSiwsMessage, verifySiwsSignature } from '../siws.js';
import { issueNonce, consumeNonce, NONCE_TTL_SEC } from '../../auth/wallets/_link-nonces.js';
import { isValidSolanaAddress, isValidEvmAddress } from '../validate.js';
import { createApprovalRequest, ApprovalError } from '../approvals.js';
import { readReauth } from '../identities.js';
import { verifyPassword } from '../auth.js';

export const CHAINS = Object.freeze(['solana', 'evm']);
export const ROLES = Object.freeze(['owner', 'payout']);
export const PAYOUT_COOLDOWN_HOURS = 24;
export const APPROVAL_SOURCE = 'external_wallet';
export const APPROVAL_VENUE = 'payout_wallet';
export const APPROVAL_ACTION = 'payout_wallet_set';
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const SOLANA_CHAIN_IDS = new Set(['mainnet', 'devnet', 'testnet']);

export class ExternalWalletError extends Error {
	constructor(code, message, status = 400, extra = null) {
		super(message);
		this.code = code;
		this.status = status;
		this.extra = extra;
	}
}

export function roleStatement(role, { agentName = null } = {}) {
	if (role === 'owner') return 'Link this wallet to my three.ws account as a sign-in wallet.';
	return agentName
		? `Set this wallet as the payout wallet for my three.ws agent "${agentName}".`
		: 'Set this wallet as the payout wallet for my three.ws account.';
}

function normalizeAddress(chain, address) {
	if (chain === 'solana') {
		if (!isValidSolanaAddress(address)) throw new ExternalWalletError('invalid_address', 'not a valid Solana address');
		return address;
	}
	if (!isValidEvmAddress(address)) throw new ExternalWalletError('invalid_address', 'not a valid EVM address');
	return getAddress(address);
}

// ── challenge ─────────────────────────────────────────────────────────────────

/**
 * Build the message the wallet signs. The nonce is bound to the caller's
 * user id (consumeNonce refuses it for anyone else) and burns on first use.
 */
export async function issueWalletChallenge({ userId, chain, address, role, agentId = null, agentName = null }) {
	if (!CHAINS.includes(chain)) throw new ExternalWalletError('invalid_chain', `chain must be one of ${CHAINS.join(', ')}`);
	if (!ROLES.includes(role)) throw new ExternalWalletError('invalid_role', `role must be one of ${ROLES.join(', ')}`);
	const addr = normalizeAddress(chain, address);
	const nonce = await issueNonce(userId);
	const origin = env.APP_ORIGIN;
	const host = new URL(origin).host;
	const issuedAt = new Date();
	const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_SEC * 1000);
	const lines = [
		`${host} wants you to sign in with your ${chain === 'solana' ? 'Solana' : 'Ethereum'} account:`,
		addr,
		'',
		roleStatement(role, { agentName }),
		'',
		`URI: ${origin}/dashboard/account`,
		'Version: 1',
		`Chain ID: ${chain === 'solana' ? 'mainnet' : '1'}`,
		`Nonce: ${nonce}`,
		`Issued At: ${issuedAt.toISOString()}`,
		`Expiration Time: ${expiresAt.toISOString()}`,
		`Request ID: ${role}${agentId ? `:${agentId}` : ''}`,
	];
	return { chain, address: addr, role, agent_id: agentId, message: lines.join('\n'), nonce, expires_at: expiresAt.toISOString() };
}

// ── proof ─────────────────────────────────────────────────────────────────────

function checkBinding(fields) {
	const appOrigin = env.APP_ORIGIN;
	const appHost = new URL(appOrigin).host;
	const isLocalDev = !env.isProduction && LOCAL_ORIGIN.test(appOrigin);
	const domainOk = fields.domain === appHost || (isLocalDev && /^localhost(:\d+)?$/.test(fields.domain));
	if (!domainOk) throw new ExternalWalletError('invalid_domain', `domain must be ${appHost}`);
	let u;
	try { u = new URL(fields.uri); } catch { throw new ExternalWalletError('invalid_uri', 'uri not a valid URL'); }
	const originOk = u.origin === appOrigin || (isLocalDev && LOCAL_ORIGIN.test(u.origin));
	if (!originOk) throw new ExternalWalletError('invalid_uri', 'uri origin mismatch');
	const now = Date.now();
	if (fields.expirationTime && Date.parse(fields.expirationTime) < now) throw new ExternalWalletError('expired', 'message expired');
	if (fields.notBefore && Date.parse(fields.notBefore) > now) throw new ExternalWalletError('not_yet_valid', 'message not yet valid');
}

/**
 * Verify a signed challenge for `userId`. Returns the proved address and the
 * role the message named. The nonce is consumed here, so a replayed message
 * fails on its nonce before any signature math runs.
 */
export async function verifyWalletProof({ userId, chain, message, signature }) {
	if (!CHAINS.includes(chain)) throw new ExternalWalletError('invalid_chain', `chain must be one of ${CHAINS.join(', ')}`);
	if (typeof message !== 'string' || typeof signature !== 'string' || !message || !signature) {
		throw new ExternalWalletError('invalid_message', 'message and signature are required');
	}
	const fields = chain === 'solana' ? parseSiwsMessage(message) : parseSiweMessage(message);
	if (!fields) throw new ExternalWalletError('invalid_message', `malformed ${chain === 'solana' ? 'SIWS' : 'SIWE'} message`);
	checkBinding(fields);
	if (chain === 'solana' && fields.chainId && !SOLANA_CHAIN_IDS.has(fields.chainId)) throw new ExternalWalletError('invalid_chain', 'unknown Solana chain ID');
	const role = String(fields.requestId || '').split(':')[0];
	if (!ROLES.includes(role)) throw new ExternalWalletError('invalid_message', 'the message does not name a wallet role');
	if (!(await consumeNonce(fields.nonce, userId))) throw new ExternalWalletError('invalid_nonce', 'unknown, expired, or already used nonce');

	let valid = false;
	let address;
	try {
		if (chain === 'solana') {
			valid = verifySiwsSignature(message, signature, fields.address);
			address = fields.address;
		} else {
			address = getAddress(fields.address);
			valid = getAddress(verifyMessage(message, signature)) === address;
		}
	} catch {
		throw new ExternalWalletError('invalid_signature', 'signature verification failed', 401);
	}
	if (!valid) throw new ExternalWalletError('invalid_signature', 'signer does not match address', 401);
	const agentId = fields.requestId?.includes(':') ? fields.requestId.split(':')[1] : null;
	return { address, role, agentId, signatureHash: createHash('sha256').update(signature).digest('hex') };
}

// ── owner wallets ─────────────────────────────────────────────────────────────

export async function attachOwnerWallet({ userId, chain, address, req = null }) {
	const chainType = chain === 'solana' ? 'solana' : 'evm';
	const [mine] = await sql`select id from user_wallets where user_id = ${userId} and address = ${address} limit 1`;
	if (mine) return { address, chain_type: chainType, already_linked: true };
	const [other] = await sql`select user_id from user_wallets where address = ${address} limit 1`;
	if (other) throw new ExternalWalletError('address_in_use', 'this address already signs in to another account', 409);
	await sql`insert into user_wallets (user_id, address, chain_type, is_primary) values (${userId}, ${address}, ${chainType}, false)`;
	logAudit({ userId, action: 'link_owner_wallet', resourceId: address, meta: { chain: chainType, via: 'external_wallet' }, req });
	return { address, chain_type: chainType, already_linked: false };
}

// ── payout wallets ────────────────────────────────────────────────────────────

function payoutChain(chain) {
	// agent_payout_wallets stores the settlement chain; EVM payouts land on Base.
	return chain === 'solana' ? 'solana' : 'base';
}

// 'base' and 'evm' are one rail with two historical chain labels (see
// api/monetization/wallet.js), so a replacement check and a default clear
// must cover the whole rail or the older row wins the withdrawal tie.
export function railChains(chain) {
	return chain === 'solana' ? ['solana'] : ['base', 'evm'];
}

export function publicPayoutWallet(w, now = Date.now()) {
	const effective = new Date(w.effective_at).getTime() <= now;
	return {
		id: w.id,
		agent_id: w.agent_id,
		address: w.address,
		chain: w.chain,
		is_default: w.is_default,
		preferred_network: w.preferred_network,
		created_at: w.created_at,
		verified_at: w.verified_at || null,
		approved_at: w.approved_at || null,
		effective_at: w.effective_at,
		approval_request_id: w.approval_request_id || null,
		set_by: w.set_by || null,
		status: !w.approved_at ? 'awaiting_approval' : effective ? 'active' : 'cooldown',
	};
}

async function currentPayoutWallet({ userId, agentId, chain }) {
	const rail = railChains(chain);
	const [row] = await sql`
		select * from agent_payout_wallets
		where user_id = ${userId} and chain = any(${rail}) and agent_id is not distinct from ${agentId}
		order by is_default desc, created_at desc limit 1
	`;
	return row || null;
}

/**
 * The cooldown and step-up rules, shared with the unproved writers
 * (api/monetization/wallet.js, api/billing/payout-wallets/index.js) so no
 * route can replace a live payout address instantly.
 *   first wallet on the rail, or the same address again: live at once
 *   a different address: step-up required, live after PAYOUT_COOLDOWN_HOURS
 */
export async function payoutChangePolicy({ userId, agentId = null, chain, address, stepUp = false }) {
	const existing = await currentPayoutWallet({ userId, agentId, chain });
	const now = new Date().toISOString();
	if (!existing || existing.address === address) return { approvedAt: now, effectiveAt: now, previous: null, replacing: false };
	if (!stepUp) {
		throw new ExternalWalletError('step_up_required', 'changing a payout wallet needs your password or a fresh sign-in', 403, {
			current_address: existing.address, cooldown_hours: PAYOUT_COOLDOWN_HOURS,
		});
	}
	return { approvedAt: now, effectiveAt: new Date(Date.now() + PAYOUT_COOLDOWN_HOURS * 3600 * 1000).toISOString(), previous: existing.address, replacing: true };
}

/** Step-up for a session: a fresh re-authentication cookie, or the password in the body. */
export async function stepUpProven(req, userId, body = {}) {
	if (await readReauth(req, userId)) return true;
	if (typeof body?.password !== 'string' || !body.password) return false;
	const [row] = await sql`select password_hash from users where id = ${userId} limit 1`;
	return Boolean(row?.password_hash) && (await verifyPassword(body.password, row.password_hash));
}

async function writePayoutWallet({ userId, agentId, chain, address, proofChain, signatureHash, setBy, approvedAt, effectiveAt, approvalRequestId = null }) {
	const existing = await currentPayoutWallet({ userId, agentId, chain });
	await sql`
		update agent_payout_wallets set is_default = false
		where user_id = ${userId} and chain = any(${railChains(chain)}) and agent_id is not distinct from ${agentId}
	`;
	if (existing) {
		const [row] = await sql`
			update agent_payout_wallets
			set address = ${address}, chain = ${chain}, is_default = true, proof_chain = ${proofChain}, proof_signature_hash = ${signatureHash},
			    verified_at = now(), set_by = ${setBy}, approved_at = ${approvedAt}, effective_at = ${effectiveAt},
			    approval_request_id = ${approvalRequestId}
			where id = ${existing.id} returning *
		`;
		return { row, previous: existing.address };
	}
	const [row] = await sql`
		insert into agent_payout_wallets
			(user_id, agent_id, address, chain, is_default, proof_chain, proof_signature_hash, verified_at, set_by, approved_at, effective_at, approval_request_id)
		values (${userId}, ${agentId}, ${address}, ${chain}, true, ${proofChain}, ${signatureHash}, now(), ${setBy}, ${approvedAt}, ${effectiveAt}, ${approvalRequestId})
		returning *
	`;
	return { row, previous: null };
}

async function agentOwnedBy(agentId, userId) {
	if (!agentId) return null;
	const [agent] = await sql`select id, user_id, name from agent_identities where id = ${agentId} and deleted_at is null limit 1`;
	if (!agent) throw new ExternalWalletError('agent_not_found', 'agent not found', 404);
	if (agent.user_id !== userId) throw new ExternalWalletError('forbidden', 'you do not own this agent', 403);
	return agent;
}

/**
 * Set a proved payout wallet.
 *   actor 'owner'  a signed-in session. A replacement needs `stepUp` true.
 *   actor 'agent'  an API key or MCP tool. A replacement files an approval.
 */
export async function setPayoutWallet({ userId, agentId = null, chain, address, signatureHash, actor, stepUp = false, req = null }) {
	const agent = await agentOwnedBy(agentId, userId);
	const payoutChainName = payoutChain(chain);
	const existing = await currentPayoutWallet({ userId, agentId, chain: payoutChainName });
	const proofChain = chain;

	if (existing && existing.address === address && existing.approved_at) {
		return { outcome: 'unchanged', wallet: publicPayoutWallet(existing) };
	}

	if (!existing) {
		const { row } = await writePayoutWallet({
			userId, agentId, chain: payoutChainName, address, proofChain, signatureHash, setBy: actor,
			approvedAt: new Date().toISOString(), effectiveAt: new Date().toISOString(),
		});
		logAudit({ userId, action: 'link_payout_wallet', resourceId: row.id, meta: { chain: payoutChainName, address, agent_id: agentId, actor, first: true }, req });
		return { outcome: 'active', wallet: publicPayoutWallet(row) };
	}

	const effectiveAt = new Date(Date.now() + PAYOUT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
	if (actor === 'owner') {
		if (!stepUp) {
			throw new ExternalWalletError('step_up_required', 'changing a payout wallet needs your password or a fresh sign-in', 403, {
				current_address: existing.address, cooldown_hours: PAYOUT_COOLDOWN_HOURS,
			});
		}
		const { row, previous } = await writePayoutWallet({
			userId, agentId, chain: payoutChainName, address, proofChain, signatureHash, setBy: actor,
			approvedAt: new Date().toISOString(), effectiveAt,
		});
		logAudit({ userId, action: 'link_payout_wallet', resourceId: row.id, meta: { chain: payoutChainName, address, previous, agent_id: agentId, actor, effective_at: effectiveAt, step_up: true }, req });
		return { outcome: 'cooldown', wallet: publicPayoutWallet(row), previous, cooldown_hours: PAYOUT_COOLDOWN_HOURS };
	}

	// An agent asked. The owner decides from the approvals inbox; the address
	// is written only by the executor below, after the approval.
	let created;
	try {
		created = await createApprovalRequest({
			userId,
			agentId,
			requesterRole: 'agent',
			source: APPROVAL_SOURCE,
			sourceRef: `payout:${agentId || 'account'}:${payoutChainName}`,
			actionType: APPROVAL_ACTION,
			venue: APPROVAL_VENUE,
			payload: { user_id: userId, agent_id: agentId, chain: payoutChainName, proof_chain: proofChain, address, previous: existing.address, signature_hash: signatureHash },
			summary: `Change the ${payoutChainName === 'solana' ? 'Solana' : 'Base'} payout wallet${agent ? ` for ${agent.name}` : ''} to ${address}`,
			chain: payoutChainName,
			recipient: address,
			recipientLabel: 'New payout wallet',
			riskNotes: [
				`Earnings currently go to ${existing.address}.`,
				`The new wallet takes effect ${PAYOUT_COOLDOWN_HOURS} hours after you approve.`,
			],
			gateReason: 'An agent asked to change where its earnings are paid out. Only you can approve that.',
			idempotencyKey: `payout_wallet:${userId}:${agentId || 'account'}:${payoutChainName}:${signatureHash}`,
			autoApprovable: false,
		});
	} catch (err) {
		if (err instanceof ApprovalError) throw new ExternalWalletError(err.code, err.message, err.status);
		throw err;
	}
	logAudit({ userId, action: 'link_payout_wallet_requested', resourceId: created.request.id, meta: { chain: payoutChainName, address, previous: existing.address, agent_id: agentId, actor }, req });
	return { outcome: 'awaiting_approval', approval: { id: created.request.id, status: created.request.status, expires_at: created.request.expires_at, payload_hash: created.request.payload_hash }, previous: existing.address, cooldown_hours: PAYOUT_COOLDOWN_HOURS };
}

/** The approvals executor for APPROVAL_SOURCE: writes the address once the owner approved. */
export async function executeApprovedPayoutWallet(row) {
	const p = row.payload || {};
	if (!p.user_id || !p.address || !p.chain) return { status: 'error', note: 'The request payload is incomplete, so nothing was changed.' };
	if (String(p.user_id) !== String(row.user_id)) return { status: 'error', note: 'This request belongs to a different account, so nothing was changed.' };
	if (p.agent_id) {
		const [agent] = await sql`select user_id from agent_identities where id = ${p.agent_id} and deleted_at is null limit 1`;
		if (!agent || agent.user_id !== row.user_id) return { status: 'error', note: 'This agent is no longer owned by the account that approved it, so nothing was changed.' };
	}
	const effectiveAt = new Date(Date.now() + PAYOUT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
	const { row: wallet, previous } = await writePayoutWallet({
		userId: row.user_id, agentId: p.agent_id || null, chain: p.chain, address: p.address, proofChain: p.proof_chain || null,
		signatureHash: p.signature_hash || null, setBy: 'agent', approvedAt: new Date().toISOString(), effectiveAt, approvalRequestId: row.id,
	});
	logAudit({ userId: row.user_id, action: 'link_payout_wallet', resourceId: wallet.id, meta: { chain: p.chain, address: p.address, previous, agent_id: p.agent_id || null, actor: 'agent', approval_id: row.id, effective_at: effectiveAt } });
	return { status: 'ok', note: `Payout wallet set to ${p.address}; it takes effect in ${PAYOUT_COOLDOWN_HOURS} hours.`, wallet_id: wallet.id, effective_at: effectiveAt };
}

/** Every payout wallet with its live status, for the account page and get_linked_accounts. */
export async function listPayoutWallets(userId) {
	const rows = await sql`
		select w.*, a.name as agent_name
		from agent_payout_wallets w left join agent_identities a on a.id = w.agent_id
		where w.user_id = ${userId}
		order by w.agent_id nulls first, w.chain, w.is_default desc, w.created_at desc
	`;
	return rows.map((w) => ({ ...publicPayoutWallet(w), agent_name: w.agent_name || null }));
}
