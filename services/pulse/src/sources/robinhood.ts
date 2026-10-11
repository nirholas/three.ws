// Robinhood Chain (chain id 4663, Arbitrum Orbit). Launches come straight
// from the launchpad factories' logs over JSON-RPC, so a new coin is recorded
// the block it appears, before any aggregator has indexed it. Market data for
// those coins then comes from DexScreener (chainId "robinhood").
import { request as httpsRequest } from 'node:https';
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';
import type { LaunchEvent } from './types.ts';

const log = logger('robinhood');

export const RH_EXPLORER = 'https://robinhoodchain.blockscout.com';

/** Factory contracts and the events that mean "a token was born" or "it graduated". */
const FACTORIES = [
  {
    launchpad: 'pons',
    address: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
    // topic0 of the factory launch event (token, curve and deployer are indexed)
    launch: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
    tokenTopic: 1,
    actorTopic: 3,
  },
  {
    launchpad: 'noxa',
    address: '0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB',
    launch: '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a',
    tokenTopic: 1,
    actorTopic: 2,
  },
  ...['0xEb3FeeD2716cF0eEAda05B22e67424794e1f5a80', '0x6Ce85c4b7cE12903E5867652C265bCcce57f935F', '0xD7601cEe401306fdea5833c6898181D9c770F800'].map((address) => ({
    launchpad: 'odyssey',
    address,
    // topic0 of the factory creation event (token and creator are indexed)
    launch: '0xa52263eeb2ea349365a35c006fc978b0b85eb109fe50959959c829b329bebf9e',
    tokenTopic: 1,
    actorTopic: 2,
  })),
] as const;

/** keccak256("PoolMigrated(address,address,uint256,uint128,uint256,uint256)"): an Odyssey curve filled and moved to Uniswap v3. */
export const ODYSSEY_POOL_MIGRATED = '0xa915d8c1403c8f95a7c6318211de8aabf6f0bfb612a7624e84ebb91a9be1c21c';

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string };

/**
 * The public RPC sits behind Cloudflare, which challenges undici's fetch
 * fingerprint but lets Node's https client through, so RPC calls use https.
 */
function postJson<R>(url: string, payload: unknown): Promise<R> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 20_000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) return reject(new Error(`HTTP ${res.statusCode} from ${new URL(url).host}`));
        try {
          resolve(JSON.parse(data) as R);
        } catch {
          reject(new Error(`invalid JSON from ${new URL(url).host}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout calling ${new URL(url).host}`)));
    req.on('error', reject);
    req.end(body);
  });
}

let rpcIndex = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < config.robinhoodRpc.length; i++) {
    const url = config.robinhoodRpc[(rpcIndex + i) % config.robinhoodRpc.length];
    try {
      const res = await postJson<{ result?: T; error?: { message: string } }>(url, { jsonrpc: '2.0', id: 1, method, params });
      if (res.error) throw new Error(res.error.message);
      rpcIndex = (rpcIndex + i) % config.robinhoodRpc.length;
      return res.result as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('robinhood rpc failed');
}

const topicAddr = (t: string | undefined) => (t && t.length >= 42 ? `0x${t.slice(-40)}` : undefined);

export async function rhBlockNumber(): Promise<number> {
  return parseInt(await rpc<string>('eth_blockNumber', []), 16);
}

const blockTimes = new Map<number, number>();
async function blockTime(n: number): Promise<number> {
  const hit = blockTimes.get(n);
  if (hit) return hit;
  const b = await rpc<{ timestamp: string }>('eth_getBlockByNumber', [`0x${n.toString(16)}`, false]);
  const t = parseInt(b.timestamp, 16) * 1000;
  if (blockTimes.size > 5000) blockTimes.clear();
  blockTimes.set(n, t);
  return t;
}

/**
 * Launch and graduation events between two blocks (inclusive). The public RPC
 * caps a getLogs range at 100k blocks, so callers walk in windows.
 */
export async function rhLaunchEvents(fromBlock: number, toBlock: number): Promise<LaunchEvent[]> {
  const logs = await rpc<Log[]>('eth_getLogs', [
    {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      address: FACTORIES.map((f) => f.address),
      topics: [[...new Set(FACTORIES.map((f) => f.launch)), ODYSSEY_POOL_MIGRATED]],
    },
  ]);
  const out: LaunchEvent[] = [];
  for (const l of logs) {
    const ts = new Date(await blockTime(parseInt(l.blockNumber, 16)));
    if (l.topics[0] === ODYSSEY_POOL_MIGRATED) {
      const token = topicAddr(l.topics[1]);
      if (token) out.push({ ts, chain: 'robinhood', kind: 'graduation', token, launchpad: 'odyssey', tx: l.transactionHash, data: { pool: `0x${l.data.slice(26, 66)}` } });
      continue;
    }
    const f = FACTORIES.find((x) => x.address.toLowerCase() === l.address.toLowerCase() && x.launch === l.topics[0]);
    const token = f && topicAddr(l.topics[f.tokenTopic]);
    if (!f || !token) continue;
    out.push({ ts, chain: 'robinhood', kind: 'launch', token, launchpad: f.launchpad, actor: topicAddr(l.topics[f.actorTopic]), tx: l.transactionHash, data: { block: parseInt(l.blockNumber, 16) } });
  }
  log.info(`blocks ${fromBlock}-${toBlock}: ${out.length} launch events`);
  return out;
}
