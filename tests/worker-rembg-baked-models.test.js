// Every model another worker asks rembg-service for must already be in the
// image. rembg downloads a missing ONNX model on first use, and the 224 MB
// birefnet-general-lite came down at about 1 MB/s, so each fresh instance spent
// roughly two minutes on its first TripoSG matte. TripoSG gives the matte
// 120 s, so the first image-to-3D job on every new rembg instance failed with
// "matte did not finish within 120 s" (production, 2026-11-20). The Dockerfile
// had left birefnet lazy as "rarely asked for" while TripoSG asks for nothing
// else.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKERS = join(import.meta.dirname, '..', 'workers');
const dockerfile = readFileSync(join(WORKERS, 'rembg', 'Dockerfile'), 'utf8');

const baked = new Set(
	[...dockerfile.matchAll(/rembg\.new_session\(\s*['"]([\w.-]+)['"]\s*\)/g)].map((m) => m[1]),
);

function requestedModels() {
	const found = new Map();
	for (const dir of readdirSync(WORKERS)) {
		if (dir === 'rembg') continue;
		const root = join(WORKERS, dir);
		for (const file of ['cloudbuild.yaml', 'matte.py']) {
			const path = join(root, file);
			if (!existsSync(path)) continue;
			const text = readFileSync(path, 'utf8');
			if (!/REMBG_SERVICE_URL/.test(text) && file === 'cloudbuild.yaml') continue;
			for (const m of text.matchAll(/(?:REMBG_MODEL=|DEFAULT_MATTE_MODEL\s*=\s*['"])([\w.-]+)/g)) {
				found.set(m[1], `${dir}/${file}`);
			}
		}
	}
	return found;
}

describe('rembg-service bakes the models its callers request', () => {
	const requested = requestedModels();

	it('finds the callers', () => {
		expect(requested.size).toBeGreaterThan(0);
	});

	for (const [model, source] of requested) {
		it(`pre-caches ${model} (requested by ${source})`, () => {
			expect([...baked], `add rembg.new_session('${model}') to workers/rembg/Dockerfile`).toContain(model);
		});
	}
});
