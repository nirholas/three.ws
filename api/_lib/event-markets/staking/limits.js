// Stake limit checks, evaluated server-side BEFORE a transaction is built so the
// user sees a plain refusal instead of a failed on-chain call. The program
// enforces the per-account and per-pool caps again on-chain; the daily cap is
// server-only. All amounts are BigInt base units.

import { TOKENS } from './config.js';

export class StakeRefusal extends Error {
	constructor(code, message, detail = null) {
		super(message);
		this.code = code;
		this.detail = detail;
	}
}

const fmt = (v, decimals) => {
	const s = v.toString().padStart(decimals + 1, '0');
	const whole = s.slice(0, -decimals) || '0';
	const frac = s.slice(-decimals).replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : whole;
};
export const formatAmount = fmt;

/**
 * @param {{tokenKey:string, decimals:number, minStake:bigint, maxStake:bigint, maxPool:bigint, totalStaked:bigint}} pool
 * @param {{amount:bigint, position:bigint, accountDay:bigint}} s  position = this wallet's current stake; accountDay = the account's stake over the last 24h
 */
export function checkStakeLimits(pool, { amount, position, accountDay }) {
	const sym = TOKENS[pool.tokenKey].symbol;
	const show = (v) => `${fmt(v, pool.decimals)} ${sym}`;
	if (amount <= 0n) throw new StakeRefusal('invalid_amount', 'Enter an amount greater than zero.');
	if (amount < pool.minStake) throw new StakeRefusal('below_minimum', `The minimum stake on this market is ${show(pool.minStake)}.`, { min: pool.minStake.toString() });
	if (position + amount > pool.maxStake) {
		throw new StakeRefusal('over_account_cap', `One account can stake at most ${show(pool.maxStake)} on a market. You can add ${show(pool.maxStake - position)} more.`, { room: (pool.maxStake - position).toString() });
	}
	if (pool.totalStaked + amount > pool.maxPool) {
		throw new StakeRefusal('over_pool_cap', `This market's pool is capped at ${show(pool.maxPool)}. ${show(pool.maxPool - pool.totalStaked)} of room is left.`, { room: (pool.maxPool - pool.totalStaked).toString() });
	}
	const daily = TOKENS[pool.tokenKey].dailyCap;
	if (accountDay + amount > daily) {
		throw new StakeRefusal('over_daily_cap', `Your daily staking limit is ${show(daily)}. You have ${show(daily - accountDay)} left in the last 24 hours.`, { room: (daily - accountDay).toString() });
	}
}
