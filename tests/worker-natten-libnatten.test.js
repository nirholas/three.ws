// Every GPU worker image that installs NATTEN must ship its CUDA kernels.
//
// natten 0.21's setup.py builds libnatten (the CUTLASS neighborhood-attention
// kernels) only when NATTEN_CUDA_ARCH is set or a CUDA device is visible. Cloud
// Build has no GPU, so a bare `pip install natten` silently produced a
// Python-only package, and every model-pixal3d job died after the sparse
// structure stage with "Can't run CUTLASS FNA; NATTEN was not built with
// libnatten" (production, 2026-11-15 and 2026-11-16). The image must pin the
// arch and refuse to build if the extension is missing.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKERS = join(import.meta.dirname, '..', 'workers');

const nattenDockerfiles = readdirSync(WORKERS)
	.map((dir) => join(WORKERS, dir, 'Dockerfile'))
	.filter((path) => existsSync(path) && /pip install[^\n]*\bnatten==/.test(readFileSync(path, 'utf8')));

// Joins backslash-continued lines so one RUN/ENV instruction is one string.
function instructions(text) {
	return text.replace(/\\\n/g, ' ').split('\n');
}

describe('NATTEN images build libnatten', () => {
	it('finds the NATTEN images', () => {
		expect(nattenDockerfiles.length).toBeGreaterThan(0);
	});

	for (const path of nattenDockerfiles) {
		const lines = instructions(readFileSync(path, 'utf8'));
		const installAt = lines.findIndex((l) => /pip install[^\n]*\bnatten==/.test(l));

		it(`${path.split('/workers/')[1]} pins NATTEN_CUDA_ARCH before installing natten`, () => {
			const archAt = lines.findIndex((l) => /\bNATTEN_CUDA_ARCH=["']?\d/.test(l));
			expect(archAt, 'NATTEN_CUDA_ARCH must be set (ENV or inline) for the natten build').toBeGreaterThanOrEqual(0);
			expect(archAt).toBeLessThanOrEqual(installAt);
		});

		it(`${path.split('/workers/')[1]} fails the build when libnatten is missing`, () => {
			const gate = lines.slice(installAt).some((l) => /natten\.libnatten/.test(l));
			expect(gate, 'a RUN step after the install must assert natten.libnatten exists').toBe(true);
		});
	}
});
