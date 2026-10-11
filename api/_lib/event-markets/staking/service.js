// Orchestration for staked Event Markets: what a market page needs to render the
// panel, the stake preview, and the unsigned transactions. Route handlers and the
// admin CLI both call in here. Nothing in this module signs or sends a transaction.

import { PublicKey } from '@solana/web3.js';
import { evaluateGate, GATE_MESSAGES } from './gate.js';
import { checkStakeLimits, formatAmount, StakeRefusal } from './limits.js';
import { previewStake, poolShares } from './math.js';
import { TOKENS, TERMS_VERSION, stakingConfig } from './config.js';
import { buildPayoutTx, buildStakeTx, readPool, readPosition } from './chain.js';
import { accountExposure, getAttestation, getPoolByMarket, getSettings, saveAttestation } from './store.js';
import { clientCountry } from '../../client-geo.js';

const str = (v) => (v == null ? null : v.toString());

function requireWallet(wallet) {
	try {
		return new PublicKey(wallet).toBase58();
	} catch {
		throw new StakeRefusal('invalid_wallet', 'wallet must be a Solana address.');
	}
}

function outcomeIndexFor(pool, outcomeId) {
	const i = pool.outcomeIds.indexOf(outcomeId);
	if (i < 0) throw new StakeRefusal('invalid_outcome', 'outcome_id is not an outcome of this market.');
	return i;
}

function parseAmount(raw) {
	if (typeof raw !== 'string' || !/^\d{1,30}$/.test(raw)) throw new StakeRefusal('invalid_amount', 'amount must be a whole number of base units, as a string.');
	return BigInt(raw);
}

async function gateFor(req, principal) {
	const [attestation, settings] = await Promise.all([
		principal?.userId ? getAttestation(principal.userId) : null,
		getSettings(),
	]);
	const gate = evaluateGate({ req, attestation, stakesEnabled: settings.stakesEnabled });
	return { ...gate, message: gate.reason ? GATE_MESSAGES[gate.reason] : null, signed_in: Boolean(principal?.userId) };
}

/** Public view for the market page. Staked data appears only when the gate is open. */
export async function stakingView(req, marketId, principal, wallet = null) {
	const pool = await getPoolByMarket(marketId);
	if (!pool) return { offered: false };
	const gate = await gateFor(req, principal);
	// A viewer who is gated out of NEW stakes still sees their own claim/refund state.
	const chain = await readPool(pool.poolIdHex);
	if (!chain) return { offered: false };
	const token = TOKENS[pool.tokenKey];
	const base = {
		offered: true,
		gate,
		cluster: pool.cluster,
		token: { key: pool.tokenKey, symbol: token.symbol, decimals: pool.decimals, mint: pool.mint },
		status: chain.statusName,
		terms_version: TERMS_VERSION,
		limits: { min: str(pool.minStake), max_stake: str(pool.maxStake), max_pool: str(pool.maxPool), daily_cap: str(token.dailyCap) },
		fee: { fee_bps: chain.feeBps, buyback_share_bps: chain.buybackShareBps },
		lock_at: pool.lockAt,
		void_after: pool.voidAfter,
		total_staked: str(chain.totalStaked),
		outcomes: pool.outcomeIds.map((id, i) => ({ outcome_id: id, staked: str(chain.totals[i]), share: poolShares(chain.totals)[i] })),
		winning_outcome_id: chain.statusName === 'resolved' ? pool.outcomeIds[chain.winningOutcome] : null,
	};
	if (wallet) {
		const position = await readPosition(pool.poolIdHex, requireWallet(wallet));
		if (position) {
			const idx = position.outcome;
			base.position = {
				outcome_id: pool.outcomeIds[idx], amount: str(position.amount),
				claimable: chain.statusName === 'resolved' && idx === chain.winningOutcome,
				refundable: chain.statusName === 'void',
				payout: chain.statusName === 'resolved' && idx === chain.winningOutcome
					? str(previewStake({ totals: chain.totals.map((t, j) => (j === idx ? t - position.amount : t)), feeBps: chain.feeBps, buybackShareBps: chain.buybackShareBps }, idx, position.amount).payout)
					: null,
			};
		}
	}
	return base;
}

/** Build a stake: gate, limits, preview, and the unsigned transaction. */
export async function prepareStake(req, marketId, principal, { wallet, outcomeId, amount }) {
	const pool = await getPoolByMarket(marketId);
	if (!pool) throw new StakeRefusal('not_offered', 'This market has no staked version.');
	const gate = await gateFor(req, principal);
	if (!gate.available) throw new StakeRefusal(gate.reason, gate.message, { gate });
	const w = requireWallet(wallet);
	const outcome = outcomeIndexFor(pool, outcomeId);
	const amt = parseAmount(amount);
	const chain = await readPool(pool.poolIdHex);
	if (!chain || chain.statusName !== 'open') throw new StakeRefusal('not_open', 'This market is no longer taking stakes.');
	if (Date.now() >= Number(chain.lockTs) * 1000) throw new StakeRefusal('locked', 'This market is locked.');
	const position = await readPosition(pool.poolIdHex, w);
	if (position && position.outcome !== outcome) throw new StakeRefusal('outcome_mismatch', 'This wallet already backs a different outcome. A position can back only one.');
	const exposure = await accountExposure(principal.userId, marketId);
	checkStakeLimits({ ...pool, totalStaked: chain.totalStaked }, { amount: amt, position: position?.amount ?? 0n, accountDay: exposure.day });

	const p = previewStake({ totals: chain.totals, feeBps: chain.feeBps, buybackShareBps: chain.buybackShareBps }, outcome, amt, position?.amount ?? 0n);
	const built = await buildStakeTx(pool, { wallet: w, outcome, amount: amt });
	return {
		...built,
		confirm: {
			chain: 'solana', cluster: pool.cluster, token: TOKENS[pool.tokenKey].symbol, mint: pool.mint,
			pool_address: pool.poolAddress, wallet: w, outcome_id: outcomeId,
			amount: str(amt), amount_display: formatAmount(amt, pool.decimals),
		},
		preview: {
			stake: str(p.stake), pool_after: str(p.total), fee_if_resolved: str(p.fee),
			payout_if_right: str(p.payout), profit_if_right: str(p.profit), multiple_if_right: p.multiple,
			refunded_if_wins: p.void_if_wins,
			note: p.void_if_wins ? 'Nobody else is on the other side yet. If it stays that way you are refunded in full, with no fee.' : null,
		},
	};
}

export async function preparePayout(marketId, { wallet, kind }) {
	const pool = await getPoolByMarket(marketId);
	if (!pool) throw new StakeRefusal('not_offered', 'This market has no staked version.');
	const w = requireWallet(wallet);
	const chain = await readPool(pool.poolIdHex);
	if (!chain) throw new StakeRefusal('not_offered', 'This market has no staked version.');
	const position = await readPosition(pool.poolIdHex, w);
	if (!position) throw new StakeRefusal('no_position', 'This wallet has nothing to collect on this market. It may already have been paid.');
	if (kind === 'claim') {
		if (chain.statusName !== 'resolved') throw new StakeRefusal('not_resolved', 'This market has not been resolved yet.');
		if (position.outcome !== chain.winningOutcome) throw new StakeRefusal('not_winner', 'This wallet did not back the winning outcome.');
	} else if (chain.statusName !== 'void') {
		throw new StakeRefusal('not_void', 'This market was not voided, so there is nothing to refund.');
	}
	const built = await buildPayoutTx(pool, { wallet: w, kind });
	return { ...built, confirm: { chain: 'solana', cluster: pool.cluster, token: TOKENS[pool.tokenKey].symbol, mint: pool.mint, wallet: w, kind, pool_address: pool.poolAddress } };
}

export async function attest(req, principal, { confirmedAge, confirmedRegion }) {
	const cfg = stakingConfig();
	const country = clientCountry(req);
	if (!country) throw new StakeRefusal('region_unknown', GATE_MESSAGES.region_unknown);
	if (cfg.blockedCountries.has(country)) throw new StakeRefusal('region_blocked', GATE_MESSAGES.region_blocked);
	if (confirmedAge !== true || confirmedRegion !== true) {
		throw new StakeRefusal('attestation_incomplete', `Confirm you are at least ${cfg.minAge} and that staking is lawful where you live.`);
	}
	await saveAttestation(principal.userId, { minAge: cfg.minAge, country, termsVersion: TERMS_VERSION });
	return gateFor(req, principal);
}
