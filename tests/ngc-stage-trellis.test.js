// scripts/ngc-stage-trellis.sh pushes to NVIDIA's NGC staging repo. It must
// never contact docker, gcloud or NGC without the explicit --yes-push flag.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'ngc-stage-trellis.sh');
const DIGEST = `sha256:${'a'.repeat(64)}`;
let bin;
let marker;

function run(args, env = {}) {
	return spawnSync('bash', [SCRIPT, ...args], {
		encoding: 'utf8',
		env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
	});
}

beforeAll(() => {
	bin = mkdtempSync(join(tmpdir(), 'ngc-stub-'));
	marker = join(bin, 'contacted');
	for (const name of ['docker', 'gcloud']) {
		writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\n`);
		chmodSync(join(bin, name), 0o755);
	}
});

afterAll(() => {
	rmSync(bin, { recursive: true, force: true });
});

describe('ngc-stage-trellis.sh', () => {
	it('refuses to push without --yes-push and contacts nothing', () => {
		const r = run(['--org', 'acme', '--version', '1.0.0', '--digest', DIGEST], { NGC_API_KEY: 'k' });
		expect(r.status).toBe(2);
		expect(r.stdout).toContain('nvcr.io/acme/trellis-mesh-server:1.0.0');
		expect(existsSync(marker)).toBe(false);
	});

	it('rejects a malformed digest', () => {
		const r = run(['--org', 'acme', '--version', '1.0.0', '--digest', 'latest']);
		expect(r.status).toBe(64);
		expect(existsSync(marker)).toBe(false);
	});

	it('requires NGC_API_KEY even with --yes-push', () => {
		const r = run(['--org', 'acme', '--version', '1.0.0', '--digest', DIGEST, '--yes-push']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain('NGC_API_KEY');
		expect(existsSync(marker)).toBe(false);
	});
});
