/**
 * The describe claim is a lease (attempts + 1). When the poster URLs cannot be
 * resolved at all (object storage not configured in the process running the
 * claim), the claim must give the leases back instead of leaving the rows
 * leased with a spent attempt: seen on 2026-11-11 when a backfill export ran
 * without S3_PUBLIC_DOMAIN and leased 2,000 rows it never exported.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
const responses = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...values) => {
		calls.push({ text: strings.join('$'), values });
		return responses.shift() ?? [];
	},
	isDbUnavailableError: () => false,
}));
vi.mock('../api/_lib/r2.js', () => ({
	normalizeStoredUrl: () => {
		throw new Error('Missing required env var: S3_PUBLIC_DOMAIN');
	},
}));

const { claimDescribeBatch } = await import('../api/_lib/creation-descriptions.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
	calls.length = 0;
	responses.length = 0;
});

describe('claimDescribeBatch', () => {
	it('releases every lease it took when poster URLs cannot be resolved, then rethrows', async () => {
		responses.push(
			[{ creation_id: A }],
			[{ creation_id: B }],
			[
				{ id: A, preview_image_url: 'https://cdn.example/a.jpg', glb_url: 'https://cdn.example/a.glb' },
				{ id: B, preview_image_url: null, glb_url: 'https://cdn.example/b.glb' },
			],
		);
		await expect(claimDescribeBatch({ limit: 2 })).rejects.toThrow(/S3_PUBLIC_DOMAIN/);
		const release = calls.at(-1);
		expect(release.text).toMatch(/attempts = greatest\(attempts - 1, 0\)/);
		expect(release.values).toContainEqual([A, B]);
	});
});
