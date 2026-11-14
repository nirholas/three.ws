// stage-weights.sh must request EVERY include pattern from HuggingFace.
//
// Regression for Cloud Build a7a81ea6 (2026-11-04): the script passed one
// `--include` flag per pattern to `huggingface-cli download`, whose parser
// declares `--include` with nargs="*" and the default store action, so a
// repeated flag keeps only the LAST value. Each repo fetched a single file
// (model_index.json, whisper-large-v3/model.safetensors) and the layout check
// failed with INCOMPLETE after the build had already been billed.
//
// The test runs the real script end to end against a local HuggingFace-shaped
// listing (HF_ENDPOINT) and a downloader stand-in on PATH/PYTHONPATH that
// materialises exactly what HuggingFace would send for the patterns it was
// given. It then checks the manifest the script writes: every file
// model_weights.py requires is staged, and the excluded multi-GB weights are not.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(WORKER, 'stage-weights.sh');

const BASE_REPO = 'meituan-longcat/LongCat-Video';
const AVATAR_REPO = 'meituan-longcat/LongCat-Video-Avatar-1.5';

// The required-file lists, read from the module the service itself checks.
const REQUIRED = JSON.parse(
	execFileSync(
		'python3',
		['-c', 'import json, model_weights as m; print(json.dumps({"base": m.BASE_REQUIRED, "avatar": m.AVATAR_REQUIRED}))'],
		{ cwd: WORKER, encoding: 'utf8' },
	),
);

// Files the avatar pipeline never loads; staging them would add ~105 GB.
const EXCLUDED = {
	[BASE_REPO]: ['dit/diffusion_pytorch_model-00001-of-00006.safetensors', 'lora/cfg_step_lora.safetensors'],
	[AVATAR_REPO]: [
		'base_model/diffusion_pytorch_model-00001-of-00006.safetensors',
		'whisper-large-v3/pytorch_model.bin',
		'assets/demo.mp4',
	],
};

const LISTING = {
	[BASE_REPO]: [
		'config.json',
		'model_index.json',
		...REQUIRED.base,
		'tokenizer/spiece.model',
		'text_encoder/model-00001-of-00005.safetensors',
		'text_encoder/model-00005-of-00005.safetensors',
		...EXCLUDED[BASE_REPO],
	],
	[AVATAR_REPO]: [
		'config.json',
		'model_index.json',
		...REQUIRED.avatar,
		'base_model_int8/quantized_model-00001-of-00004.safetensors',
		'whisper-large-v3/tokenizer.json',
		...EXCLUDED[AVATAR_REPO],
	],
};

// What HuggingFace does with a pattern list: fnmatch every repo file, write the hits.
const FAKE_HUB = `
import fnmatch, json, os, urllib.request
from pathlib import Path

def fetch(repo_id, local_dir, patterns):
    url = os.environ["HF_ENDPOINT"].rstrip("/") + f"/api/models/{repo_id}?blobs=true"
    with urllib.request.urlopen(url, timeout=10) as r:
        names = [s["rfilename"] for s in json.load(r)["siblings"]]
    for name in names:
        if patterns is None or any(fnmatch.fnmatch(name, p) for p in patterns):
            path = Path(local_dir) / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name)
    return str(local_dir)
`;

// huggingface_hub's Python API.
const FAKE_PKG = `
from _fake_hub import fetch

def snapshot_download(repo_id, *, local_dir, allow_patterns=None, **_kwargs):
    if isinstance(allow_patterns, str):
        allow_patterns = [allow_patterns]
    return fetch(repo_id, local_dir, allow_patterns)
`;

// huggingface-cli download, with the --include declaration of huggingface_hub
// 0.36.2 (verified 2026-11-14): nargs="*", default store action.
const FAKE_CLI = `#!/usr/bin/env python3
import argparse
from _fake_hub import fetch
p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="cmd")
d = sub.add_parser("download")
d.add_argument("repo_id")
d.add_argument("--local-dir")
d.add_argument("--include", nargs="*", type=str)
a = p.parse_args()
fetch(a.repo_id, a.local_dir, a.include)
`;

let server;
let endpoint;
let work;

beforeAll(async () => {
	server = createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		const repo = decodeURIComponent(url.pathname.replace(/^\/api\/models\//, ''));
		const names = LISTING[repo];
		if (!names) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ siblings: names.map((rfilename) => ({ rfilename, size: 1000 })) }));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	endpoint = `http://127.0.0.1:${server.address().port}`;

	work = mkdtempSync(join(tmpdir(), 'longcat-stage-'));
	mkdirSync(join(work, 'bin'));
	mkdirSync(join(work, 'lib', 'huggingface_hub'), { recursive: true });
	writeFileSync(join(work, 'lib', '_fake_hub.py'), FAKE_HUB);
	writeFileSync(join(work, 'lib', 'huggingface_hub', '__init__.py'), FAKE_PKG);
	writeFileSync(join(work, 'bin', 'huggingface-cli'), FAKE_CLI);
	chmodSync(join(work, 'bin', 'huggingface-cli'), 0o755);
});

afterAll(() => {
	server?.close();
	if (work) rmSync(work, { recursive: true, force: true });
});

// Async spawn: the listing server lives in this process, so a blocking spawn would deadlock.
function stage() {
	const dest = join(work, 'weights');
	rmSync(dest, { recursive: true, force: true });
	return new Promise((resolve) => {
		const child = spawn('bash', [SCRIPT, '--local-only'], {
			env: {
				...process.env,
				PATH: `${join(work, 'bin')}:${process.env.PATH}`,
				PYTHONPATH: join(work, 'lib'),
				HF_ENDPOINT: endpoint,
				LOCAL_DIR: dest,
			},
		});
		let out = '';
		child.stdout.on('data', (b) => (out += b));
		child.stderr.on('data', (b) => (out += b));
		child.on('close', (status) => {
			const manifestPath = join(dest, 'weights.sha256');
			const manifest = existsSync(manifestPath)
				? readFileSync(manifestPath, 'utf8')
						.trim()
						.split('\n')
						.map((line) => line.split(/\s+/)[1])
				: [];
			resolve({ status, out, manifest });
		});
	});
}

describe('stage-weights.sh', () => {
	it('stages every file model_weights.py requires, in one pass', async () => {
		const { status, out, manifest } = await stage();
		expect(out).not.toContain('INCOMPLETE');
		expect(status, out).toBe(0);
		const want = [
			...REQUIRED.base.map((p) => `LongCat-Video/${p}`),
			...REQUIRED.avatar.map((p) => `LongCat-Video-Avatar-1.5/${p}`),
		];
		for (const path of want) expect(manifest).toContain(path);
	}, 60_000);

	it('leaves out the weights the avatar pipeline never loads', async () => {
		const { status, out, manifest } = await stage();
		expect(status, out).toBe(0);
		for (const path of EXCLUDED[BASE_REPO]) expect(manifest).not.toContain(`LongCat-Video/${path}`);
		for (const path of EXCLUDED[AVATAR_REPO]) expect(manifest).not.toContain(`LongCat-Video-Avatar-1.5/${path}`);
	}, 60_000);

	it('resolves the listing through HF_ENDPOINT, the variable huggingface_hub itself honours', async () => {
		const { out } = await stage();
		expect(out).toContain(`${BASE_REPO}: `);
		expect(out).toContain(`${AVATAR_REPO}: `);
		expect(out).toMatch(/TOTAL: \d/);
	}, 60_000);
});
