import { sql } from '../../_lib/db.js';
import { cors, json, error, method, wrap } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';

const CACHE_TTL_S = 300; // 5 minutes

// Minimal public RPC map
const RPC = {
	1: 'https://eth.llamarpc.com',
	10: 'https://optimism.llamarpc.com',
	8453: 'https://base.llamarpc.com',
	42161: 'https://arbitrum.llamarpc.com',
	137: 'https://polygon.llamarpc.com',
	11155111: 'https://ethereum-sepolia.publicnode.com',
	84532: 'https://base-sepolia.publicnode.com',
};

let _redis = null;
async function getRedis() {
	if (_redis) return _redis;
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	if (!url || !token) return null;
	const { Redis } = await import('@upstash/redis');
	_redis = new Redis({ url, token });
	return _redis;
}

export const handleReputation = wrap(async (req, res, agentId) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [agent] = await sql`
		SELECT erc8004_agent_id, chain_id
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const url = new URL(req.url, 'http://x');
	const chainId = Number(url.searchParams.get('chain_id')) || agent.chain_id;

	if (!chainId || !agent.erc8004_agent_id) {
		return json(res, 200, { average: 0, count: 0, total_stake_wei: '0', chain_id: chainId });
	}

	const cacheKey = `rep:${agentId}:${chainId}`;
	const redis = await getRedis();

	if (redis) {
		try {
			const cached = await redis.get(cacheKey);
			if (cached) {
				res.setHeader('X-Cache', 'HIT');
				return json(res, 200, cached);
			}
		} catch { /* cache miss */ }
	}

	const rpcUrl = RPC[chainId];
	if (!rpcUrl) {
		return json(res, 200, { average: 0, count: 0, total_stake_wei: '0', chain_id: chainId });
	}

	const { JsonRpcProvider, Contract } = await import('ethers');
	const { REGISTRY_DEPLOYMENTS, REPUTATION_REGISTRY_ABI } = await import('../../../src/erc8004/abi.js');

	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment?.reputationRegistry) {
		return json(res, 200, { average: 0, count: 0, total_stake_wei: '0', chain_id: chainId });
	}

	const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
	const contract = new Contract(deployment.reputationRegistry, REPUTATION_REGISTRY_ABI, provider);

	const erc8004Id = BigInt(agent.erc8004_agent_id);
	const [[avgX100, count], totalStakeWei] = await Promise.all([
		contract.getReputation(erc8004Id),
		contract.getTotalStake(erc8004Id).catch(() => 0n),
	]);

	const n = Number(count);
	const result = {
		average: n === 0 ? 0 : Number(avgX100) / 100,
		count: n,
		total_stake_wei: totalStakeWei.toString(),
		chain_id: chainId,
	};

	if (redis) {
		redis.set(cacheKey, result, { ex: CACHE_TTL_S }).catch(() => {});
	}

	res.setHeader('X-Cache', 'MISS');
	return json(res, 200, result);
});
