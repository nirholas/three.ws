import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { addressKind, readWalletHoldings, solanaRpcEndpoints, SOLANA_TOKEN_PROGRAMS } from '../api/_wallet-holdings.js';

/**
 * Upstream stubs follow the payloads the live services return (Solana JSON-RPC
 * jsonParsed token accounts, DeFiLlama coins, Blockscout v2). Addresses are
 * $THREE's mint or synthetic placeholders.
 */
const OWNER = 'THREEsynthetic1111111111111111111111111111';
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYN_STABLE = 'SYNstab1e11111111111111111111111111111111';
const SYN_JUNK = 'SYNjunk111111111111111111111111111111111';
const [CLASSIC, TOKEN_2022] = SOLANA_TOKEN_PROGRAMS;

const tokenAccount = (mint, ui) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString: String(ui) } } } } } });
const json = (body, status = 200, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });

function solanaUpstream({ rejectToken2022On = [], downRpcs = [], prices } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://coins.llama.fi/prices/current/')) {
      calls.push({ price: decodeURIComponent(u.slice(38)).split(',') });
      return json({ coins: prices });
    }
    const req = JSON.parse(init.body);
    calls.push({ rpc: u, method: req.method, program: req.params[1]?.programId });
    if (downRpcs.includes(u)) return json({ jsonrpc: '2.0', error: { code: 429, message: 'max usage reached' } }, 429);
    if (req.method === 'getBalance') return json({ jsonrpc: '2.0', result: { value: 2.5e9 } });
    if (req.params[1].programId === TOKEN_2022) {
      if (rejectToken2022On.includes(u)) return json({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid param: unrecognized Token program id' } });
      return json({ jsonrpc: '2.0', result: { value: [tokenAccount(SYN_STABLE, 40)] } });
    }
    return json({ jsonrpc: '2.0', result: { value: [tokenAccount(THREE, 1000), tokenAccount(THREE, 500), tokenAccount(SYN_JUNK, 9e9), tokenAccount(SYN_STABLE, 0)] } });
  };
  return { fetchImpl, calls };
}

const livePrices = {
  'coingecko:solana': { price: 100, symbol: 'SOL', confidence: 0.99 },
  [`solana:${THREE}`]: { price: 0.01, symbol: 'THREE', confidence: 0.9 },
  [`solana:${SYN_STABLE}`]: { price: 1, symbol: 'SYNUSD', confidence: 0.99 },
  [`solana:${SYN_JUNK}`]: { price: 5, symbol: 'JUNK', confidence: 0.2 },
};

describe('addressKind', () => {
  it('tells Solana from EVM and rejects everything else', () => {
    assert.equal(addressKind(THREE), 'solana');
    assert.equal(addressKind('0x1111111111111111111111111111111111111111'), 'evm');
    assert.equal(addressKind('0x1234'), null);
    assert.equal(addressKind('not an address'), null);
    assert.equal(addressKind('O0Il' + 'a'.repeat(30)), null);
    assert.equal(addressKind(42), null);
  });
});

describe('solanaRpcEndpoints', () => {
  it('puts the operator RPC first, then Helius, then the public endpoint', () => {
    assert.deepEqual(solanaRpcEndpoints({}), ['https://api.mainnet-beta.solana.com']);
    const list = solanaRpcEndpoints({ SOLANA_RPC_URL: 'https://rpc.example', HELIUS_API_KEY: 'k' });
    assert.equal(list[0], 'https://rpc.example');
    assert.match(list[1], /^https:\/\/mainnet\.helius-rpc\.com\/\?api-key=k$/);
    assert.equal(list.at(-1), 'https://api.mainnet-beta.solana.com');
  });
});

describe('readWalletHoldings on Solana', () => {
  it('values native SOL and both token programs, merges accounts per mint, and skips low-confidence prices', async () => {
    const up = solanaUpstream({ prices: livePrices });
    const r = await readWalletHoldings(OWNER, { fetchImpl: up.fetchImpl });
    assert.equal(r.kind, 'solana');
    assert.deepEqual(r.holdings.map((h) => [h.symbol, h.usd]), [['SOL', 250], ['SYNUSD', 40], ['THREE', 15]]);
    assert.deepEqual(r.holdings.find((h) => h.symbol === 'THREE').token, { chain: 'solana', address: THREE });
    assert.equal(r.unpriced, 1);
    const programs = up.calls.filter((c) => c.method === 'getTokenAccountsByOwner').map((c) => c.program);
    assert.deepEqual(programs.sort(), [CLASSIC, TOKEN_2022].sort());
  });

  it('falls through a rate-limited RPC to the next one', async () => {
    const env = { SOLANA_RPC_URL: 'https://rpc.example' };
    const up = solanaUpstream({ prices: livePrices, downRpcs: ['https://rpc.example'] });
    const r = await readWalletHoldings(OWNER, { fetchImpl: up.fetchImpl, env });
    assert.equal(r.holdings.length, 3);
    assert.ok(up.calls.some((c) => c.rpc === 'https://api.mainnet-beta.solana.com'));
  });

  it('still answers when no RPC supports the Token-2022 program', async () => {
    const up = solanaUpstream({ prices: livePrices, rejectToken2022On: ['https://api.mainnet-beta.solana.com'] });
    const r = await readWalletHoldings(OWNER, { fetchImpl: up.fetchImpl });
    assert.deepEqual(r.holdings.map((h) => h.symbol), ['SOL', 'THREE']);
    assert.match(r.chains[0].note, /token program could not be read/);
  });

  it('reports 502 when every RPC is down', async () => {
    const up = solanaUpstream({ prices: livePrices, downRpcs: ['https://api.mainnet-beta.solana.com'] });
    await assert.rejects(readWalletHoldings(OWNER, { fetchImpl: up.fetchImpl }), (err) => err.status === 502 && /could not read balances/.test(err.message));
  });

  it('rejects malformed addresses and chains that disagree with the address', async () => {
    const fetchImpl = async () => { throw new Error('must not fetch'); };
    await assert.rejects(readWalletHoldings('nope', { fetchImpl }), (e) => e.status === 400);
    await assert.rejects(readWalletHoldings(OWNER, { chain: 'base', fetchImpl }), (e) => e.status === 400 && /0x EVM address/.test(e.message));
    await assert.rejects(readWalletHoldings('0x1111111111111111111111111111111111111111', { chain: 'solana', fetchImpl }), (e) => e.status === 400);
    await assert.rejects(readWalletHoldings(OWNER, { chain: 'moon', fetchImpl }), (e) => e.status === 400 && /chain must be/.test(e.message));
  });
});

describe('readWalletHoldings on EVM', () => {
  const EVM = '0x2222222222222222222222222222222222222222';
  const SYN_TOKEN = '0x3333333333333333333333333333333333333333';
  const SPAM = '0x4444444444444444444444444444444444444444';

  function blockscout({ challenged = [] } = {}) {
    const hosts = [];
    const fetchImpl = async (url) => {
      const u = new URL(String(url));
      hosts.push(u.host);
      if (challenged.includes(u.host)) return json('<!DOCTYPE html><title>Just a moment...</title>', 403, 'text/html');
      if (u.pathname.endsWith('/token-balances')) {
        return json([
          { token: { address_hash: SYN_TOKEN, symbol: 'SYNUSD', decimals: '6', exchange_rate: '1', type: 'ERC-20', reputation: 'ok' }, value: '25000000' },
          { token: { address_hash: SPAM, symbol: 'FREE', decimals: '18', exchange_rate: '3', type: 'ERC-20', reputation: 'scam' }, value: '1000000000000000000000' },
          { token: { address_hash: SPAM, symbol: 'NFT', decimals: null, exchange_rate: null, type: 'ERC-721' }, value: '1' },
        ]);
      }
      return json({ coin_balance: '500000000000000000', exchange_rate: '2000' });
    };
    return { fetchImpl, hosts };
  }

  it('reads every supported network, values native and priced ERC-20s, and drops flagged tokens', async () => {
    const up = blockscout({ challenged: ['base.blockscout.com'] });
    const r = await readWalletHoldings(EVM, { fetchImpl: up.fetchImpl });
    assert.equal(r.kind, 'evm');
    assert.deepEqual(r.chains.find((c) => c.chain === 'base'), { chain: 'base', ok: false, error: 'base explorer HTTP 403' });
    assert.equal(r.chains.filter((c) => c.ok).length, 3);
    assert.equal(r.holdings.filter((h) => h.symbol === 'ETH').length, 3);
    assert.equal(r.holdings[0].usd, 1000);
    assert.deepEqual(r.holdings.find((h) => h.symbol === 'SYNUSD').token, { chain: 'ethereum', address: SYN_TOKEN });
    assert.equal(r.unpriced, 3);
  });

  it('narrows to one network when chain is given', async () => {
    const up = blockscout();
    const r = await readWalletHoldings(EVM, { chain: 'optimism', fetchImpl: up.fetchImpl });
    assert.deepEqual(r.chains, [{ chain: 'optimism', ok: true }]);
    assert.deepEqual([...new Set(up.hosts)], ['explorer.optimism.io']);
  });
});
