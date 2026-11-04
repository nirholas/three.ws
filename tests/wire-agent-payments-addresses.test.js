import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWiring, wireAddressesTs, wireDeploymentsMd } from '../scripts/lib/agent-payments-wire.mjs';

const ts = readFileSync(new URL('../agent-payments-sdk/src/evm/addresses.ts', import.meta.url), 'utf8');
const md = readFileSync(new URL('../contracts/DEPLOYMENTS.md', import.meta.url), 'utf8');
const ADDR = '0xAAd35977753757071e019F548FcF803196380421';

describe('wire-agent-payments-addresses', () => {
	it('rejects bad chains, bad addresses and the zero address', () => {
		expect(() => parseWiring(['999=' + ADDR])).toThrow(/unsupported/);
		expect(() => parseWiring(['8453=0x123'])).toThrow(/invalid address/);
		expect(() => parseWiring(['8453=0x' + '0'.repeat(40)])).toThrow(/zero address/);
		expect(parseWiring(['8453=' + ADDR.toLowerCase()])).toEqual({ 8453: ADDR });
	});

	it('sets only the named chain block in addresses.ts', () => {
		const out = wireAddressesTs(ts, { 8453: ADDR });
		const base = out.slice(out.indexOf('  8453: {'), out.indexOf('  42161: {'));
		expect(base).toContain(`agentPayments: "${ADDR}",`);
		expect(out.match(/agentPayments: "0x/g)).toHaveLength(1);
		expect(out.match(/agentPayments: UNDEPLOYED/g)).toHaveLength((ts.match(/agentPayments: UNDEPLOYED/g) || []).length - 1);
	});

	it('fills the DEPLOYMENTS.md row for the chain and leaves the others', () => {
		const out = wireDeploymentsMd(md, { 56: ADDR }, { 56: { owner: '0x1', tx: '[0xabc](x)' } });
		const row = out.split('\n').find((l) => l.startsWith('| BNB Smart Chain | 56 |'));
		expect(row).toContain(ADDR);
		expect(row).toContain('[0xabc](x)');
		const base = out.split('\n').find((l) => l.startsWith('| Base | 8453 |'));
		expect(base).toBe(md.split('\n').find((l) => l.startsWith('| Base | 8453 |')));
	});

	it('throws instead of silently skipping a chain it cannot find', () => {
		expect(() => wireAddressesTs('export const X = 1;', { 8453: ADDR })).toThrow(/no agentPayments entry/);
		expect(() => wireDeploymentsMd('no table', { 8453: ADDR })).toThrow(/no DEPLOYMENTS.md row/);
	});
});
