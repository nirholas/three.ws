// createCreation binds the charge a paid submit took to the creation row it
// inserts (order 129). Without the bind, a job that fails after a 200 dispatch
// cannot be traced back to the payment or credit spend that funded it, and the
// make-whole paths in api/_lib/forge-paid-generation.js have nothing to follow.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

let failInsert = false;
const sqlMock = vi.fn(async (strings) => {
	const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
	if (failInsert && text.includes('insert into forge_creations')) throw new Error('insert refused');
	return [];
});

vi.mock('../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: vi.fn(async () => {}),
	objectStorageConfigured: () => true,
	publicUrl: (key) => `https://cdn.example.com/${key}`,
	cdnUrl: (key) => `https://cdn.example.com/${key}`,
	deleteObject: vi.fn(async () => {}),
	listObjectsPage: vi.fn(async () => ({ objects: [], nextToken: null })),
	normalizeStoredUrl: (u) => u,
	isStorageInfrastructureError: () => false,
	keyFromPublicUrl: () => null,
}));
vi.mock('../api/_lib/forge-events.js', () => ({ recordGenerationEvent: vi.fn(async () => {}) }));
vi.mock('../api/_lib/indexnow-queue.js', () => ({ announceIndexNow: vi.fn() }));

const { createCreation } = await import('../api/_lib/forge-store.js');
const { withPaidGenerationScope, notePaidGeneration } = await import('../api/_lib/forge-paid-generation.js');

const PAY_ID = '7c4e1b93-2a68-4f0d-8b52-1e93af6c04d7';
const LEDGER = '5f0c2d7e-8a41-4b6e-9c3d-2e1f0a9b8c77';

function calls(fragment) {
	return sqlMock.mock.calls.filter(([s]) => (Array.isArray(s) ? s.join(' ') : String(s)).includes(fragment));
}

const input = { clientKey: 'client-key', prompt: 'a brass robot', backend: 'trellis_selfhost', tier: 'high', path: 'text' };

afterEach(() => {
	sqlMock.mockClear();
	failInsert = false;
});

describe('createCreation inside a paid submit', () => {
	it('binds the claimed $THREE payment and the credit spend to the new row', async () => {
		const id = await withPaidGenerationScope(async () => {
			notePaidGeneration({ highPaymentId: PAY_ID, creditLedgerId: LEDGER });
			return createCreation(input);
		});
		expect(id).toBeTruthy();
		const claim = calls('update forge_high_redemptions');
		expect(claim).toHaveLength(1);
		expect(claim[0].slice(1)).toEqual([id, PAY_ID]);
		const spend = calls('update credit_ledger');
		expect(spend).toHaveLength(1);
		expect(spend[0].slice(1)).toContain(LEDGER);
	});

	it('binds the latest row when the submit fails over in-request', async () => {
		const [first, second] = await withPaidGenerationScope(async () => {
			notePaidGeneration({ highPaymentId: PAY_ID });
			return [await createCreation(input), await createCreation(input)];
		});
		const claim = calls('update forge_high_redemptions');
		expect(claim.map((c) => c[1])).toEqual([first, second]);
	});

	it('binds nothing for a free generation or a row that was never stored', async () => {
		await createCreation(input);
		await withPaidGenerationScope(() => createCreation(input));
		failInsert = true;
		await withPaidGenerationScope(async () => {
			notePaidGeneration({ highPaymentId: PAY_ID });
			return createCreation(input);
		});
		expect(calls('update forge_high_redemptions')).toHaveLength(0);
		expect(calls('update credit_ledger')).toHaveLength(0);
	});
});
