// Planning core for the AgentPayments CREATE2 deploy, replayed from JSON-RPC
// responses recorded off a real anvil fork of BNB Smart Chain
// (scripts/record-agent-payments-plan-fixture.mjs).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, hexToBigInt } from 'viem';
import {
	CHAINS,
	FACTORY,
	FACTORY_ABI,
	SALT,
	deployCalldata,
	formatNative,
	isLocalEndpoint,
	planChain,
	predictAddress,
	renderTable,
} from '../scripts/lib/agent-payments-deploy.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/agent-payments-plan-bsc.json', import.meta.url), 'utf8'));
const { chain, owner, recorded } = fixture;
const estimate = recorded.find((c) => c.method === 'eth_estimateGas');
const initCode = decodeFunctionData({ abi: FACTORY_ABI, data: estimate.params[0].data }).args[1];

function replay(overrides = {}) {
	return async (method, params) => {
		if (overrides[method]) return overrides[method](params);
		const hit = recorded.find((c) => c.method === method && (method !== 'eth_getCode' || c.params[0].toLowerCase() === params[0].toLowerCase()));
		if (!hit) throw new Error(`no recording for ${method}`);
		return hit.result;
	};
}

describe('AgentPayments CREATE2 plan', () => {
	it('plans a ready chain from the recorded responses', async () => {
		const row = await planChain({ chain, rpc: replay(), initCode, owner });
		expect(row.status).toBe('ready');
		expect(row.predicted).toBe(predictAddress(initCode));
		expect(row.gas).toBe(hexToBigInt(estimate.result));
		expect(row.costWei).toBe(row.gas * row.gasPrice);
		expect(row.costWei).toBeGreaterThan(0n);
	});

	it('sends the estimate to the factory with the exact deploy calldata', async () => {
		let seen;
		await planChain({ chain, rpc: replay({ eth_estimateGas: (p) => { seen = p[0]; return estimate.result; } }), initCode, owner });
		expect(seen.to).toBe(FACTORY);
		expect(seen.from).toBe(owner);
		expect(seen.data).toBe(deployCalldata(initCode));
	});

	it('reports factory_missing and does not estimate gas', async () => {
		let estimated = false;
		const row = await planChain({
			chain,
			initCode,
			owner,
			rpc: replay({
				eth_getCode: (p) => '0x',
				eth_estimateGas: () => { estimated = true; return '0x1'; },
			}),
		});
		expect(row.status).toBe('factory_missing');
		expect(estimated).toBe(false);
	});

	it('reports already_deployed when code exists at the predicted address', async () => {
		const row = await planChain({
			chain,
			initCode,
			owner,
			rpc: replay({ eth_getCode: () => '0x6001' }),
		});
		expect(row.status).toBe('already_deployed');
	});

	it('turns an RPC failure into an error row instead of throwing', async () => {
		const row = await planChain({
			chain,
			initCode,
			owner,
			rpc: async () => {
				throw new Error('rpc down');
			},
		});
		expect(row.status).toBe('error');
		expect(row.error).toBe('rpc down');
	});

	it('uses one address for every chain and a different one per owner', () => {
		expect(CHAINS.map((c) => c.id)).toEqual([1, 8453, 42161, 137, 56, 43114]);
		expect(predictAddress(initCode)).toBe(predictAddress(initCode, FACTORY, SALT));
		const other = initCode.slice(0, -40) + '1'.repeat(40);
		expect(predictAddress(other)).not.toBe(predictAddress(initCode));
	});

	it('renders one table row per chain with the predicted address and cost', async () => {
		const ready = await planChain({ chain, rpc: replay(), initCode, owner });
		const missing = { ...ready, name: 'Ethereum', chain: 1, status: 'factory_missing' };
		const table = renderTable([ready, missing]);
		expect(table.split('\n')).toHaveLength(4);
		expect(table).toContain(ready.predicted);
		expect(table).toContain('MISSING');
		expect(table).toMatch(/BNB/);
	});

	it('formats wei to six decimals and recognises local endpoints', () => {
		expect(formatNative(1_500_000_000_000_000_000n)).toBe('1.500000');
		expect(isLocalEndpoint('http://127.0.0.1:8545')).toBe(true);
		expect(isLocalEndpoint('https://mainnet.base.org')).toBe(false);
		expect(isLocalEndpoint('not a url')).toBe(false);
	});
});
