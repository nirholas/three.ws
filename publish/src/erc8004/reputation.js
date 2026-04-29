/**
 * ReputationRegistry helpers — submit and query agent feedback.
 *
 * Matches the canonical ERC-8004 reputation contract:
 *   submitReputation(uint256 agentId, uint8 score, string comment)
 *   getReputation(uint256 agentId) → (uint256 totalScore, uint256 count)
 */

import { Contract } from 'ethers';
import { REGISTRY_DEPLOYMENTS, REPUTATION_REGISTRY_ABI } from './abi.js';

function getContract(chainId, runner) {
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment || !deployment.reputationRegistry) {
		throw new Error(`No Reputation Registry deployed on chain ${chainId}.`);
	}
	return new Contract(deployment.reputationRegistry, REPUTATION_REGISTRY_ABI, runner);
}

/**
 * Submit a reputation score about an agent.
 * @param {object} opts
 * @param {number|bigint} opts.agentId
 * @param {number} opts.score                     Integer 0-255 (typically 1-5 or 1-100)
 * @param {string} [opts.comment='']              Free-form comment
 * @param {import('ethers').Signer} opts.signer
 * @param {number} [opts.chainId]
 * @returns {Promise<string>} tx hash
 */
export async function submitReputation({ agentId, score, comment = '', signer, chainId }) {
	if (!Number.isInteger(score) || score < 0 || score > 255) {
		throw new Error('score must be a uint8 (0-255)');
	}
	const resolvedChainId = chainId ?? Number((await signer.provider.getNetwork()).chainId);
	const contract = getContract(resolvedChainId, signer);
	const tx = await contract.submitReputation(agentId, score, comment);
	await tx.wait();
	return tx.hash;
}

// Back-compat alias — the canonical contract calls it submitReputation.
export const submitFeedback = submitReputation;

/**
 * Read aggregated reputation.
 * @returns {Promise<{total: number, count: number, average: number}>}
 *          average is 0 when no reviews have been submitted.
 */
export async function getReputation({ agentId, runner, chainId }) {
	const contract = getContract(chainId, runner);
	const [totalScore, count] = await contract.getReputation(agentId);
	const n = Number(count);
	const t = Number(totalScore);
	return {
		total: t,
		count: n,
		average: n === 0 ? 0 : t / n,
	};
}

/**
 * Enumerate past reviews by querying the ReputationSubmitted event log.
 * Optional — only useful if an indexer/provider supports filtered log queries.
 */
export async function getRecentReviews({ agentId, runner, chainId, fromBlock = 0 }) {
	const contract = getContract(chainId, runner);
	const filter = contract.filters.ReputationSubmitted(agentId);
	const events = await contract.queryFilter(filter, fromBlock);
	return events.map((ev) => ({
		agentId: Number(ev.args.agentId),
		from: ev.args.submitter,
		score: Number(ev.args.score),
		comment: ev.args.comment,
		blockNumber: ev.blockNumber,
		txHash: ev.transactionHash,
	}));
}
