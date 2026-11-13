import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// transformers 5.10.1 reads torch.float8_e8m0fnu at import time (integrations/finegrained_fp8.py),
// which first ships in torch 2.7.0. On torch 2.6.0 `from transformers import AutoImageProcessor`
// raises, and diffusers' DiffusionPipeline import chain dies with it, so the modly image's
// "triposg venv imports its model package" contract check failed in Cloud Build.
const read = (p) => readFileSync(new URL(`../workers/modly/${p}`, import.meta.url), 'utf8');
const ver = (s) => s.split('.').map(Number);
const atLeast = (a, b) => {
	const [x, y] = [ver(a), ver(b)];
	for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
	return true;
};

describe('modly image: torch and transformers pairing', () => {
	const dockerfile = read('Dockerfile');
	const torch = dockerfile.match(/pip install torch==([\d.]+) torchvision==([\d.]+)/);

	it('installs a pinned torch and torchvision pair', () => {
		expect(torch).not.toBeNull();
	});

	for (const file of ['requirements-triposg.txt', 'requirements-hunyuan.txt']) {
		it(`${file}: torch is new enough for the pinned transformers 5`, () => {
			const t = read(file).match(/^transformers==(\d+)\./m);
			if (!t || Number(t[1]) < 5) return;
			expect(atLeast(torch[1], '2.7.0')).toBe(true);
		});
	}

	it('torchvision matches the torch minor (0.22 for 2.7)', () => {
		const major = ver(torch[1])[1];
		expect(ver(torch[2])[1]).toBe(major + 15);
	});
});
