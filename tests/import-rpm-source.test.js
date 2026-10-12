import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createAvatarBody } from '../api/_lib/validate.js';

// Bug: pages/import-rpm.html posts `source: 'rpm_import'` (and falls back to
// the same literal) when saving an imported avatar, but POST /api/avatars'
// createAvatarBody schema only accepts a fixed enum of source values and
// does not include 'rpm_import'. Every import through this page's URL tab
// and file tab therefore 400s with invalid_enum_value at the final commit
// step (api/avatars/index.js's handleCreate -> parse(createWithStorage, raw)),
// after the GLB has already been fetched/canonicalized/uploaded to R2 --
// the user loses the upload and sees a generic "File uploaded but save
// failed" error. Reproduced directly against the real zod schema, no mocks.
describe('import-rpm.html sends a source value the create-avatar schema accepts', () => {
	const html = readFileSync(new URL('../pages/import-rpm.html', import.meta.url), 'utf8');

	it('every literal `source:` value used in the import flow validates against createAvatarBody', () => {
		const literals = [...html.matchAll(/\bsource:\s*'([^']+)'/g)].map((m) => m[1]);
		expect(literals.length).toBeGreaterThan(0);
		for (const value of literals) {
			expect(() => createAvatarBody.pick({ source: true }).parse({ source: value })).not.toThrow();
		}
	});
});
