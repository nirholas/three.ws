/**
 * ReputationRegistry helpers — submit and query agent feedback.
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
 * @param {number} opts.score                     Integer in [-100, 100]
 * @param {string} [opts.uri='']                  ipfs://... pointer to details
 * @param {import('ethers').Signer} opts.signer
 * @param {number} [opts.chainId]
 * @returns {Promise<string>} tx hash
 */
export async function submitFeedback({ agentId, score, uri = '', signer, chainId }) {
	if (!Number.isInteger(score) || score < -100 || score > 100) {
		throw new Error('score must be an integer in [-100, 100]');
	}
	const resolvedChainId = chainId ?? Number((await signer.provider.getNetwork()).chainId);
	const contract = getContract(resolvedChainId, signer);
	const tx = await contract.submitFeedback(agentId, score, uri);
	await tx.wait();
	return tx.hash;
}

/**
 * Read aggregated reputation.
 * @returns {Promise<{average: number, count: number}>}
 *          average is a float (avgX100 / 100); 0 when no reviews.
 */
export async function getReputation({ agentId, runner, chainId }) {
	const contract = getContract(chainId, runner);
	const [avgX100, count] = await contract.getReputation(agentId);
	return {
		average: Number(count) === 0 ? 0 : Number(avgX100) / 100,
		count: Number(count),
	};
}

export async function getFeedbackRange({ agentId, offset, limit, runner, chainId }) {
	const contract = getContract(chainId, runner);
	const rows = await contract.getFeedbackRange(agentId, offset, limit);
	return rows.map((r) => ({
		from: r.from,
		score: Number(r.score),
		timestamp: Number(r.timestamp),
		uri: r.uri,
	}));
}

export async function hasReviewed({ agentId, reviewer, runner, chainId }) {
	const contract = getContract(chainId, runner);
	return contract.hasReviewed(agentId, reviewer);
}
