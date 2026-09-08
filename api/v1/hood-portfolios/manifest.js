// POST /api/v1/hood-portfolios/manifest - canonicalise a manifest and return its hash.
//
// The hash a portfolio is published under is keccak256 of the CANONICAL
// serialisation: object keys sorted at every depth, no insignificant whitespace.
// `JSON.stringify` follows insertion order, so a document that has been round
// tripped through a client, a file, or a URL serialises differently from the one
// the generator produced and hashes to a different value.
//
// This endpoint is the shared referee. Anyone holding a manifest can ask what it
// commits to and check it against what is on-chain, without reimplementing the
// canonicalisation rules. It is a pure function: no storage, no chain reads,
// nothing recorded.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { canonicalise, manifestHash, MANIFEST_VERSION } from '../../_lib/hood-portfolios.js';

const MAX_BYTES = 256 * 1024;

export default defineEndpoint({
	name: 'v1.hood-portfolios.manifest',
	method: 'POST',
	auth: 'public',
	handler: async ({ res, body }) => {
		const manifest = body?.manifest ?? body;
		if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
			fail(400, 'bad_manifest', 'POST the manifest document as JSON, either bare or as { manifest }');
		}

		const canonical = canonicalise(manifest);
		if (canonical.length > MAX_BYTES) {
			fail(413, 'manifest_too_large', `a manifest must canonicalise to under ${MAX_BYTES} bytes`);
		}

		res.setHeader('Cache-Control', 'no-store');
		return {
			manifestHash: manifestHash(manifest),
			canonicalBytes: canonical.length,
			// Echoed so a caller can see exactly what was hashed rather than trusting
			// that their serialisation matched ours.
			canonical,
			expectedVersion: MANIFEST_VERSION,
			manifestVersion: manifest.version ?? null,
		};
	},
});
