/**
 * Dialect-aware ERC-8004 reputation reads. Pure ethers, no DOM, so the browser
 * helpers (reputation.js, the passport widget) and the server trust readers under
 * api/_lib all share this one implementation.
 *
 * Two registry dialects exist in the wild:
 *
 *   reference  The ERC-8004 reference implementation that runs at the canonical
 *              0x8004... addresses. Reputation is a per-reviewer ledger:
 *              getSummary(agentId, clientAddresses, tag1, tag2) averages the feedback
 *              of the reviewers you name and REVERTS on an empty list.
 *   legacy     contracts/src/ReputationRegistry.sol, for instances someone deployed
 *              themselves: getReputation(agentId) returns (avgX100, count).
 *
 * The reference registry is an upgradeable proxy, so its interface is a moving part.
 * Detection is by behaviour (does getClients answer?) and never by address.
 */

import { Contract } from 'ethers';
import { REPUTATION_REGISTRY_ABI, REPUTATION_REFERENCE_ABI } from './abi.js';

// getSummary walks every feedback entry of every named reviewer inside one eth_call.
// Chunking keeps an agent with thousands of reviewers under node gas caps.
const REVIEWER_CHUNK = 100;
const WAD_DECIMALS = 18n;

/** @returns {Promise<'reference'|'legacy'>} */
export async function detectReputationDialect(address, runner) {
	const reference = new Contract(address, REPUTATION_REFERENCE_ABI, runner);
	try {
		await reference.getIdentityRegistry();
		return 'reference';
	} catch {
		return 'legacy';
	}
}

async function readReference(address, runner, agentId, { tag1 = '', tag2 = '', reviewers } = {}) {
	const registry = new Contract(address, REPUTATION_REFERENCE_ABI, runner);
	// ethers returns a frozen Result; copy it so it can be sliced and re-encoded.
	const clients = reviewers?.length ? reviewers : Array.from(await registry.getClients(agentId));
	if (clients.length === 0) return { average: 0, count: 0, reviewers: 0, dialect: 'reference' };

	// Count-weighted mean across chunks, carried at 18 decimals so chunks that report
	// different `summaryValueDecimals` still combine exactly.
	let weightedSum = 0n;
	let total = 0n;
	for (let i = 0; i < clients.length; i += REVIEWER_CHUNK) {
		const [count, value, decimals] = await registry.getSummary(
			agentId,
			clients.slice(i, i + REVIEWER_CHUNK),
			tag1,
			tag2,
		);
		if (count === 0n) continue;
		weightedSum += value * 10n ** (WAD_DECIMALS - BigInt(decimals)) * count;
		total += count;
	}
	const average = total === 0n ? 0 : Number(weightedSum / total) / 1e18;
	return { average, count: Number(total), reviewers: clients.length, dialect: 'reference' };
}

async function readLegacy(address, runner, agentId) {
	const registry = new Contract(address, REPUTATION_REGISTRY_ABI, runner);
	const [avgX100, count] = await registry.getReputation(agentId);
	const n = Number(count);
	return { average: n === 0 ? 0 : Number(avgX100) / 100, count: n, reviewers: n, dialect: 'legacy' };
}

/**
 * Read an agent's aggregate reputation from whichever dialect lives at `address`.
 *
 * `average` is in the unit reviewers submitted: three.ws star reviews are 1 to 5, and
 * other ERC-8004 clients commonly submit 0 to 100. The registry does not normalise
 * scales and neither does this function, so compare against a threshold in the same unit.
 *
 * @param {object} opts
 * @param {string} opts.address                          Reputation registry address.
 * @param {import('ethers').ContractRunner} opts.runner   Provider or signer.
 * @param {number|bigint|string} opts.agentId
 * @param {string[]} [opts.reviewers]   Count only these reviewers (reference dialect).
 *                                      Default: everyone who has left feedback.
 * @param {string} [opts.tag1]          ERC-8004 feedback tag filters (reference dialect).
 * @param {string} [opts.tag2]
 * @returns {Promise<{average:number, count:number, reviewers:number, dialect:'reference'|'legacy'}>}
 */
export async function readAgentReputation({ address, runner, agentId, reviewers, tag1, tag2 }) {
	const id = BigInt(agentId);
	const dialect = await detectReputationDialect(address, runner);
	return dialect === 'reference'
		? readReference(address, runner, id, { reviewers, tag1, tag2 })
		: readLegacy(address, runner, id);
}
