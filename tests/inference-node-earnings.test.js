import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = new Map();
const calls = [];

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...vals) => {
		const text = strings.join('?');
		calls.push(text);
		if (/insert into inference_node_earnings/.test(text)) {
			const [node, jobId, capability, model, amount, asset, sig] = vals;
			if (rows.has(jobId)) return [];
			const row = { node_public_key: node, job_id: jobId, capability, model, amount_atomics: amount, asset, payer_signature: sig, payout_status: 'accrued' };
			rows.set(jobId, row);
			return [row];
		}
		if (/group by payout_status/.test(text)) {
			const mine = [...rows.values()].filter((r) => r.node_public_key === vals[0]);
			return mine.length ? [{ payout_status: 'accrued', jobs: mine.length, atomics: String(mine.reduce((a, r) => a + Number(r.amount_atomics), 0)) }] : [];
		}
		return [];
	};
	return { sql };
});
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));

const { recordNodeEarning, getNodeEarnings } = await import('../api/_lib/inference-nodes.js');

describe('inference node earnings ledger', () => {
	beforeEach(() => rows.clear());

	it('accrues exactly one row per job id', async () => {
		const args = { nodePublicKey: 'NodeA', jobId: 'job_1', capability: 'text-embedding', model: 'm', amountAtomics: '1000', asset: 'USDC', payerSignature: 'sig' };
		expect(await recordNodeEarning(args)).toMatchObject({ job_id: 'job_1', payout_status: 'accrued' });
		expect(await recordNodeEarning(args)).toBeNull();
		expect(rows.size).toBe(1);
	});

	it('totals accrued earnings for one node only', async () => {
		await recordNodeEarning({ nodePublicKey: 'NodeA', jobId: 'j1', capability: 'c', amountAtomics: '1000' });
		await recordNodeEarning({ nodePublicKey: 'NodeA', jobId: 'j2', capability: 'c', amountAtomics: '2000' });
		await recordNodeEarning({ nodePublicKey: 'NodeB', jobId: 'j3', capability: 'c', amountAtomics: '9000' });
		const e = await getNodeEarnings('NodeA');
		expect(e.accrued).toEqual({ jobs: 2, atomics: '3000' });
		expect(e.paid).toEqual({ jobs: 0, atomics: '0' });
	});
});
