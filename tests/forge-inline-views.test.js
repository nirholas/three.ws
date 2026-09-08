// backendAcceptsInlineViews in api/_lib/forge-tiers.js.
//
// The predicate that makes the object-storage failover safe. When the bucket
// refuses to park a synthesized reference view, _lib/image-persist.js hands back
// an inline data URI instead of throwing, and api/forge.js uses this to decide
// which lanes may receive it. Our own GPU workers declare
// `images: [data-uri|url, ...]` and base64-decode the payload directly
// (workers/model-{trellis,hunyuan3d,triposg}/main.py); every third-party
// reconstructor fetches a URL and would reject or mishandle inline bytes.
//
// A wrong answer here is not cosmetic: a false positive sends a multi-megabyte
// data URI to a vendor API, and a false negative refuses the only lanes still
// capable of delivering a mesh during a storage outage.

import { describe, it, expect } from 'vitest';
import { backendAcceptsInlineViews, BACKENDS } from '../api/_lib/forge-tiers.js';

describe('backendAcceptsInlineViews', () => {
	it('accepts every self-hosted worker lane', () => {
		for (const id of ['trellis_selfhost', 'hunyuan3d', 'triposg']) {
			expect(backendAcceptsInlineViews(id), id).toBe(true);
		}
	});

	it('refuses every third-party reconstructor', () => {
		for (const id of ['nvidia', 'huggingface', 'trellis', 'meshy', 'tripo', 'rodin', 'stability', 'replicate_byok']) {
			expect(backendAcceptsInlineViews(id), id).toBe(false);
		}
	});

	it('refuses an unknown or absent backend rather than assuming inline support', () => {
		expect(backendAcceptsInlineViews('does_not_exist')).toBe(false);
		expect(backendAcceptsInlineViews(undefined)).toBe(false);
		expect(backendAcceptsInlineViews(null)).toBe(false);
	});

	// The predicate is defined as "provider is our own gcp worker fleet". Pin that
	// to the registry so a backend added later is classified by its provider
	// rather than by anyone remembering to edit a hand-written list here.
	it('tracks the registry: exactly the gcp-provider backends accept inline views', () => {
		const gcp = Object.values(BACKENDS)
			.filter((b) => b?.provider === 'gcp')
			.map((b) => b.id);
		expect(gcp.length).toBeGreaterThan(0);
		for (const id of Object.keys(BACKENDS)) {
			expect(backendAcceptsInlineViews(id), id).toBe(gcp.includes(id));
		}
	});
});
