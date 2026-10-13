/**
 * An R2 account that is not entitled (Cloudflare answers NotEntitled: "Please
 * enable R2 through the Cloudflare Dashboard") is a storage-infrastructure
 * fault, not a missing object. Production on 2026-10-13 answered a bare 502
 * for every avatar GLB because this shape skipped the public-domain failover.
 */
import { describe, it, expect } from 'vitest';
import { isStorageInfrastructureError } from '../api/_lib/r2.js';

describe('isStorageInfrastructureError, R2 not entitled', () => {
	it('classifies the SDK NotEntitled error as infrastructure', () => {
		const err = Object.assign(new Error('Please enable R2 through the Cloudflare Dashboard.'), {
			name: 'NotEntitled',
		});
		expect(isStorageInfrastructureError(err)).toBe(true);
	});

	it('still treats a missing object as the caller\'s problem', () => {
		const err = Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
		expect(isStorageInfrastructureError(err)).toBe(false);
	});
});
