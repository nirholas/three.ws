/**
 * ReputationRegistry helpers: submit and query agent feedback.
 *
 * Two registry dialects exist (see reputation-read.js). The canonical 0x8004...
 * addresses run the ERC-8004 reference implementation: feedback is
 * giveFeedback(agentId, value, decimals, tags..., uri, hash) on a 0 to 100 scale by
 * convention, read back with getSummary over a named reviewer set, and there is no
 * staking. A registry someone deployed from contracts/src speaks the legacy dialect:
 * submitFeedback / getReputation / stakeReputation.
 *
 * Everything exported here works on both. Ratings cross this boundary as 1 to 5
 * stars, which is what every three.ws surface shows: on the reference dialect a star
 * is 20 points, so 5 stars is written as 100 and an on-chain average of 82 reads 4.1.
 */

import { Contract, ZeroHash } from 'ethers';
import { REGISTRY_DEPLOYMENTS, REPUTATION_REGISTRY_ABI, REPUTATION_REFERENCE_ABI } from './abi.js';
import { detectReputationDialect, readAgentReputation } from './reputation-read.js';

const POINTS_PER_STAR = 20;
// Recent reviews on the reference dialect are read reviewer by reviewer (no log
// scan, so it works on any RPC). Newest reviewers are last in getClients.
const RECENT_REVIEWERS = 20;

function registryAddress(chainId) {
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment || !deployment.reputationRegistry) {
		throw new Error(`No Reputation Registry deployed on chain ${chainId}.`);
	}
	return deployment.reputationRegistry;
}

const dialectCache = new Map();
function dialectOf(chainId, runner) {
	if (!dialectCache.has(chainId)) {
		const pending = detectReputationDialect(registryAddress(chainId), runner);
		dialectCache.set(chainId, pending);
		pending.catch(() => dialectCache.delete(chainId));
	}
	return dialectCache.get(chainId);
}

function toStars(points) {
	return Math.max(0, Math.min(5, points / POINTS_PER_STAR));
}

/** True when this chain's registry supports ETH-staked vouches (legacy dialect only). */
export async function supportsStaking({ chainId, runner }) {
	return (await dialectOf(chainId, runner)) === 'legacy';
}

/**
 * Submit reputation feedback about an agent.
 * @param {object} opts
 * @param {number|bigint} opts.agentId
 * @param {number} opts.score                     1 to 5 stars. (The legacy dialect also accepts any int8 in [-100, 100].)
 * @param {string} [opts.comment='']              Optional public on-chain comment / ipfs:// URI
 * @param {import('ethers').Signer} opts.signer
 * @param {number} [opts.chainId]
 * @returns {Promise<string>} tx hash
 */
export async function submitFeedback({ agentId, score, comment = '', signer, chainId }) {
	const resolvedChainId = chainId ?? Number((await signer.provider.getNetwork()).chainId);
	const address = registryAddress(resolvedChainId);

	let tx;
	if ((await dialectOf(resolvedChainId, signer)) === 'reference') {
		if (!Number.isInteger(score) || score < 1 || score > 5) {
			throw new Error('score must be 1 to 5 stars');
		}
		const registry = new Contract(address, REPUTATION_REFERENCE_ABI, signer);
		try {
			tx = await registry.giveFeedback(agentId, score * POINTS_PER_STAR, 0, '', '', '', comment, ZeroHash);
		} catch (err) {
			if (/Self-feedback not allowed/i.test(err?.reason || err?.message || '')) {
				throw new Error("You can't review an agent you own or operate.");
			}
			throw err;
		}
	} else {
		if (!Number.isInteger(score) || score < -100 || score > 100) {
			throw new Error('score must be an int8 in [-100, 100]');
		}
		const registry = new Contract(address, REPUTATION_REGISTRY_ABI, signer);
		tx = await registry.submitFeedback(agentId, score, comment);
	}
	await tx.wait();
	return tx.hash;
}

// Back-compat alias: the prior client API called this submitReputation.
export const submitReputation = submitFeedback;

/**
 * Read aggregated reputation.
 * @returns {Promise<{average:number, count:number, reviewers:number, rawAverage:number, dialect:string}>}
 *          `average` is in stars (0 to 5, 0 when nobody has reviewed). `rawAverage` is
 *          the on-chain figure in the registry's own unit.
 */
export async function getReputation({ agentId, runner, chainId }) {
	const rep = await readAgentReputation({ address: registryAddress(chainId), runner, agentId });
	return {
		count: rep.count,
		reviewers: rep.reviewers,
		average: rep.dialect === 'reference' ? toStars(rep.average) : rep.average,
		rawAverage: rep.average,
		dialect: rep.dialect,
	};
}

/**
 * Submit a reputation score backed by ETH stake. Legacy dialect only: the canonical
 * ERC-8004 registry has no staking, so check `supportsStaking` before offering it.
 * @param {object} opts
 * @param {number|bigint} opts.agentId
 * @param {number} opts.score         1-5
 * @param {string} [opts.comment='']
 * @param {bigint} opts.stakeWei      Must be >= 0.001 ETH (1e15 wei)
 * @param {import('ethers').Signer} opts.signer
 * @param {number} [opts.chainId]
 * @returns {Promise<string>} tx hash
 */
export async function stakeReputation({ agentId, score, comment = '', stakeWei, signer, chainId }) {
	if (!Number.isInteger(score) || score < 1 || score > 5) {
		throw new Error('score must be 1-5');
	}
	const resolvedChainId = chainId ?? Number((await signer.provider.getNetwork()).chainId);
	if (!(await supportsStaking({ chainId: resolvedChainId, runner: signer }))) {
		throw new Error('Staked vouches are not supported by the ERC-8004 registry on this chain.');
	}
	const contract = new Contract(registryAddress(resolvedChainId), REPUTATION_REGISTRY_ABI, signer);
	const tx = await contract.stakeReputation(agentId, score, comment, { value: stakeWei });
	await tx.wait();
	return tx.hash;
}

/**
 * Read total ETH staked on an agent. Always 0 on the reference dialect.
 * @returns {Promise<bigint>} wei
 */
export async function getTotalStake({ agentId, runner, chainId }) {
	if (!(await supportsStaking({ chainId, runner }))) return 0n;
	const contract = new Contract(registryAddress(chainId), REPUTATION_REGISTRY_ABI, runner);
	return await contract.getTotalStake(agentId);
}

async function recentReferenceReviews(address, runner, agentId) {
	const registry = new Contract(address, REPUTATION_REFERENCE_ABI, runner);
	const clients = Array.from(await registry.getClients(agentId)).slice(-RECENT_REVIEWERS);
	const reviews = await Promise.all(
		clients.map(async (from) => {
			const index = await registry.getLastIndex(agentId, from);
			if (index === 0n) return null;
			const [value, decimals, tag1, , isRevoked] = await registry.readFeedback(agentId, from, index);
			if (isRevoked) return null;
			return {
				agentId: Number(agentId),
				from,
				score: toStars(Number(value) / 10 ** Number(decimals)),
				comment: tag1,
				blockNumber: null,
				txHash: null,
			};
		}),
	);
	return reviews.filter(Boolean);
}

/**
 * Most recent reviews, oldest first (log order on both dialects). `score` is in stars. On the reference dialect
 * the list is read straight from registry state (each recent reviewer's latest
 * feedback), so there is no block number or tx hash and `comment` carries the
 * feedback's primary tag. On the legacy dialect it is a FeedbackSubmitted log scan,
 * which only works if the RPC allows filtered log queries over the range.
 */
export async function getRecentReviews({ agentId, runner, chainId, fromBlock = 0 }) {
	const address = registryAddress(chainId);
	if ((await dialectOf(chainId, runner)) === 'reference') {
		return recentReferenceReviews(address, runner, BigInt(agentId));
	}
	const contract = new Contract(address, REPUTATION_REGISTRY_ABI, runner);
	const filter = contract.filters.FeedbackSubmitted(agentId);
	const events = await contract.queryFilter(filter, fromBlock);
	return events.map((ev) => ({
		agentId: Number(ev.args.agentId),
		from: ev.args.from,
		score: Number(ev.args.score),
		comment: ev.args.uri,
		blockNumber: ev.blockNumber,
		txHash: ev.transactionHash,
	}));
}
