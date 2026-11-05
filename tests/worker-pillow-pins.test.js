// Pillow pins across the Python workers (order 725, docs/audit/python-deps-2026-09-07.md).
//
// Pillow decodes caller-supplied images in most GPU workers, and every release
// before 13.0.0 carries open OSV advisories in its decoders. A floor such as
// `Pillow>=10.3.0` lets pip resolve whatever another package in the image drags
// in, so the scan (scripts/check-deps.mjs) cannot see the version that ships and
// a rebuild can silently move it. Every Pillow line must therefore be an exact
// pin, at the newest release the worker's runtime can install:
//
// - Python 3.11+ workers: 13.0.0, the only release with no open advisory.
// - Python 3.10 workers: 12.3.0, the last line that still supports 3.10
//   (13.0.0 requires Python >= 3.11). Clearing the rest needs the 3.11 move.
// - model-sam3d-objects: 13.0.0 too. Upstream SAM 3D Objects installs
//   gradio==5.49.0, which declares pillow<12, but the worker overrides that cap
//   (see its requirements.txt) because gradio 5.49.0 builds Blocks under 13.0.0.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKERS = join(ROOT, 'workers');

const NEWEST = '13.0.0';
const NEWEST_FOR_PY310 = '12.3.0';
const HELD = {};

function pillowLines() {
	const out = [];
	for (const worker of readdirSync(WORKERS, { withFileTypes: true })) {
		if (!worker.isDirectory()) continue;
		const dir = join(WORKERS, worker.name);
		for (const file of readdirSync(dir)) {
			if (!/^(requirements|constraints)[\w.-]*\.txt$/.test(file)) continue;
			const lines = readFileSync(join(dir, file), 'utf8').split('\n');
			lines.forEach((raw, i) => {
				const line = raw.replace(/#.*/, '').trim();
				if (/^pillow\b/i.test(line)) out.push({ worker: worker.name, file, lineNo: i + 1, line });
			});
		}
	}
	return out;
}

function pythonMinor(worker) {
	const dockerfile = join(WORKERS, worker, 'Dockerfile');
	if (!existsSync(dockerfile)) return null;
	const text = readFileSync(dockerfile, 'utf8');
	const m = text.match(/python:?3\.(\d+)/) || text.match(/python3\.(\d+)/);
	return m ? Number(m[1]) : null;
}

const lines = pillowLines();

describe('worker Pillow pins', () => {
	it('finds the Pillow lines it is meant to guard', () => {
		expect(lines.length).toBeGreaterThanOrEqual(10);
	});

	it('pins every Pillow line exactly, with no floor or range', () => {
		const loose = lines
			.filter((l) => !/^pillow\s*==\s*[\d.]+$/i.test(l.line))
			.map((l) => `${l.worker}/${l.file}:${l.lineNo} ${l.line}`);
		expect(loose).toEqual([]);
	});

	it('pins the newest Pillow each worker runtime can install', () => {
		const stale = [];
		for (const l of lines) {
			const version = (l.line.match(/==\s*([\d.]+)/) || [])[1];
			const minor = pythonMinor(l.worker);
			const want = HELD[l.worker] || (minor === 10 ? NEWEST_FOR_PY310 : NEWEST);
			if (version !== want) stale.push(`${l.worker}/${l.file}:${l.lineNo} has ${l.line}, want Pillow==${want}`);
		}
		expect(stale).toEqual([]);
	});
});
