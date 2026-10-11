// Per-chain spend guards for the EVM leg.
//
// The owner sets one spend policy per agent (meta.spend_limits: per-transaction
// and rolling-24h USD ceilings, and the freeze switch). The EVM leg applies the
// same numbers, metered separately on each chain: a Base spend counts against
// Base's 24h total, never against Solana's, and a Solana spend never against
// Base's. The Solana guard module (api/_lib/agent-trade-guards.js) is read,
// never changed.
//
// Destinations come from the destination whitelist table (api/_lib/destination-whitelist.js),
// one EVM list for every EVM chain (an agent has one EVM address across them).
// A transfer out of the EVM leg is refused unless its destination is an ACTIVE
// entry, so a newly added address serves its cooldown first; an empty list
// refuses every transfer. Per-destination caps on the entry apply on top.

import { getAddress, isAddress } from 'viem';

import { sql } from '../db.js';
import { getSpendLimits } from '../agent-trade-guards.js';
import { activeAddresses, evaluateDestination, replaceList } from '../destination-whitelist.js';
import { EvmLegError } from './chains.js';

export const MAX_EVM_ALLOWLIST = 25;

/** Checksummed address, or null when the input is not an EVM address. */
export function normalizeEvmAddress(value) {
	const s = typeof value === 'string' ? value.trim() : '';
	if (!isAddress(s, { strict: false })) return null;
	return getAddress(s);
}

/** The effective EVM policy for an agent's meta. Pure. */
export function getEvmSpendLimits(meta) {
	const base = getSpendLimits(meta);
	const raw = Array.isArray(meta?.evm_spend_limits?.withdraw_allowlist) ? meta.evm_spend_limits.withdraw_allowlist : [];
	const seen = new Set();
	const allowlist = [];
	for (const a of raw) {
		const n = normalizeEvmAddress(a);
		if (!n || seen.has(n)) continue;
		seen.add(n);
		allowlist.push(n);
		if (allowlist.length >= MAX_EVM_ALLOWLIST) break;
	}
	return {
		withdraw_allowlist: allowlist,
		per_tx_usd: base.per_tx_usd,
		daily_usd: base.daily_usd,
		frozen: base.frozen,
		updated_at: typeof meta?.evm_spend_limits?.updated_at === 'string' ? meta.evm_spend_limits.updated_at : null,
	};
}

/**
 * Pure decision for one spend. Returns null when allowed, or { code, message, detail }.
 * @param {{ limits: ReturnType<typeof getEvmSpendLimits>, usdValue: number|null, spentTodayUsd: number, destination?: string|null, category: string, chainName: string }} o
 */
export function checkEvmSpend({ limits, usdValue, spentTodayUsd, destination = null, category, chainName }) {
	if (limits.frozen) {
		return { code: 'wallet_frozen', message: 'This agent wallet is frozen. Unfreeze it under Limits & Safety before it can spend.', detail: {} };
	}
	if (category === 'transfer' || category === 'withdraw') {
		const dest = normalizeEvmAddress(destination);
		if (!dest || !limits.withdraw_allowlist.includes(dest)) {
			return {
				code: 'destination_not_allowlisted',
				message: 'That destination is not on this agent\'s EVM allowlist. Add it first (add_to_whitelist with chain set, or the wallet page), then transfer.',
				detail: { destination: dest || destination || null, allowlist_size: limits.withdraw_allowlist.length },
			};
		}
	}
	if (usdValue != null && limits.per_tx_usd != null && usdValue > limits.per_tx_usd) {
		return {
			code: 'per_tx_limit',
			message: `This spend of $${usdValue.toFixed(2)} is over the $${limits.per_tx_usd} per-transaction ceiling.`,
			detail: { usd: usdValue, per_tx_usd: limits.per_tx_usd },
		};
	}
	if (usdValue != null && limits.daily_usd != null && spentTodayUsd + usdValue > limits.daily_usd) {
		return {
			code: 'daily_limit',
			message: `This spend would bring today's ${chainName} total to $${(spentTodayUsd + usdValue).toFixed(2)}, over the $${limits.daily_usd} daily ceiling.`,
			detail: { usd: usdValue, spent_today_usd: spentTodayUsd, daily_usd: limits.daily_usd },
		};
	}
	if (usdValue == null && (limits.per_tx_usd != null || limits.daily_usd != null)) {
		return {
			code: 'unpriced_spend',
			message: 'This spend could not be priced in USD right now, and the agent has a USD spend ceiling, so it is refused rather than let through unmetered.',
			detail: {},
		};
	}
	return null;
}

/** USD spent on one chain in the trailing 24 hours. */
export async function getDailyEvmSpendUsd(agentId, chainKey) {
	const [row] = await sql`
		SELECT COALESCE(SUM(usd), 0)::float8 AS usd
		FROM agent_custody_events
		WHERE agent_id = ${agentId}
		  AND chain = ${chainKey}
		  AND event_type = 'spend'
		  AND status IN ('ok', 'pending', 'confirmed')
		  AND usd IS NOT NULL
		  AND created_at > now() - interval '24 hours'
	`;
	return Number(row?.usd || 0);
}

/**
 * Throw an EvmLegError when a spend breaks the agent's policy on this chain.
 * @param {{ agentId: string, meta: object, chain: { key: string, name: string }, usdValue: number|null, destination?: string|null, category: string }} o
 */
export async function enforceEvmSpend({ agentId, meta, chain, usdValue, destination = null, category }) {
	const limits = getEvmSpendLimits(meta);
	const outbound = category === 'transfer' || category === 'withdraw';
	if (outbound) limits.withdraw_allowlist = (await activeAddresses(agentId, 'evm')).map(normalizeEvmAddress).filter(Boolean);
	const spentTodayUsd = await getDailyEvmSpendUsd(agentId, chain.key);
	const blocked = checkEvmSpend({ limits, usdValue, spentTodayUsd, destination, category, chainName: chain.name });
	if (blocked) throw new EvmLegError(blocked.code, blocked.message, blocked.code === 'wallet_frozen' ? 423 : 422, blocked.detail);
	if (outbound) await enforceEntryCaps({ agentId, destination, category, usdValue });
	return { limits, spentTodayUsd };
}

async function enforceEntryCaps({ agentId, destination, category, usdValue }) {
	const decision = await evaluateDestination({ agentId, destination, category, chain: 'evm' });
	const entry = decision.state === 'active' ? decision.entry : null;
	if (!entry || usdValue == null) return;
	if (entry.per_tx_cap_usd != null && usdValue > entry.per_tx_cap_usd) {
		throw new EvmLegError('destination_cap_exceeded', `That send is $${usdValue.toFixed(2)}, over the $${entry.per_tx_cap_usd.toFixed(2)} limit set for this destination.`, 422, { cap_usd: entry.per_tx_cap_usd, usd: usdValue });
	}
}

/**
 * Replace the EVM allowlist (owner browser session only). Addresses new to the
 * list serve the cooldown and need a step-up grant; removals are instant.
 */
export async function setEvmAllowlist(agentId, actor, list, { req = null, grantId = null } = {}) {
	if (!Array.isArray(list)) throw new EvmLegError('invalid_allowlist', 'allowlist must be an array of 0x addresses.');
	const bad = list.filter((a) => !normalizeEvmAddress(a));
	if (bad.length) throw new EvmLegError('invalid_address', `Not an EVM address: ${String(bad[0]).slice(0, 64)}`);
	return replaceList({ agentId, actor, list, chain: 'evm', grantId, req });
}
