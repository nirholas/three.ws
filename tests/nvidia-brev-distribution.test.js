// The NVIDIA Brev Launchable (distributions/nvidia-brev). A stranger clicks one
// link and gets a GPU box running this image, so the pieces that cannot be
// exercised without a GPU are pinned here: the ports the Launchable exposes,
// the licence boundary (nothing non-commercial may ever enter the image), the
// pinned weights, and the shape of the notebook that ships with it.

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'distributions', 'nvidia-brev');
const read = (p) => readFileSync(join(DIR, p), 'utf8');

const dockerfile = read('Dockerfile');
const setup = read('setup.sh');
const launchable = read('LAUNCHABLE.md');
const licenses = read('LICENSES.md');
const requirements = read('image/requirements.txt');
const startSh = read('image/start.sh');
const weights = read('image/download_weights.py');

describe('nvidia brev distribution', () => {
	it('exposes the same two ports in the image, the setup script and the Launchable', () => {
		expect(dockerfile).toMatch(/^EXPOSE 8000 8888$/m);
		expect(setup).toContain('-p "$BIND:8000:8000"');
		expect(setup).toContain('-p "$BIND:8888:8888"');
		expect(startSh).toMatch(/--port[= ]8000/);
		expect(startSh).toContain("--port=8888");
		expect(launchable).toMatch(/\|\s*jupyter\s*\|\s*8888\s*\|/);
		expect(launchable).toMatch(/\|\s*studio\s*\|\s*8000\s*\|/);
	});

	it('binds to localhost unless the operator opts out', () => {
		expect(setup).toContain('BIND="${THREE_WS_BIND:-127.0.0.1}"');
	});

	it('never installs a non-commercial or research-only dependency', () => {
		// Comments may name what is excluded and why; only instructions count.
		const shipped = [dockerfile, requirements, weights]
			.join('\n')
			.split('\n')
			.filter((line) => !line.trim().startsWith('#'))
			.join('\n')
			.toLowerCase();
		for (const banned of [
			'nvdiffrast',
			'diff-gaussian',
			'diff_gaussian',
			'diffoctreerast',
			'trellis',
			'hunyuan',
			'stable-fast-3d',
		]) {
			expect(shipped, banned).not.toContain(banned);
		}
	});

	it('pins the TripoSR code and weights to the revisions the licence review covered', () => {
		const code = '107cefdc244c39106fa830359024f6a2f1c78871';
		const ckpt = '5b521936b01fbe1890f6f9baed0254ab6351c04a';
		expect(dockerfile).toContain(`TRIPOSR_COMMIT=${code}`);
		expect(weights).toContain(ckpt);
		expect(licenses).toContain(code);
		expect(licenses).toContain(ckpt);
	});

	it('ships the licence texts inside the image', () => {
		expect(dockerfile).toContain('COPY LICENSES.md /licenses/');
		expect(read('build.sh')).toContain('"$HERE/LICENSES.md"');
	});

	it('uses the same image reference in setup.sh and the Launchable', () => {
		const ref = setup.match(/THREE_WS_IMAGE:-([^}]+)\}/)[1];
		expect(ref).toMatch(/^us-docker\.pkg\.dev\/.+\/gpu-quickstart:\d+\.\d+\.\d+$/);
		expect(launchable).toContain(ref);
		const version = read('cloudbuild.yaml').match(/_VERSION: "([^"]+)"/)[1];
		expect(ref.endsWith(`:${version}`)).toBe(true);
	});

	it('keeps the scripts executable', () => {
		for (const p of ['setup.sh', 'build.sh', 'image/start.sh']) {
			expect(statSync(join(DIR, p)).mode & 0o111, p).not.toBe(0);
		}
	});

	it('ships a valid notebook with no stored outputs at the path the Launchable names', () => {
		const nb = JSON.parse(read('image/notebooks/three-ws-gpu-quickstart.ipynb'));
		expect(nb.nbformat).toBe(4);
		expect(launchable).toContain('/workspace/notebooks/three-ws-gpu-quickstart.ipynb');
		for (const cell of nb.cells) {
			if (cell.cell_type === 'code') expect(cell.outputs).toEqual([]);
		}
	});
});
