// solana-mobile/scripts/publish.sh guards the dApp Store release. A dry run
// (DAPP_STORE_DRYRUN=1) must print the exact upload command with no side
// effects: no npm install into node_modules, no network fetch of the CLI. It
// must also refuse a versionCode already shipped from this machine, because
// the store rejects a reused code only after the release NFT is paid for.
//
// The script cds to its own parent, so each case runs a copy of the release
// tree (script, manifest, release notes, a built APK file) in a temp dir.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = join(__dirname, '..', 'solana-mobile');
const manifest = JSON.parse(readFileSync(join(src, 'twa', 'twa-manifest.json'), 'utf8'));
const API_KEY = 'dry-run-key-must-never-be-printed';

let root;

function run(extraEnv = {}) {
	const keypair = join(root, 'dry-keypair.json');
	writeFileSync(keypair, '');
	return spawnSync('bash', [join(root, 'scripts', 'publish.sh')], {
		encoding: 'utf8',
		env: {
			...process.env,
			DAPP_STORE_DRYRUN: '1',
			SOLANA_KEYPAIR: keypair,
			DAPP_STORE_API_KEY: API_KEY,
			// An empty offline npm cache makes any install attempt fail at once,
			// so a dry run that tries to install the CLI fails this test.
			npm_config_offline: 'true',
			npm_config_cache: join(root, 'npm-cache'),
			...extraEnv,
		},
		timeout: 60_000,
	});
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'seeker-publish-'));
	for (const dir of ['scripts', 'twa', 'publish/listing', 'build']) mkdirSync(join(root, dir), { recursive: true });
	copyFileSync(join(src, 'scripts', 'publish.sh'), join(root, 'scripts', 'publish.sh'));
	copyFileSync(join(src, 'twa', 'twa-manifest.json'), join(root, 'twa', 'twa-manifest.json'));
	copyFileSync(
		join(src, 'publish', 'listing', 'new-in-version.txt'),
		join(root, 'publish', 'listing', 'new-in-version.txt'),
	);
	writeFileSync(join(root, 'build', 'three-ws-release.apk'), 'apk');
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('solana-mobile publish.sh', () => {
	it('dry run prints the upload command for the built APK without installing the CLI', () => {
		const res = run();
		expect(res.stderr).not.toMatch(/npm error/);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain(`--apk-file ${join(root, 'build', 'three-ws-release.apk')}`);
		expect(res.stdout).toContain('--api-key-stdin');
		expect(res.stdout).toContain('dry run, nothing submitted');
		expect(res.stdout + res.stderr).not.toContain(API_KEY);
		expect(existsSync(join(root, 'node_modules'))).toBe(false);
	});

	it('refuses a versionCode already published from this machine', () => {
		writeFileSync(join(root, 'build', '.last-published-version-code'), `${manifest.appVersionCode}\n`);
		const res = run();
		expect(res.status).toBe(1);
		expect(res.stderr).toContain(`appVersionCode ${manifest.appVersionCode} was already published`);
	});
});
