// Custody rotation for a sold agent: the steps that make the buyer the only
// party who can control it.
//
// The seller may know the agent's current private key (an imported vanity key,
// an export), so ownership alone is not enough: the agent gets a brand-new
// server-generated keypair, everything on the old wallet is swept off it, the
// new key replaces the old one in a single conditional write, and the old
// ciphertext is purged. Every grant, automation and payout path the seller set
// up is revoked or reset to conservative defaults, and every owner copy follows
// the buyer.
//
// Each exported step is idempotent on its own: it inspects what is already
// done and finishes only the rest, so settlement.js can re-run any of them
// after a crash. Nothing here decides ORDER; the state machine does.

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { sql } from '../db.js';
import {
	decryptSecret,
	generateAgentWallet,
	generateSolanaAgentWallet,
	recoverSolanaAgentKeypair,
} from '../agent-wallet.js';
import { recordCustodyEvent, SPEND_LIMIT_DEFAULTS, TRADE_LIMIT_DEFAULTS } from '../agent-trade-guards.js';
import { closeIx, marketConnection, sendLeg, transferIxs } from './chain.js';

// What a freshly transferred agent is allowed to do until its new owner says
// otherwise: nothing autonomous. The wallet starts frozen, trading starts
// killed, and the caps are small, so the buyer opts back in deliberately.
export const CONSERVATIVE_SPEND_LIMITS = Object.freeze({
	...SPEND_LIMIT_DEFAULTS,
	daily_usd: 25,
	per_tx_usd: 10,
	per_counterparty_daily_usd: 10,
	withdraw_allowlist: [],
	frozen: true,
});
export const CONSERVATIVE_TRADE_LIMITS = Object.freeze({
	...TRADE_LIMIT_DEFAULTS,
	per_trade_sol: 0.05,
	daily_budget_sol: 0.25,
	kill_switch: true,
});

// Meta keys that describe the SELLER's setup, not the agent: payout routing,
// recovery beneficiaries, bot bindings, autopilot destinations.
const SELLER_META_KEYS = ['autopilot', 'recovery', 'telegram', 'policy_rules', 'withdraw_allowlist'];

function typed(status, code, message) {
	return Object.assign(new Error(message), { status, code, expose: true });
}

async function custody(agentId, userId, eventType, reason, meta = {}, extra = {}) {
	await recordCustodyEvent({ agentId, userId, eventType, reason, meta, ...extra }).catch((e) =>
		console.warn('[agent-market] custody event failed', eventType, e?.message),
	);
}

export async function loadAgent(agentId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta, wallet_address, chain_id, avatar_id, voice_key_source, deleted_at
		FROM agent_identities WHERE id = ${agentId} LIMIT 1
	`;
	if (!row) throw typed(404, 'agent_not_found', 'agent not found');
	return row;
}

// ── 1. New keys ──────────────────────────────────────────────────────────────

/**
 * Generate the agent's replacement keys once and park them, encrypted, on the
 * transfer row BEFORE anything is swept to them. A crash after this point can
 * never strand funds on a key nobody stored.
 */
export async function prepareNewKeys(transfer, agent) {
	if (transfer.rotation?.pending?.solana_address) return transfer.rotation.pending;
	const sol = await generateSolanaAgentWallet();
	const pending = {
		solana_address: sol.address,
		encrypted_solana_secret: sol.encrypted_secret,
		old_solana_address: agent.meta?.solana_address || null,
		generated_at: new Date().toISOString(),
	};
	if (agent.meta?.encrypted_wallet_key) {
		const evm = await generateAgentWallet();
		pending.evm_address = evm.address;
		pending.encrypted_evm_key = evm.encrypted_key;
		pending.old_evm_address = agent.wallet_address || null;
	}
	const [row] = await sql`
		UPDATE agent_transfers
		SET rotation = rotation || jsonb_build_object('pending', ${JSON.stringify(pending)}::jsonb),
		    old_wallet_address = ${pending.old_solana_address},
		    new_wallet_address = ${pending.solana_address},
		    updated_at = now()
		WHERE id = ${transfer.id} AND NOT (rotation ? 'pending')
		RETURNING rotation
	`;
	if (row) {
		await custody(agent.id, transfer.seller_user_id, 'key_rotation', 'marketplace_new_key', {
			transfer_id: transfer.id, new_address: pending.solana_address, evm: Boolean(pending.evm_address),
		});
		return pending;
	}
	const [fresh] = await sql`SELECT rotation FROM agent_transfers WHERE id = ${transfer.id}`;
	return fresh.rotation.pending;
}

// ── 2. Sweep the old Solana wallet ───────────────────────────────────────────

async function tokenAccounts(connection, owner) {
	const out = [];
	for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
		const resp = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId }, 'confirmed');
		for (const { pubkey, account } of resp.value || []) {
			const info = account.data?.parsed?.info;
			if (!info?.tokenAmount) continue;
			out.push({
				ata: pubkey.toBase58(),
				mint: info.mint,
				programId,
				decimals: info.tokenAmount.decimals,
				amount: BigInt(info.tokenAmount.amount || '0'),
				frozen: info.state === 'frozen',
			});
		}
	}
	return out;
}

function legStore(transferId) {
	return async (legId, rec) => {
		await sql`
			UPDATE agent_transfers
			SET legs = legs || jsonb_build_object(${legId}::text, ${JSON.stringify(rec)}::jsonb), updated_at = now()
			WHERE id = ${transferId}
		`;
	};
}

/**
 * Move every token and all SOL off the old wallet to `destination`: the new
 * wallet when the balance was included, the seller's payout address when not.
 * The platform payer pays fees, so the old wallet can be drained to exactly
 * zero. Frozen token accounts cannot move by anyone; they are recorded as
 * stranded in the rotation record rather than blocking the transfer forever.
 */
export async function sweepOldWallet({ transfer, agent, destination, connection = marketConnection() }) {
	const oldAddress = transfer.rotation?.pending?.old_solana_address || agent.meta?.solana_address;
	if (!oldAddress) return { swept: [], stranded: [], sol_lamports: '0' };
	if (agent.meta?.solana_address !== oldAddress) {
		// Keys already swapped on an earlier run; the sweep finished before that.
		return transfer.rotation?.sweep || { swept: [], stranded: [], sol_lamports: '0' };
	}
	// custodyOverride: the seller's own listing and acceptance authorized this
	// one sweep, like the owner-initiated rotation after a key export. Listing
	// is refused outside platform custody, but an owner who switched signing
	// mode after listing must not strand the buyer's paid-for transfer.
	const oldKp = await recoverSolanaAgentKeypair(agent.meta.encrypted_solana_secret, {
		agentId: agent.id, userId: transfer.seller_user_id, reason: 'marketplace_sweep', meta: { transfer_id: transfer.id },
		custodyOverride: true,
	});
	if (oldKp.publicKey.toBase58() !== oldAddress) {
		throw typed(500, 'wallet_key_mismatch', 'the stored key does not match the agent wallet address');
	}
	const save = legStore(transfer.id);
	const legs = transfer.legs || {};
	const swept = [];
	const stranded = [];

	for (const acct of await tokenAccounts(connection, oldAddress)) {
		if (acct.frozen) {
			if (acct.amount > 0n) stranded.push({ mint: acct.mint, amount: acct.amount.toString(), reason: 'frozen' });
			continue;
		}
		const legId = `sweep:${transfer.id}:${acct.ata}`;
		const build = (withClose) => (reference, payer) => [
			...(acct.amount > 0n
				? transferIxs({
					owner: oldAddress, recipient: destination, mint: acct.mint, programId: acct.programId,
					decimals: acct.decimals, atomics: acct.amount, rentPayer: payer.toBase58(), reference,
				})
				: []),
			...(withClose ? [closeIx({ owner: oldAddress, mint: acct.mint, programId: acct.programId, rentTo: destination })] : []),
		];
		try {
			const r = await sendLeg({
				connection, legId, prior: legs[legId] || null, signers: [oldKp], build: build(true),
				onPrepared: (rec) => save(legId, rec),
			});
			swept.push({ mint: acct.mint, amount: acct.amount.toString(), signature: r.signature, closed: true });
		} catch (err) {
			if (err.code !== 'leg_simulation_failed') throw err;
			// A Token-2022 account holding withheld transfer fees cannot close.
			// An empty one is left behind as is; a funded one moves its balance
			// and leaves the empty account.
			if (acct.amount === 0n) continue;
			const r = await sendLeg({
				connection, legId: `${legId}:noclose`, prior: legs[`${legId}:noclose`] || null, signers: [oldKp],
				build: build(false), onPrepared: (rec) => save(`${legId}:noclose`, rec),
			});
			swept.push({ mint: acct.mint, amount: acct.amount.toString(), signature: r.signature, closed: false });
		}
	}

	const lamports = BigInt(await connection.getBalance(new PublicKey(oldAddress), 'confirmed'));
	let solSig = null;
	if (lamports > 0n) {
		const legId = `sweep-sol:${transfer.id}`;
		const r = await sendLeg({
			connection, legId, prior: legs[legId] || null, signers: [oldKp],
			build: (reference) => {
				const ix = SystemProgram.transfer({ fromPubkey: oldKp.publicKey, toPubkey: new PublicKey(destination), lamports });
				ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
				return [ix];
			},
			onPrepared: (rec) => save(legId, rec),
		});
		solSig = r.signature;
	}

	const leftover = (await tokenAccounts(connection, oldAddress)).filter((a) => a.amount > 0n && !a.frozen);
	if (leftover.length) {
		throw typed(409, 'sweep_incomplete', `the old wallet still holds ${leftover.length} token balance(s); resume to sweep them`);
	}
	const record = { destination, swept, stranded, sol_lamports: lamports.toString(), sol_signature: solSig, at: new Date().toISOString() };
	await sql`
		UPDATE agent_transfers SET rotation = rotation || jsonb_build_object('sweep', ${JSON.stringify(record)}::jsonb), updated_at = now()
		WHERE id = ${transfer.id}
	`;
	await custody(agent.id, transfer.seller_user_id, 'spend', 'marketplace_sweep', record, {
		category: 'marketplace_transfer', asset: 'ALL', destination, status: 'confirmed', signature: solSig || swept.at(-1)?.signature || null,
	});
	return record;
}

// ── 3. Sweep the old EVM wallet (Base) when the agent had a custodial one ─────

const ERC20_ABI = [
	{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

/**
 * Empty the agent's old custodial EVM wallet into `destination`. Every send
 * moves the FULL current balance, so a resumed run after an unrecorded send
 * can only revert for lack of funds, never pay twice.
 */
export async function sweepOldEvmWallet({ transfer, agent, destination }) {
	const pending = transfer.rotation?.pending;
	if (!pending?.old_evm_address || !agent.meta?.encrypted_wallet_key) return null;
	if (agent.wallet_address?.toLowerCase() !== pending.old_evm_address.toLowerCase()) {
		return transfer.rotation?.evm_sweep || null;
	}
	const chainId = Number(agent.chain_id) || 8453;
	const [{ createPublicClient, createWalletClient }, { privateKeyToAccount }, chains, { evmTransport }, { EVM_USDC }] = await Promise.all([
		import('viem'), import('viem/accounts'), import('viem/chains'), import('../evm/rpc.js'), import('../../payments/_config.js'),
	]);
	const chain = Object.values(chains).find((c) => c?.id === chainId);
	if (!chain) throw typed(500, 'evm_chain_unsupported', `unsupported EVM chain ${chainId}`);
	const transport = evmTransport(chainId);
	const pub = createPublicClient({ chain, transport });
	const pk = await decryptSecret(agent.meta.encrypted_wallet_key);
	const account = privateKeyToAccount(pk);
	if (account.address.toLowerCase() !== pending.old_evm_address.toLowerCase()) {
		throw typed(500, 'evm_key_mismatch', 'the stored EVM key does not match the agent wallet address');
	}
	const wallet = createWalletClient({ account, chain, transport });
	const hashes = [];
	const usdc = EVM_USDC[chainId];
	if (usdc) {
		const bal = await pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
		if (bal > 0n) {
			const native = await pub.getBalance({ address: account.address });
			if (native === 0n) {
				throw typed(409, 'evm_needs_gas', `the agent's EVM wallet ${account.address} holds USDC but no native gas; send a little ETH to it, then resume`);
			}
			const hash = await wallet.writeContract({ address: usdc, abi: ERC20_ABI, functionName: 'transfer', args: [destination, bal] });
			await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
			hashes.push({ asset: 'USDC', amount: bal.toString(), hash });
		}
	}
	const native = await pub.getBalance({ address: account.address });
	if (native > 0n) {
		const gasPrice = await pub.getGasPrice();
		const fee = gasPrice * 21_000n * 2n;
		if (native > fee) {
			const hash = await wallet.sendTransaction({ to: destination, value: native - fee, gas: 21_000n, gasPrice });
			await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
			hashes.push({ asset: 'native', amount: (native - fee).toString(), hash });
		}
	}
	const record = { destination, chain_id: chainId, legs: hashes, at: new Date().toISOString() };
	await sql`
		UPDATE agent_transfers SET rotation = rotation || jsonb_build_object('evm_sweep', ${JSON.stringify(record)}::jsonb), updated_at = now()
		WHERE id = ${transfer.id}
	`;
	if (hashes.length) {
		await custody(agent.id, transfer.seller_user_id, 'spend', 'marketplace_evm_sweep', record, {
			category: 'marketplace_transfer', asset: 'ALL', destination, network: `eip155:${chainId}`, status: 'confirmed', signature: hashes.at(-1).hash,
		});
	}
	return record;
}

// ── 4. Swap keys ─────────────────────────────────────────────────────────────

/**
 * Replace the agent's keys with the pending ones in one conditional write. The
 * old ciphertexts are dropped from meta in the same statement; only public
 * addresses survive, in the wallet history.
 */
export async function swapKeys({ transfer, agent }) {
	const pending = transfer.rotation?.pending;
	if (!pending?.solana_address) throw typed(500, 'rotation_missing_keys', 'no pending keys to install');
	if (agent.meta?.solana_address === pending.solana_address) return { swapped: false, already: true };

	const meta = { ...(agent.meta || {}) };
	const history = Array.isArray(meta.solana_wallet_history) ? meta.solana_wallet_history : [];
	if (pending.old_solana_address) {
		meta.solana_wallet_history = [
			...history,
			{ address: pending.old_solana_address, replaced_at: new Date().toISOString(), reason: 'marketplace_transfer', swept: true },
		].slice(-10);
	}
	meta.solana_address = pending.solana_address;
	meta.encrypted_solana_secret = pending.encrypted_solana_secret;
	meta.solana_wallet_source = 'marketplace_rotation';
	delete meta.solana_vanity_prefix;
	delete meta.solana_vanity_suffix;

	let walletAddress = agent.wallet_address;
	if (pending.evm_address) {
		meta.encrypted_wallet_key = pending.encrypted_evm_key;
		walletAddress = pending.evm_address;
	} else if (agent.wallet_address && !agent.meta?.encrypted_wallet_key) {
		// An EVM address with no custodial key is the SELLER's own wallet.
		walletAddress = null;
	}

	const [row] = await sql`
		UPDATE agent_identities
		SET meta = ${JSON.stringify(meta)}::jsonb, wallet_address = ${walletAddress}, updated_at = now()
		WHERE id = ${agent.id} AND meta->>'solana_address' IS NOT DISTINCT FROM ${pending.old_solana_address}
		RETURNING id
	`;
	if (!row) throw typed(409, 'wallet_changed', 'the agent wallet changed during settlement; resume to re-sweep');
	await custody(agent.id, transfer.seller_user_id, 'key_rotation', 'marketplace_keys_installed', {
		transfer_id: transfer.id, from: pending.old_solana_address, to: pending.solana_address,
		evm_from: pending.old_evm_address || null, evm_to: pending.evm_address || null,
	});
	return { swapped: true };
}

// ── 5. Revoke the seller's grants and reset policy ───────────────────────────

// Each revocation is its own statement so one table's absence on an older
// database cannot block the rest. Every column here is verified against the
// migrations; a missing TABLE (42P01) is the only error tolerated.
export function revocations(agentId, sellerId) {
	return [
		['wallet_capabilities', () => sql`UPDATE agent_wallet_capabilities SET revoked_at = now(), revoked_reason = 'marketplace_transfer', updated_at = now() WHERE agent_id = ${agentId} AND revoked_at IS NULL RETURNING id`],
		['recovery_guardians', () => sql`UPDATE agent_recovery_guardians SET status = 'removed', updated_at = now() WHERE agent_id = ${agentId} AND status = 'active' RETURNING id`],
		['recovery_requests', () => sql`UPDATE agent_recovery_requests SET status = 'cancelled', updated_at = now() WHERE agent_id = ${agentId} AND status IN ('pending_approvals', 'time_locked', 'ready') RETURNING id`],
		['wallet_intents', () => sql`UPDATE agent_wallet_intents SET enabled = false, updated_at = now() WHERE agent_id = ${agentId} AND enabled RETURNING id`],
		['payout_wallets', () => sql`DELETE FROM agent_payout_wallets WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['paid_services', () => sql`UPDATE agent_paid_services SET archived_at = now(), updated_at = now() WHERE agent_id = ${agentId} AND archived_at IS NULL RETURNING id`],
		['signal_feeds', () => sql`UPDATE signal_feeds SET status = 'paused', updated_at = now() WHERE publisher_agent_id = ${agentId} AND status = 'active' RETURNING id`],
		['trade_delegations', () => sql`UPDATE pump_trade_delegations SET revoked_at = now() WHERE agent_id = ${agentId} AND revoked_at IS NULL RETURNING id`],
		['payment_sessions', () => sql`UPDATE payment_sessions SET status = 'cancelled', updated_at = now() WHERE agent_id = ${agentId} AND status = 'active' RETURNING id`],
		['home_satellites', () => sql`UPDATE home_satellites SET revoked_at = now() WHERE agent_id = ${agentId} AND revoked_at IS NULL RETURNING id`],
		['home_satellite_codes', () => sql`UPDATE home_satellite_codes SET expires_at = now() WHERE agent_id = ${agentId} AND claimed_at IS NULL AND expires_at > now() RETURNING id`],
		['glance_widget_tokens', () => sql`UPDATE glance_widget_tokens SET revoked_at = now() WHERE agent_id = ${agentId} AND revoked_at IS NULL RETURNING id`],
		['x_triggers', () => sql`UPDATE x_triggers SET enabled = false, updated_at = now() WHERE agent_id = ${agentId} AND enabled RETURNING id`],
		['x_scheduled_posts', () => sql`DELETE FROM x_scheduled_posts WHERE agent_id = ${agentId} AND posted_at IS NULL AND published_at IS NULL RETURNING id`],
		['x_pending_reviews', () => sql`UPDATE x_pending_reviews SET status = 'rejected', resolved_at = now() WHERE agent_id = ${agentId} AND status = 'pending' RETURNING id`],
		['x_memory_consents', () => sql`UPDATE x_memory_consents SET revoked_at = now(), revoked_reason = 'marketplace_transfer' WHERE agent_id = ${agentId} AND revoked_at IS NULL RETURNING id`],
		['farcaster_memory_consents', () => sql`UPDATE farcaster_memory_consents SET revoked_at = now() WHERE agent_id = ${agentId} AND revoked_at IS NULL RETURNING id`],
		['sniper_strategies', () => sql`UPDATE agent_sniper_strategies SET enabled = false, kill_switch = true, auto_fund_enabled = false, telegram_chat_id = NULL, updated_at = now() WHERE agent_id = ${agentId} RETURNING id`],
		['launcher_configs', () => sql`UPDATE agent_launcher_configs SET enabled = false, auto_claim_enabled = false, updated_at = now() WHERE agent_id = ${agentId} RETURNING id`],
		['market_maker_configs', () => sql`UPDATE agent_market_maker_configs SET enabled = false, updated_at = now() WHERE agent_id = ${agentId} RETURNING id`],
		['market_maker_policies', () => sql`UPDATE market_maker_policies SET enabled = false, kill_switch = true, status = CASE WHEN status IN ('active', 'idle') THEN 'paused' ELSE status END, updated_at = now() WHERE agent_id = ${agentId} RETURNING id`],
		['orders', () => sql`UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE agent_id = ${agentId} AND status IN ('active', 'partial', 'paused') RETURNING id`],
		['oracle_watch', () => sql`UPDATE oracle_agent_watch SET armed = false, telegram_chat_id = NULL, updated_at = now() WHERE agent_id = ${agentId} RETURNING agent_id`],
		['labor_policies', () => sql`UPDATE agent_labor_policies SET poster_enabled = false, worker_enabled = false, updated_at = now() WHERE agent_id = ${agentId} RETURNING agent_id`],
		['strategy_equips', () => sql`UPDATE agent_strategy_equips SET active = false, updated_at = now() WHERE agent_id = ${agentId} AND active RETURNING id`],
		['mirror_follows', () => sql`UPDATE agent_mirror_follows SET enabled = false, paused_reason = 'marketplace_transfer', updated_at = now() WHERE follower_agent_id = ${agentId} AND enabled RETURNING id`],
		['launcher_queue', () => sql`UPDATE launcher_queue SET enabled = false WHERE agent_id = ${agentId} AND enabled RETURNING agent_id`],
		['autopilot_proposals', () => sql`UPDATE agent_autopilot_proposals SET status = 'dismissed', decided_at = now() WHERE agent_id = ${agentId} AND status = 'pending' RETURNING id`],
		// Signing mode: an external signer is the seller's own wallet and a
		// session key spends from the seller's wallet under their SPL approval,
		// so both go, and with them the encrypted session secret. With no row the
		// agent signs with the platform custodial key, which is now the new one.
		['signers', () => sql`DELETE FROM agent_signers WHERE agent_id = ${agentId} RETURNING agent_id`],
		['external_txs', () => sql`UPDATE pending_external_txs SET status = 'expired', error = 'marketplace_transfer', updated_at = now() WHERE agent_id = ${agentId} AND status = 'prepared' RETURNING id`],
		// API keys the seller minted for this agent: self-funded inference keys
		// and the keys behind account links (CLI, chat gateways).
		['inference_api_keys', () => sql`UPDATE api_keys SET revoked_at = now() WHERE revoked_at IS NULL AND id IN (SELECT api_key_id FROM inference_keys WHERE agent_id = ${agentId} AND user_id = ${sellerId}) RETURNING id`],
		['link_api_keys', () => sql`UPDATE api_keys SET revoked_at = now() WHERE revoked_at IS NULL AND id IN (SELECT api_key_id FROM account_links WHERE agent_id = ${agentId} AND user_id = ${sellerId} AND api_key_id IS NOT NULL) RETURNING id`],
		['account_links', () => sql`UPDATE account_links SET revoked_at = now() WHERE agent_id = ${agentId} AND user_id = ${sellerId} AND revoked_at IS NULL RETURNING id`],
		['gateway_links', () => sql`UPDATE gateway_links SET default_agent_id = NULL WHERE default_agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		// Third-party credentials the seller connected for the agent.
		['x_connection', () => sql`DELETE FROM agent_x_connections WHERE agent_id = ${agentId} RETURNING agent_id`],
		['bounty_venue_accounts', () => sql`DELETE FROM bounty_venue_accounts WHERE agent_id = ${agentId} RETURNING agent_id`],
		['automations', () => sql`UPDATE agent_automations SET enabled = false, last_note = 'paused at marketplace transfer', updated_at = now() WHERE agent_id = ${agentId} AND enabled RETURNING id`],
		['strategy_loop', () => sql`UPDATE agent_loops SET enabled = false, financial_enabled = false, paused_reason = 'marketplace_transfer', paused_at = now(), updated_at = now() WHERE agent_id = ${agentId} AND (enabled OR financial_enabled) RETURNING agent_id`],
	];
}

// Owner copies that must follow the agent to its new owner.
export function ownerMoves(agentId, sellerId, buyerId) {
	return [
		['sniper_strategies', () => sql`UPDATE agent_sniper_strategies SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['sniper_positions', () => sql`UPDATE agent_sniper_positions SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['launcher_configs', () => sql`UPDATE agent_launcher_configs SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['market_maker_configs', () => sql`UPDATE agent_market_maker_configs SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['launched_coins', () => sql`UPDATE agent_launched_coins SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['market_maker_policies', () => sql`UPDATE market_maker_policies SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['orders', () => sql`UPDATE orders SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['oracle_watch', () => sql`UPDATE oracle_agent_watch SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING agent_id`],
		['oracle_actions', () => sql`UPDATE oracle_watch_actions SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['labor_policies', () => sql`UPDATE agent_labor_policies SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING agent_id`],
		['strategy_equips', () => sql`UPDATE agent_strategy_equips SET owner_id = ${buyerId} WHERE agent_id = ${agentId} AND owner_id = ${sellerId} RETURNING id`],
		['strategy_positions', () => sql`UPDATE agent_strategy_positions SET owner_id = ${buyerId} WHERE agent_id = ${agentId} AND owner_id = ${sellerId} RETURNING id`],
		['mirror_follows', () => sql`UPDATE agent_mirror_follows SET owner_user_id = ${buyerId} WHERE follower_agent_id = ${agentId} AND owner_user_id = ${sellerId} RETURNING id`],
		['paid_services', () => sql`UPDATE agent_paid_services SET owner_user_id = ${buyerId} WHERE agent_id = ${agentId} AND owner_user_id = ${sellerId} RETURNING id`],
		['signal_feeds', () => sql`UPDATE signal_feeds SET owner_user_id = ${buyerId} WHERE publisher_agent_id = ${agentId} AND owner_user_id = ${sellerId} RETURNING id`],
		['token_plans', () => sql`UPDATE agent_token_plans SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['launcher_queue', () => sql`UPDATE launcher_queue SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING agent_id`],
		['native_launches', () => sql`UPDATE native_launches SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['pump_agent_mints', () => sql`UPDATE pump_agent_mints SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['wallet_intents', () => sql`UPDATE agent_wallet_intents SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['autopilot_proposals', () => sql`UPDATE agent_autopilot_proposals SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['automations', () => sql`UPDATE agent_automations SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING id`],
		['strategy_loop', () => sql`UPDATE agent_loops SET user_id = ${buyerId} WHERE agent_id = ${agentId} AND user_id = ${sellerId} RETURNING agent_id`],
	];
}

async function runEach(list) {
	const out = {};
	for (const [name, run] of list) {
		try {
			const rows = await run();
			out[name] = rows.length;
		} catch (err) {
			if (err?.code === '42P01') {
				out[name] = 'absent';
				continue;
			}
			throw Object.assign(err, { step_detail: name });
		}
	}
	return out;
}

/** Revoke every seller grant and automation, and reset policy to conservative. */
export async function revokeSellerAccess({ transfer, agent }) {
	const revoked = await runEach(revocations(agent.id, transfer.seller_user_id));

	const meta = { ...(agent.meta || {}) };
	for (const k of SELLER_META_KEYS) delete meta[k];
	meta.spend_limits = { ...CONSERVATIVE_SPEND_LIMITS };
	meta.trade_limits = { ...CONSERVATIVE_TRADE_LIMITS };
	if (meta.payments && typeof meta.payments === 'object') {
		meta.payments = { ...meta.payments, configured: false };
		delete meta.payments.receiver;
	}
	await sql`
		UPDATE agent_identities
		SET meta = ${JSON.stringify(meta)}::jsonb,
		    x_username = NULL, x_seeded_at = NULL,
		    farcaster_fid = NULL, farcaster_fname = NULL, farcaster_seeded_at = NULL,
		    voice_provider = CASE WHEN voice_key_source = 'owner' THEN 'browser' ELSE voice_provider END,
		    voice_id = CASE WHEN voice_key_source = 'owner' THEN NULL ELSE voice_id END,
		    voice_cloned_at = CASE WHEN voice_key_source = 'owner' THEN NULL ELSE voice_cloned_at END,
		    voice_key_source = CASE WHEN voice_key_source = 'owner' THEN NULL ELSE voice_key_source END,
		    updated_at = now()
		WHERE id = ${agent.id}
	`;
	await custody(agent.id, transfer.seller_user_id, 'limit_change', 'marketplace_reset', {
		transfer_id: transfer.id, revoked, spend_limits: CONSERVATIVE_SPEND_LIMITS, trade_limits: CONSERVATIVE_TRADE_LIMITS,
	});
	return revoked;
}

// ── 6. History (when the listing excluded it) ───────────────────────────────

export async function detachHistory({ agent }) {
	return runEach([
		['memories', () => sql`DELETE FROM agent_memories WHERE agent_id = ${agent.id} RETURNING id`],
		['memory_entities', () => sql`DELETE FROM agent_memory_entities WHERE agent_id = ${agent.id} RETURNING id`],
		['memory_pins', () => sql`DELETE FROM agent_memory_pins WHERE agent_id = ${agent.id} RETURNING agent_id`],
		['mood_history', () => sql`DELETE FROM agent_mood_history WHERE agent_id = ${agent.id} RETURNING agent_id`],
		['actions', () => sql`DELETE FROM agent_actions WHERE agent_id = ${agent.id} RETURNING id`],
	]);
}

// ── 7. Reassign ownership ────────────────────────────────────────────────────

/**
 * Make the buyer the owner: the guarded flip, the owner copies, the avatar,
 * and the revenue cutover so the seller keeps what the agent earned for them.
 */
export async function reassignOwner({ transfer, agent }) {
	const { seller_user_id: sellerId, buyer_user_id: buyerId } = transfer;
	// Stamp pre-sale revenue with the seller BEFORE the flip: earnings balances
	// follow the current owner, so this is what keeps them with the seller.
	await sql`UPDATE agent_revenue_events SET owner_user_id = ${sellerId} WHERE agent_id = ${agent.id} AND owner_user_id IS NULL`;
	if (agent.user_id !== buyerId) {
		const [row] = await sql`
			UPDATE agent_identities SET user_id = ${buyerId}, updated_at = now()
			WHERE id = ${agent.id} AND user_id = ${sellerId}
			RETURNING id
		`;
		if (!row) throw typed(409, 'owner_changed', 'the agent changed owner outside this sale');
	}
	if (agent.avatar_id) {
		await sql`UPDATE avatars SET owner_id = ${buyerId} WHERE id = ${agent.avatar_id} AND owner_id = ${sellerId}`;
	}
	const moved = await runEach(ownerMoves(agent.id, sellerId, buyerId));
	await custody(agent.id, buyerId, 'ownership_transfer', 'marketplace_sale', {
		transfer_id: transfer.id, from: sellerId, to: buyerId, moved,
	});
	return moved;
}

// ── 8. Destroy the old key ───────────────────────────────────────────────────

/**
 * Purge the pending-key ciphertext from the transfer row (the agent row holds
 * the only copy now) and prove the installed key is the one that signs.
 */
export async function destroyOldKey({ transfer, agent }) {
	const pending = transfer.rotation?.pending;
	const installed = await recoverSolanaAgentKeypair(agent.meta.encrypted_solana_secret);
	if (installed.publicKey.toBase58() !== pending?.solana_address && installed.publicKey.toBase58() !== transfer.new_wallet_address) {
		throw typed(500, 'rotation_verify_failed', 'the installed key does not derive the new wallet address');
	}
	const record = {
		new_address: installed.publicKey.toBase58(),
		old_address: transfer.old_wallet_address,
		evm_new_address: pending?.evm_address || null,
		evm_old_address: pending?.old_evm_address || null,
		verified_at: new Date().toISOString(),
	};
	await sql`
		UPDATE agent_transfers
		SET rotation = (rotation - 'pending') || jsonb_build_object('keys', ${JSON.stringify(record)}::jsonb), updated_at = now()
		WHERE id = ${transfer.id}
	`;
	await custody(agent.id, transfer.buyer_user_id, 'key_rotation', 'marketplace_old_key_destroyed', { transfer_id: transfer.id, ...record });
	return record;
}

// ── Open positions follow the tokens ─────────────────────────────────────────

/**
 * Open trading positions track tokens in the old wallet. When the balance went
 * to the buyer they now live in the new wallet; when it went to the seller they
 * are gone from the agent, so the positions close.
 */
export async function repointPositions({ transfer, agent, includeBalance }) {
	const oldAddress = transfer.rotation?.pending?.old_solana_address || transfer.old_wallet_address;
	const newAddress = transfer.rotation?.pending?.solana_address || transfer.new_wallet_address;
	if (includeBalance) {
		return runEach([
			['sniper_positions', () => sql`UPDATE agent_sniper_positions SET wallet = ${newAddress} WHERE agent_id = ${agent.id} AND wallet = ${oldAddress} AND status IN ('opening', 'open', 'closing') RETURNING id`],
		]);
	}
	return runEach([
		['sniper_positions', () => sql`UPDATE agent_sniper_positions SET status = 'closed', exit_reason = 'manual', error = 'balance swept to the seller at marketplace transfer', closed_at = now() WHERE agent_id = ${agent.id} AND status IN ('opening', 'open', 'closing') RETURNING id`],
		['strategy_positions', () => sql`UPDATE agent_strategy_positions SET status = 'closed', error = 'balance swept to the seller at marketplace transfer', closed_at = now() WHERE agent_id = ${agent.id} AND status IN ('open', 'closing') RETURNING id`],
	]);
}
