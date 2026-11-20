// Hunyuan3D 2.1's paint pass loads its multiview model with diffusers, naming the
// local hunyuanpaintpbr directory as a custom pipeline, in
// hy3dpaint/utils/multiview_utils.py. diffusers >= 0.35 refuses a custom
// pipeline directory that ships code unless trust_remote_code=True is passed,
// and the advisory bump to diffusers 0.38.0 (9b9183c94) took every texgen job
// down with "contains custom code in pipeline.py which must be executed"
// (model-hunyuan3d-21-rtx-00005, production, 2026-11-19). The directory is our
// own pinned clone baked into the image, so the image must patch upstream's call
// to trust it, and fail the build if upstream's line moves and the patch misses.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'workers', 'model-hunyuan3d');
const diffusers = readFileSync(join(DIR, 'requirements.hunyuan21.txt'), 'utf8').match(/^diffusers==(\d+)\.(\d+)/m);

function instructions(text) {
	return text.replace(/\\\n/g, ' ').split('\n');
}

describe('Hunyuan3D 2.1 images trust their own paint pipeline', () => {
	it('pins diffusers new enough to need the trust flag', () => {
		expect(diffusers).not.toBeNull();
		expect(Number(diffusers[1]) > 0 || Number(diffusers[2]) >= 35).toBe(true);
	});

	for (const file of ['Dockerfile.hunyuan21', 'Dockerfile.hunyuan21rtx']) {
		const lines = instructions(readFileSync(join(DIR, file), 'utf8'));
		const cloneAt = lines.findIndex((l) => /git clone [^\n]*Hunyuan3D-2\.1/.test(l));

		it(`${file} patches multiview_utils.py to pass trust_remote_code=True after the clone`, () => {
			const patchAt = lines.findIndex(
				(l) => /sed [^\n]*trust_remote_code=True[^\n]*hy3dpaint\/utils\/multiview_utils\.py/.test(l),
			);
			expect(cloneAt).toBeGreaterThanOrEqual(0);
			expect(patchAt, 'a RUN step must sed trust_remote_code=True into multiview_utils.py').toBeGreaterThan(cloneAt);
		});

		it(`${file} fails the build when the patch did not land`, () => {
			const gate = lines.some(
				(l) => /grep -q[^\n]*trust_remote_code=True[^\n]*multiview_utils\.py/.test(l),
			);
			expect(gate, 'a grep -q gate must assert the patched call exists').toBe(true);
		});
	}
});
