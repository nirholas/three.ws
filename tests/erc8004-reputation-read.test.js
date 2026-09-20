import { describe, it, expect } from 'vitest';
import { Interface } from 'ethers';
import { REPUTATION_REGISTRY_ABI, REPUTATION_REFERENCE_ABI } from '../src/erc8004/abi.js';
import { readAgentReputation, detectReputationDialect } from '../src/erc8004/reputation-read.js';

const ADDRESS = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const reference = new Interface(REPUTATION_REFERENCE_ABI);
const legacy = new Interface(REPUTATION_REGISTRY_ABI);

const reviewer = (i) => '0x' + (i + 1).toString(16).padStart(40, '0');

// An ethers ContractRunner that answers eth_call the way each registry dialect does:
// unknown selectors revert with no data, exactly like the live contracts.
function runnerFor(iface, handlers) {
	return {
		provider: null,
		async call(tx) {
			const fragment = iface.getFunction(tx.data.slice(0, 10));
			const handler = fragment && handlers[fragment.name];
			if (!handler) throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
			const args = iface.decodeFunctionData(fragment, tx.data);
			return iface.encodeFunctionResult(fragment, handler(args));
		},
	};
}

describe('readAgentReputation', () => {
	it('reads the reference dialect through getClients + getSummary', async () => {
		const clients = [reviewer(0), reviewer(1)];
		const runner = runnerFor(reference, {
			getIdentityRegistry: () => ['0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'],
			getClients: () => [clients],
			getSummary: ([, named]) => {
				expect(Array.from(named)).toEqual(clients);
				return [41n, 82n, 0];
			},
		});
		expect(await detectReputationDialect(ADDRESS, runner)).toBe('reference');
		expect(await readAgentReputation({ address: ADDRESS, runner, agentId: 1 })).toEqual({
			average: 82,
			count: 41,
			reviewers: 2,
			dialect: 'reference',
		});
	});

	it('never calls getSummary with an empty reviewer list, which the live registry rejects', async () => {
		const runner = runnerFor(reference, {
			getIdentityRegistry: () => ['0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'],
			getClients: () => [[]],
			getSummary: () => {
				throw new Error('clientAddresses required');
			},
		});
		expect(await readAgentReputation({ address: ADDRESS, runner, agentId: 7 })).toEqual({
			average: 0,
			count: 0,
			reviewers: 0,
			dialect: 'reference',
		});
	});

	it('chunks large reviewer sets and combines chunks as a count-weighted mean across decimals', async () => {
		const clients = Array.from({ length: 150 }, (_, i) => reviewer(i));
		const chunkSizes = [];
		const runner = runnerFor(reference, {
			getIdentityRegistry: () => ['0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'],
			getClients: () => [clients],
			getSummary: ([, named]) => {
				chunkSizes.push(named.length);
				// First chunk: 30 entries averaging 90 (0 decimals).
				// Second chunk: 10 entries averaging 50.00 (2 decimals).
				return named.length === 100 ? [30n, 90n, 0] : [10n, 5000n, 2];
			},
		});
		const rep = await readAgentReputation({ address: ADDRESS, runner, agentId: 1 });
		expect(chunkSizes).toEqual([100, 50]);
		expect(rep.count).toBe(40);
		expect(rep.average).toBe(80); // (30*90 + 10*50) / 40
	});

	it('honours an explicit reviewer set and tag filters', async () => {
		const trusted = [reviewer(9)];
		const runner = runnerFor(reference, {
			getIdentityRegistry: () => ['0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'],
			getSummary: ([, named, tag1, tag2]) => {
				expect(Array.from(named, (a) => a.toLowerCase())).toEqual(trusted);
				expect([tag1, tag2]).toEqual(['uptime', '']);
				return [3n, -25n, 0];
			},
		});
		const rep = await readAgentReputation({
			address: ADDRESS,
			runner,
			agentId: 1,
			reviewers: trusted,
			tag1: 'uptime',
		});
		expect(rep).toMatchObject({ average: -25, count: 3, reviewers: 1 });
	});

	it('falls back to the legacy dialect on a registry deployed from contracts/src', async () => {
		const runner = runnerFor(legacy, { getReputation: () => [425n, 8n] });
		expect(await detectReputationDialect(ADDRESS, runner)).toBe('legacy');
		expect(await readAgentReputation({ address: ADDRESS, runner, agentId: 1 })).toEqual({
			average: 4.25,
			count: 8,
			reviewers: 8,
			dialect: 'legacy',
		});
	});
});
