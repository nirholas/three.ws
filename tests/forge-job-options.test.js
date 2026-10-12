// Job -> output-options binding (api/_lib/forge-job-options.js). An async lane
// (Replicate/TRELLIS, Hunyuan3D, sketch, BYOK) completes in a later poll
// invocation that only has the job handle, so every submit-time choice that
// still matters at materialize time has to round-trip through this binding.
//
// Regression: bindJobToOptions recorded compression and derivePbr but silently
// dropped lods, so a caller who requested `lods: true` on an async lane never
// got an LOD variant: optionsForJob always resolved lods as undefined, and the
// poll handler's `boundOpts?.lods === true` check was permanently false.

import { describe, it, expect } from 'vitest';
import { bindJobToOptions, optionsForJob } from '../api/_lib/forge-job-options.js';

function fakeRedis() {
	const store = new Map();
	return {
		async set(key, value) {
			store.set(key, value);
		},
		async get(key) {
			return store.has(key) ? store.get(key) : null;
		},
	};
}

describe('forge-job-options: bindJobToOptions / optionsForJob', () => {
	it('round-trips an explicit lods:true request to the later poll invocation', async () => {
		const redis = fakeRedis();
		await bindJobToOptions('job-1', { lods: true }, { redis });
		const bound = await optionsForJob('job-1', { redis });
		expect(bound).toEqual({ lods: true });
	});

	it('round-trips compression, derivePbr:false, and lods together', async () => {
		const redis = fakeRedis();
		await bindJobToOptions('job-2', { compression: 'draco', derivePbr: false, lods: true }, { redis });
		const bound = await optionsForJob('job-2', { redis });
		expect(bound).toEqual({ compression: 'draco', derivePbr: false, lods: true });
	});

	it('does not bind anything when lods is absent or false and nothing else is non-default', async () => {
		const redis = fakeRedis();
		await bindJobToOptions('job-3', { lods: false }, { redis });
		expect(await optionsForJob('job-3', { redis })).toBeNull();
	});

	it('resolves null for an unbound job handle', async () => {
		const redis = fakeRedis();
		expect(await optionsForJob('never-bound', { redis })).toBeNull();
	});
});
