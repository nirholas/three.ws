/**
 * Python GPU workers: does every image carry the sibling modules its code
 * imports?
 *
 * Each workers/<name>/Dockerfile COPYs its .py files by name. Adding a new
 * module (`from mesh_classify import classify_mesh` in main.py) and forgetting
 * the COPY line builds clean: the build-time suites import their own modules,
 * not main.py. The image then dies on boot with ModuleNotFoundError, which is
 * exactly how model-rig revision 00006 failed to start on 2026-11-04 (build
 * 36844b9f): main.py imported mesh_classify, the Dockerfile never copied it.
 *
 * So: for every .py file a Dockerfile copies, every top-level import that
 * names a sibling .py file in the same worker directory must be copied too.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKERS = join(ROOT, 'workers');

/** Join backslash continuations so one COPY instruction is one line. */
function instructions(dockerfile) {
	return readFileSync(dockerfile, 'utf8')
		.replace(/\\\r?\n/g, ' ')
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'));
}

/**
 * Source paths of every build-context COPY/ADD (multi-stage --from copies read
 * another image, not the worker directory, so they are skipped). Returns null
 * when the Dockerfile copies a whole directory, in which case every sibling
 * module ships and there is nothing to check.
 */
function copiedSources(dockerfile, workerDir) {
	const out = new Set();
	for (const line of instructions(dockerfile)) {
		const m = /^(COPY|ADD)\s+(.*)$/i.exec(line);
		if (!m) continue;
		const args = m[2].split(/\s+/).filter((a) => !a.startsWith('--chown') && !a.startsWith('--chmod'));
		if (args.some((a) => a.startsWith('--from'))) continue;
		const sources = args.slice(0, -1);
		for (const src of sources) {
			const local = src.replace(/^\.\//, '');
			if (local === '.' || local === '' || local.includes('*')) return null;
			const onDisk = join(workerDir, local);
			if (existsSync(onDisk) && statSync(onDisk).isDirectory()) return null;
			out.add(basename(local));
		}
	}
	return out;
}

/** Top-level module names a Python file imports (`import a, b` and `from a import x`). */
function importedModules(pyFile) {
	const names = new Set();
	for (const raw of readFileSync(pyFile, 'utf8').split(/\r?\n/)) {
		const line = raw.replace(/#.*/, '');
		let m = /^\s*from\s+([A-Za-z_][\w]*)(?:\.[\w.]+)?\s+import\b/.exec(line);
		if (m) {
			names.add(m[1]);
			continue;
		}
		m = /^\s*import\s+(.+)$/.exec(line);
		if (m) {
			for (const part of m[1].split(',')) {
				const name = part.trim().split(/\s+/)[0].split('.')[0];
				if (/^[A-Za-z_]\w*$/.test(name)) names.add(name);
			}
		}
	}
	return names;
}

function pythonWorkers() {
	return readdirSync(WORKERS)
		.map((name) => join(WORKERS, name))
		.filter((dir) => existsSync(join(dir, 'Dockerfile')))
		.filter((dir) => readdirSync(dir).some((f) => f.endsWith('.py')));
}

/** Sibling modules imported by a copied file but missing from the image. */
function missingModules(workerDir) {
	const copied = copiedSources(join(workerDir, 'Dockerfile'), workerDir);
	if (copied === null) return [];
	const missing = [];
	for (const file of copied) {
		if (!file.endsWith('.py')) continue;
		const path = join(workerDir, file);
		if (!existsSync(path)) continue;
		for (const mod of importedModules(path)) {
			if (!existsSync(join(workerDir, `${mod}.py`))) continue;
			if (!copied.has(`${mod}.py`)) missing.push(`${file} imports ${mod} but ${mod}.py is not copied`);
		}
	}
	return missing;
}

describe('python worker images carry every sibling module they import', () => {
	const workers = pythonWorkers();

	it('finds the python workers to check', () => {
		expect(workers.length).toBeGreaterThan(5);
		expect(workers.map((w) => basename(w))).toContain('rig');
	});

	for (const dir of workers) {
		it(`workers/${basename(dir)}`, () => {
			expect(missingModules(dir)).toEqual([]);
		});
	}
});
