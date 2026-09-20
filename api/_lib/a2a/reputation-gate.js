// Reputation gate — refuse to pay a peer agent whose on-chain ERC-8004
// reputation is below the caller's threshold.
//
// Trust is the missing half of autonomous payments: budget caps stop an agent
// overspending, but they don't stop it paying a scammer. ERC-8004's Reputation
// Registry is the standard EVM trust signal; this module reads it server-side
// and enforces a minimum average score and/or minimum review count before a
// mandate-authorized payment is allowed to proceed. (Its Solana counterpart —
// vetting a three.ws agent by its on-chain Solana track record — is
// ../trust/solana-bouncer.js, exposed publicly at /api/x402/agent-bouncer.)
//
// The read goes through the curated multi-RPC failover in api/_lib/evm/rpc.js
// (honoring A2A_REPUTATION_RPC_URL as the pinned primary when set), so the gate
// works out of the box without per-deploy RPC config. The reader is injectable
// (`read` option) so tests run without RPC. The gate is a no-op when no
// threshold is set; when a threshold IS set and the read fails, it fails closed.


import { env } from '../env.js';
import { evmFallbackProvider } from '../evm/rpc.js';
import { REGISTRY_DEPLOYMENTS } from '../../../src/erc8004/abi.js';
import { readAgentReputation } from '../../../src/erc8004/reputation-read.js';

export class ReputationError extends Error {
	constructor(code, message, status = 403) {
		super(message);
		this.name = 'ReputationError';
		this.code = code;
		this.status = status;
	}
}

/**
 * Read aggregated ERC-8004 reputation for an agent through the shared dialect-aware
 * reader (src/erc8004/reputation-read.js). The canonical registries run the ERC-8004
 * reference implementation, which has no getReputation(): reputation there is
 * getSummary over the reviewers returned by getClients. `average` is in the unit
 * reviewers submitted (0 to 100 by ERC-8004 convention on the canonical registries,
 * and signed, so it can be negative), so set `minAverage` in that same unit.
 *
 * @param {object} opts
 * @param {number|bigint|string} opts.agentId
 * @param {number} opts.chainId
 * @param {string} [opts.rpcUrl]   Pinned first; otherwise env + curated public failover.
 * @returns {Promise<{ average: number, count: number }>}
 */
export async function readReputationOnchain({ agentId, chainId, rpcUrl }) {
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment?.reputationRegistry) {
		throw new ReputationError(
			'reputation_registry_missing',
			`no Reputation Registry deployed on chain ${chainId}`,
			500,
		);
	}
	const provider = await evmFallbackProvider(chainId, {
		primaryUrl: rpcUrl || env.A2A_REPUTATION_RPC_URL || null,
	});
	const { average, count } = await readAgentReputation({
		address: deployment.reputationRegistry,
		runner: provider,
		agentId,
	});
	return { average, count };
}

/**
 * Assert a peer agent meets the reputation bar. Throws ReputationError when it
 * doesn't. A no-op when neither a minimum average nor minimum count is set.
 *
 * @param {object} opts
 * @param {number|bigint|string} [opts.agentId]   On-chain agentId of the peer.
 * @param {number} [opts.chainId]
 * @param {number} [opts.minAverage=0]            Required average score.
 * @param {number} [opts.minCount=0]              Required number of reviews.
 * @param {string} [opts.rpcUrl]
 * @param {(o:object)=>Promise<{average:number,count:number}>} [opts.read]  Injectable reader.
 * @returns {Promise<{ average: number, count: number } | null>}  The reputation read, or null when gating was skipped.
 */
export async function assertReputationOk({
	agentId,
	chainId,
	minAverage = 0,
	minCount = 0,
	rpcUrl,
	read = readReputationOnchain,
}) {
	const gated = minAverage > 0 || minCount > 0;
	if (!gated) return null; // No threshold requested — nothing to enforce.

	if (agentId === undefined || agentId === null || agentId === '') {
		throw new ReputationError(
			'reputation_required',
			'a reputation threshold was set but no peer agentId was provided to evaluate',
		);
	}

	let rep;
	try {
		rep = await read({ agentId, chainId, rpcUrl });
	} catch (err) {
		if (err instanceof ReputationError) throw err;
		// Reader blew up (RPC down, etc). Fail closed — we cannot prove the peer is
		// trustworthy, and the caller explicitly asked us to gate on trust.
		throw new ReputationError('reputation_unavailable', `reputation read failed: ${err.message}`, 502);
	}

	if (minCount > 0 && rep.count < minCount) {
		throw new ReputationError(
			'reputation_too_few_reviews',
			`peer has ${rep.count} review(s); ${minCount} required`,
		);
	}
	if (minAverage > 0 && rep.average < minAverage) {
		throw new ReputationError(
			'reputation_too_low',
			`peer average ${rep.average.toFixed(2)} is below required ${minAverage}`,
		);
	}
	return rep;
}
