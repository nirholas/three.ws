/**
 * transformers 5.10.x cannot be imported on torch older than 2.7.
 *
 * transformers 5.10.1 through 5.10.4 run `_UE8M0_SF_DTYPE = torch.float8_e8m0fnu`
 * at module level in transformers/integrations/finegrained_fp8.py, and
 * modeling_utils.py imports that module unconditionally. torch.float8_e8m0fnu
 * first shipped in torch 2.7, so on an older torch every model import
 * (CLIPVisionModelWithProjection, AutoModel, anything built on PreTrainedModel)
 * dies with AttributeError. 5.11.0 moved the lookup into a function.
 *
 * The 2026-11-04 security sweep moved several torch 2.4-2.6 workers onto
 * 5.10.1 and the hunyuan3d build's import gate was the first place it surfaced.
 * Workers with no import gate build clean and crash on their first job, so this
 * checks the pins statically: any worker that pins torch < 2.7 must not pin
 * transformers 5.10.x.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKERS = join(ROOT, 'workers');

function pinFiles(dir) {
	return readdirSync(dir)
		.filter((name) => /^Dockerfile/.test(name) || /\.txt$/.test(name))
		.map((name) => join(dir, name))
		.filter((path) => statSync(path).isFile());
}

function versions(text, pkg) {
	const re = new RegExp(`^[^#\\n]*\\b${pkg}==(\\d+)\\.(\\d+)(?:\\.(\\d+))?`, 'gm');
	return [...text.matchAll(re)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]);
}

const older = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function workerPins() {
	return readdirSync(WORKERS)
		.map((name) => join(WORKERS, name))
		.filter((dir) => statSync(dir).isDirectory())
		.map((dir) => {
			const text = pinFiles(dir)
				.map((path) => readFileSync(path, 'utf8'))
				.join('\n');
			return { dir, torch: versions(text, 'torch'), transformers: versions(text, 'transformers') };
		});
}

describe('worker transformers pins match their torch', () => {
	it('parses pins from real worker files', () => {
		const pins = workerPins();
		expect(pins.some((p) => p.torch.length && p.transformers.length)).toBe(true);
	});

	it('never pairs transformers 5.10.x with torch older than 2.7', () => {
		const broken = workerPins()
			.filter((p) => p.torch.some((t) => older(t, [2, 7, 0]) < 0))
			.filter((p) => p.transformers.some(([maj, min]) => maj === 5 && min === 10))
			.map((p) => p.dir.slice(ROOT.length + 1));
		expect(broken).toEqual([]);
	});
});
