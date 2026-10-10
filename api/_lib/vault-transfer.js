// @ts-check
// Back-an-Agent Vaults — real deposit / redeem / fee-claim money movement.
//
// Deposits reuse the platform's proven, guarded agent→agent USDC settlement
// (transferUsdcGuarded): a backer funds the vault FROM one of their own agents'
// custodial wallets, so the deposit is spend-limited, kill-switch-aware, idempotent
// and audited on the backer's side exactly like every other outbound payment. The
// shares are minted only AFTER the transfer settles on-chain, priced against the
// NAV measured immediately before the deposit landed — so a backer never gets
// shares for funds that didn't arrive, and an existing holder is never diluted.
//
// Redemptions pay out from the vault's dedicated wallet at real NAV, charging the
// owner's performance fee only on the backer's realized gain. When the vault can't
// pay the full claim instantly (capital is live in open positions) we redeem only
// what the liquid USDC covers and report the queued remainder honestly — never a
// fake instant number.

import { PublicKey } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync, createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { solanaConnection } from './agent-pumpfun.js';
import { submitProtected } from './execution-engine.js';
import { transferUsdcGuarded } from './agent-usdc-transfer.js';
import { logAudit } from './audit.js';
import { explorerTxUrl } from './avatar-wallet.js';
import {
	getVaultWithSecret, getBacker, getOpenPositions,
	recordVaultEvent, applyBackerDelta, applyVaultShareDelta, applyAccruedFee,
	reserveBackerShares, releaseBackerShares, reserveAccruedFee,
} from './vault-store.js';
import { recoverVaultKeypair, computeVaultNav, readVaultUsdcAtomics } from './vault-wallet.js';
import { USDC_MINT_BY_NETWORK, USDC_DECIMALS } from './vault-jupiter.js';
import {
	toBig, sharesForDeposit, settleRedemption, sharesRedeemableNow,
	depositExceedsCap, sharePriceE6, nextPeak,
} from './vault-accounting.js';

function netOf(network) {
	return network === 'devnet' ? 'devnet' : 'mainnet';
}

/** Float USDC for the guarded transfer API (which meters in USD = USDC). */
function atomicsToUsdcFloat(atomics) {
	return Number(toBig(atomics)) / 10 ** USDC_DECIMALS;
}

/**
 * Pay `atomics` USDC out of the vault's dedicated wallet to `toAddress`. Used by
 * redemptions and owner fee claims. Recovers the vault keypair (audit-logged),
 * builds an idempotent USDC transfer, and confirms through the shared MEV-aware
 * engine. Returns { signature } or throws a structured error.
 */
async function payoutUsdc({ vault, toAddress, atomics, userId, reason }) {
	const network = netOf(vault.network);
	const amount = toBig(atomics);
	if (amount <= 0n) throw Object.assign(new Error('zero payout'), { code: 'zero_amount' });

	const conn = solanaConnection(network);
	const mintPk = new PublicKey(USDC_MINT_BY_NETWORK[network]);
	let toPk;
	try { toPk = new PublicKey(toAddress); } catch { throw Object.assign(new Error('bad recipient'), { code: 'bad_address' }); }

	const keypair = await recoverVaultKeypair(vault.encrypted_secret, { vaultId: vault.id, userId, reason, meta: { to: toAddress, atomics: String(amount) } });
	const fromAta = getAssociatedTokenAddressSync(mintPk, keypair.publicKey, false, TOKEN_PROGRAM_ID);
	const toAta = getAssociatedTokenAddressSync(mintPk, toPk, false, TOKEN_PROGRAM_ID);
	const instructions = [
		createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, toAta, toPk, mintPk, TOKEN_PROGRAM_ID),
		createTransferCheckedInstruction(fromAta, mintPk, toAta, keypair.publicKey, amount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
	];
	const result = await submitProtected({
		network, connection: conn, payer: keypair, instructions,
		opts: { tipMode: 'off', confirmTimeoutMs: 45_000 },
	});
	return { signature: result.signature };
}

/**
 * Deposit `usdcAtomics` from the backer's chosen agent wallet into the vault and
 * mint shares. `backerAgent` is the owned agent row (with meta) funding it.
 *
 * @returns {Promise<object>} result envelope
 */
export async function depositToVault({ vault, backerAgent, userId, usdcAtomics, idempotencyKey }) {
	const network = netOf(vault.network);
	const amount = toBig(usdcAtomics);
	if (amount <= 0n) return { status: 'failed', code: 'zero_amount', message: 'deposit must be positive' };
	if (vault.status !== 'open') return { status: 'blocked', code: 'vault_not_open', message: `vault is ${vault.status} and not accepting deposits` };

	// Per-backer cap (against the backer's lifetime contribution so far).
	const existing = await getBacker(vault.id, userId);
	const contributed = existing ? toBig(existing.deposited_atomics) : 0n;
	if (depositExceedsCap(contributed, amount, vault.per_backer_cap_atomics)) {
		return { status: 'blocked', code: 'backer_cap', message: 'this deposit would exceed the per-backer cap for this vault', detail: { cap_atomics: String(vault.per_backer_cap_atomics), contributed_atomics: String(contributed) } };
	}

	// Real, guarded USDC transfer from the backer's agent wallet → vault wallet.
	const transfer = await transferUsdcGuarded({
		fromAgentId: backerAgent.id, fromUserId: userId, fromMeta: backerAgent.meta || {},
		toAddress: vault.vault_address, usdc: atomicsToUsdcFloat(amount),
		network, category: 'vault_back', idempotencyKey, destinationTrust: 'system',
		rowMeta: { vault_id: vault.id, agent_id: vault.agent_id },
	});
	if (transfer.status === 'blocked') return { status: 'blocked', code: transfer.code, message: transfer.message || 'deposit blocked by the funding wallet spend policy' };
	if (transfer.status === 'failed') return { status: 'failed', code: transfer.code, message: 'the deposit transfer did not settle — no shares were minted' };
	const signature = transfer.signature;

	// Mint shares exactly once for this on-chain settlement (idempotent on signature).
	// Price against the NAV measured BEFORE this deposit: current NAV minus the
	// amount that just landed in the wallet.
	const positions = await getOpenPositions(vault.id);
	const nav = await computeVaultNav(vault, positions);
	const navBefore = nav.navAtomics > amount ? nav.navAtomics - amount : 0n;
	const minted = sharesForDeposit(amount, navBefore, vault.total_shares);

	const eventId = await recordVaultEvent({
		vaultId: vault.id, type: 'deposit', userId, backerAgentId: backerAgent.id,
		sharesDelta: String(minted), atomicsDelta: String(amount),
		navAtomics: String(nav.navAtomics), sharePriceE6: String(sharePriceE6(navBefore, vault.total_shares)),
		signature, status: 'ok', reason: 'deposit', idempotencyKey: `deposit:${signature}`,
		meta: { nav_before_atomics: String(navBefore), minted_shares: String(minted) },
	});
	if (eventId == null) {
		// A replay of an already-credited deposit — return the existing position, no double-mint.
		const pos = await getBacker(vault.id, userId);
		return { status: 'replayed', signature, shares: pos ? String(pos.shares) : '0' };
	}

	await applyBackerDelta({
		vaultId: vault.id, userId, backerAgentId: backerAgent.id,
		sharesDelta: minted, basisDelta: amount, depositedDelta: amount,
	});
	// Ratchet the share-price peak (a deposit mints at the current price, so this
	// is a no-op on price — it just seeds the peak on the very first deposit).
	const priceAfter = sharePriceE6(nav.navAtomics, toBig(vault.total_shares) + minted);
	const updated = await applyVaultShareDelta(vault.id, minted, nextPeak(vault.peak_share_price_e6, priceAfter));

	logAudit({ userId, action: 'vault.deposit', resourceId: vault.id, meta: { agent_id: vault.agent_id, usdc_atomics: String(amount), shares: String(minted), signature } });

	const pos = await getBacker(vault.id, userId);
	return {
		status: 'ok', signature, explorer: explorerTxUrl(signature, network),
		shares_minted: String(minted),
		share_price_e6: String(sharePriceE6(navBefore, vault.total_shares)),
		nav_atomics: String(nav.navAtomics),
		total_shares: updated ? String(updated.total_shares) : String(toBig(vault.total_shares) + minted),
		position: pos ? { shares: String(pos.shares), cost_basis_atomics: String(pos.cost_basis_atomics) } : null,
		repriced: !nav.priced,
	};
}

/**
 * Redeem `shares` ('max' for all) from the caller's position. Pays net of the
 * performance fee at real NAV; partials honestly when liquid USDC is short.
 */
export async function redeemFromVault({ vaultId, userId, shares, idempotencyKey }) {
	const vault = await getVaultWithSecret(vaultId);
	if (!vault) return { status: 'failed', code: 'not_found', message: 'vault not found' };
	const network = netOf(vault.network);

	const backer = await getBacker(vault.id, userId);
	if (!backer || toBig(backer.shares) <= 0n) return { status: 'failed', code: 'no_position', message: 'you have no shares in this vault' };
	const backerShares = toBig(backer.shares);
	const want = (shares === 'max' || shares == null) ? backerShares : toBig(shares);
	if (want <= 0n) return { status: 'failed', code: 'zero_amount', message: 'redeem amount must be positive' };
	if (want > backerShares) return { status: 'failed', code: 'insufficient_shares', message: 'you do not hold that many shares', detail: { shares: String(backerShares) } };

	// NAV must be fully priced to settle fairly when positions are open.
	const positions = await getOpenPositions(vault.id);
	const nav = await computeVaultNav(vault, positions);
	if (!nav.priced && positions.length > 0) {
		return { status: 'failed', code: 'repricing', message: 'the vault holds positions that cannot be priced right now — try again in a moment' };
	}

	// Honest partial: redeem only what liquid USDC can pay this instant.
	const free = nav.freeAtomics;
	const redeemNow = sharesRedeemableNow({ requestedShares: want, navAtomics: nav.navAtomics, totalShares: vault.total_shares, freeAtomics: free });
	if (redeemNow <= 0n) {
		return { status: 'queued', code: 'insufficient_liquidity', message: 'the vault has no liquid USDC right now — capital is deployed in open positions. Try again after the agent harvests, or the owner can free liquidity.', detail: { free_atomics: String(free), requested_shares: String(want) } };
	}

	const settle = settleRedemption({
		shares: redeemNow, backerShares, costBasisAtomics: backer.cost_basis_atomics,
		navAtomics: nav.navAtomics, totalShares: vault.total_shares, feeBps: vault.performance_fee_bps,
	});
	if (settle.netPayout <= 0n) return { status: 'failed', code: 'zero_payout', message: 'this redemption nets zero — nothing to pay out' };

	// Pay the net to the backer's agent wallet (the wallet they funded with).
	const [recipient] = await import('./db.js').then(({ sql }) => sql`
		SELECT meta->>'solana_address' AS addr FROM agent_identities WHERE id = ${backer.backer_agent_id} AND deleted_at IS NULL LIMIT 1
	`);
	const toAddress = recipient?.addr;
	if (!toAddress) return { status: 'failed', code: 'no_recipient', message: 'the funding wallet for this position is no longer available' };

	// Burn the shares BEFORE paying. The position read above is a plain SELECT,
	// so without this N concurrent redeems (each with its own idempotency key)
	// all saw the same shares and each paid the full net out of the pool.
	const burned = await reserveBackerShares(vault.id, userId, redeemNow);
	if (!burned) return { status: 'failed', code: 'in_flight', message: 'another redemption already claimed these shares; check the ledger before retrying' };

	// Claim a pending event keyed by the caller's idempotency key BEFORE paying —
	// a retry/double-submit with the same key collides here and never pays twice.
	const claimId = await recordVaultEvent({
		vaultId: vault.id, type: 'redeem', userId, backerAgentId: backer.backer_agent_id,
		sharesDelta: String(-redeemNow), atomicsDelta: String(-settle.netPayout),
		navAtomics: String(nav.navAtomics), sharePriceE6: String(sharePriceE6(nav.navAtomics, vault.total_shares)),
		status: 'pending', reason: 'redeem', idempotencyKey: idempotencyKey || `redeem:${vault.id}:${userId}:${redeemNow}`,
		meta: { gross_atomics: String(settle.grossPayout), fee_atomics: String(settle.fee), net_atomics: String(settle.netPayout), gain_atomics: String(settle.gain), shares_burned: String(redeemNow) },
	});
	if (claimId == null) {
		await releaseBackerShares(vault.id, userId, redeemNow);
		return { status: 'failed', code: 'in_flight', message: 'a redemption with this id is already in progress; check the ledger before retrying' };
	}

	let signature;
	try {
		({ signature } = await payoutUsdc({ vault, toAddress, atomics: settle.netPayout, userId, reason: 'vault_redeem' }));
	} catch (e) {
		const { updateVaultEvent } = await import('./vault-store.js');
		await updateVaultEvent(claimId, { status: 'failed', meta: { error: e?.code || 'payout_failed' } });
		await releaseBackerShares(vault.id, userId, redeemNow);
		return { status: 'failed', code: e?.code || 'payout_failed', message: 'the redemption payout could not be confirmed — your shares were not burned' };
	}

	// Finalize the claimed event with the on-chain signature, then settle balances.
	const { updateVaultEvent } = await import('./vault-store.js');
	await updateVaultEvent(claimId, { status: 'ok', signature });

	// The shares were already burned by reserveBackerShares; settle the rest.
	await applyBackerDelta({
		vaultId: vault.id, userId, backerAgentId: backer.backer_agent_id,
		sharesDelta: 0n, basisDelta: -settle.costPortion,
		redeemedDelta: settle.netPayout, realizedGainDelta: settle.gain, feesPaidDelta: settle.fee,
	});
	await applyVaultShareDelta(vault.id, -redeemNow);
	if (settle.fee > 0n) {
		await applyAccruedFee(vault.id, settle.fee);
		await recordVaultEvent({ vaultId: vault.id, type: 'fee', userId: vault.owner_user_id, atomicsDelta: String(settle.fee), reason: 'performance_fee', meta: { from_user: userId, gain_atomics: String(settle.gain) } });
	}
	logAudit({ userId, action: 'vault.redeem', resourceId: vault.id, meta: { shares: String(redeemNow), net_atomics: String(settle.netPayout), fee_atomics: String(settle.fee), signature } });

	const queuedShares = want - redeemNow;
	return {
		status: queuedShares > 0n ? 'partial' : 'ok',
		signature, explorer: explorerTxUrl(signature, network),
		shares_redeemed: String(redeemNow),
		gross_atomics: String(settle.grossPayout),
		fee_atomics: String(settle.fee),
		net_atomics: String(settle.netPayout),
		gain_atomics: String(settle.gain),
		queued_shares: String(queuedShares),
		...(queuedShares > 0n ? { note: 'partial redemption — the rest is queued until the vault has liquid USDC' } : {}),
	};
}

/**
 * Owner claims accrued performance fees to one of their agent wallets.
 */
export async function claimVaultFees({ vaultId, ownerUserId, toAgent, idempotencyKey }) {
	const vault = await getVaultWithSecret(vaultId);
	if (!vault) return { status: 'failed', code: 'not_found', message: 'vault not found' };
	if (vault.owner_user_id !== ownerUserId) return { status: 'failed', code: 'forbidden', message: 'only the vault owner can claim fees' };
	const accrued = toBig(vault.accrued_fee_atomics);
	if (accrued <= 0n) return { status: 'failed', code: 'no_fees', message: 'no fees accrued yet' };

	const toAddress = toAgent?.meta?.solana_address;
	if (!toAddress) return { status: 'failed', code: 'no_recipient', message: 'choose an agent wallet with a Solana address to receive the fees' };

	// Cap the claim at the vault's liquid USDC (fees may be partly tied up in positions).
	const free = await readVaultUsdcAtomics(vault.vault_address, netOf(vault.network));
	const claimable = accrued < free ? accrued : free;
	if (claimable <= 0n) return { status: 'queued', code: 'insufficient_liquidity', message: 'fees are accrued but the vault has no liquid USDC to pay them right now', detail: { accrued_atomics: String(accrued) } };

	// Take the fee out of the accrual BEFORE paying, then claim the ledger row.
	// Paying first let N concurrent claims each pay the full accrual out of the
	// pooled USDC, i.e. out of backers' principal.
	if ((await reserveAccruedFee(vault.id, claimable)) == null) {
		return { status: 'failed', code: 'in_flight', message: 'another fee claim already took these fees; check the ledger before retrying' };
	}
	const eventId = await recordVaultEvent({
		vaultId: vault.id, type: 'fee_claim', userId: ownerUserId, backerAgentId: toAgent.id,
		atomicsDelta: String(-claimable), status: 'pending', reason: 'fee_claim',
		idempotencyKey: idempotencyKey || null, meta: { to: toAddress, claimed_atomics: String(claimable) },
	});
	if (eventId == null) {
		await applyAccruedFee(vault.id, claimable);
		return { status: 'replayed', code: 'in_flight', message: 'a fee claim with this id was already recorded' };
	}

	const { updateVaultEvent } = await import('./vault-store.js');
	let signature;
	try {
		({ signature } = await payoutUsdc({ vault, toAddress, atomics: claimable, userId: ownerUserId, reason: 'vault_fee_claim' }));
	} catch (e) {
		await updateVaultEvent(eventId, { status: 'failed', meta: { error: e?.code || 'payout_failed' } });
		await applyAccruedFee(vault.id, claimable);
		return { status: 'failed', code: e?.code || 'payout_failed', message: 'the fee claim could not be confirmed' };
	}
	await updateVaultEvent(eventId, { status: 'ok', signature });
	logAudit({ userId: ownerUserId, action: 'vault.fee_claim', resourceId: vault.id, meta: { claimed_atomics: String(claimable), signature } });

	return {
		status: 'ok', signature, explorer: explorerTxUrl(signature, netOf(vault.network)),
		claimed_atomics: String(claimable),
		remaining_accrued_atomics: String(accrued - claimable),
		...(claimable < accrued ? { note: 'partial claim — the rest stays accrued until more USDC is liquid' } : {}),
	};
}
