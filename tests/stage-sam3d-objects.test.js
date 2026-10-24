import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, planCopies } from '../scripts/stage-sam3d-objects.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = resolve(ROOT, 'scripts/stage-sam3d-objects.mjs');

describe('stage-sam3d-objects', () => {
	it('refuses to stage until the SAM License is explicitly accepted', () => {
		const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH, HF_TOKEN: 'hf_x' } });
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/SAM License has not been accepted/);
		expect(r.stderr).toMatch(/huggingface\.co\/facebook\/sam-3d-objects/);
		expect(r.stdout).toMatch(/Trade Controls/);
	});

	it('refuses without a token even when the licence is accepted', () => {
		const r = spawnSync(process.execPath, [SCRIPT, '--accept-sam-license'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/HF_TOKEN is not set/);
	});

	it('parses options and rejects unknown or malformed ones', () => {
		const o = parseArgs(['--accept-sam-license', '--dry-run', '--bucket', 'b1'], { HF_TOKEN: 't' });
		expect(o).toMatchObject({ accept: true, dryRun: true, bucket: 'b1', prefix: 'sam3d-objects', token: 't' });
		expect(parseArgs([], {}).accept).toBe(false);
		expect(() => parseArgs(['--nope'])).toThrow(/unknown option/);
		expect(() => parseArgs(['--bucket'])).toThrow(/needs a value/);
		expect(() => parseArgs(['--bucket', 'a;rm -rf /'])).toThrow(/unexpected characters/);
	});

	it('plans only checkpoints and the licence, under hf/', () => {
		const plan = planCopies(
			[
				{ rfilename: '.gitattributes' },
				{ rfilename: 'README.md', size: 5 },
				{ rfilename: 'LICENSE', size: 10 },
				{ rfilename: 'doc/intro.png', size: 7 },
				{ rfilename: 'checkpoints/pipeline.yaml', size: 100 },
				{ rfilename: 'checkpoints/slat_generator.ckpt', size: 4000 },
			],
			'bk',
			'sam3d-objects',
		);
		expect(plan.map((p) => p.dest)).toEqual([
			'gs://bk/sam3d-objects/LICENSE',
			'gs://bk/sam3d-objects/hf/pipeline.yaml',
			'gs://bk/sam3d-objects/hf/slat_generator.ckpt',
		]);
	});

	it('fails loudly when upstream drops pipeline.yaml', () => {
		expect(() => planCopies([{ rfilename: 'checkpoints/a.ckpt', size: 1 }], 'bk', 'p')).toThrow(/pipeline\.yaml/);
	});
});

describe('workers/model-sam3d-objects build files', () => {
	const read = (f) => readFileSync(resolve(ROOT, 'workers/model-sam3d-objects', f), 'utf8');

	it('pins the build service account and a 32 GB+ GPU class', () => {
		const cb = read('cloudbuild.yaml');
		expect(cb).toMatch(/serviceAccount: projects\/aerial-vehicle-466722-p5\/serviceAccounts\/three-ws-build@/);
		expect(cb).toMatch(/_GPU_TYPE: nvidia-rtx-pro-6000/);
		expect(cb).not.toMatch(/nvidia-l4/);
	});

	it('pins upstream to a commit and gates the image on the tests', () => {
		const df = read('Dockerfile');
		expect(df).toMatch(/ARG SAM3D_COMMIT=[0-9a-f]{40}/);
		expect(df).toMatch(/pytest .*test_request_policy\.py.*test_scene_layout\.py/s);
		expect(df).toMatch(/test_app_contract\.py/);
	});

	it('copies every module the app imports into the image', () => {
		const df = read('Dockerfile');
		for (const f of ['main.py', 'pipeline.py', 'scene_layout.py', 'request_policy.py', 'worker_security.py', 'storage_backend.py']) {
			expect(df).toContain(f);
		}
	});
});
