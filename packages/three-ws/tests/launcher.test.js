import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${dir}package.json`, 'utf8'));
const cli = JSON.parse(readFileSync(`${dir}../three-ws-cli/package.json`, 'utf8'));

describe('three-ws launcher package', () => {
	it('is the unscoped name the 401 responses advertise', () => {
		expect(pkg.name).toBe('three-ws');
		expect(pkg.bin['three-ws']).toBe('./bin/three-ws.js');
	});
	it('pins the exact @three-ws/cli version in this repo', () => {
		expect(pkg.dependencies['@three-ws/cli']).toBe(cli.version);
	});
	it('ships only bin, README and LICENSE', () => {
		expect(pkg.files.sort()).toEqual(['LICENSE', 'README.md', 'bin']);
	});
	it('prints the CLI version through the launcher', () => {
		const out = execFileSync('node', [`${dir}bin/three-ws.js`, 'version'], { encoding: 'utf8' });
		expect(out).toMatch(/\d+\.\d+\.\d+/);
	});
});
