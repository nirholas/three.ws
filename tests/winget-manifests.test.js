// The ThreeWs.Agent winget manifests (distributions/winget/) must validate
// against the vendored winget 1.28.0 JSON schemas, sit at the winget-pkgs path,
// and carry exactly the hashes the release ledger records for the bytes in the
// public archive.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { MANIFEST_VERSION, PACKAGE_IDENTIFIER, manifestDir, manifestFileNames, wingetManifests } from '../distributions/winget/scripts/manifests.mjs';
import { compareSemver, installersFromLedger, writeManifests } from '../distributions/winget/scripts/generate-manifests.mjs';

const root = resolve(import.meta.dirname, '..');
const wingetDir = join(root, 'distributions', 'winget');
const schemaDir = join(wingetDir, 'schemas', MANIFEST_VERSION);
const ledger = JSON.parse(readFileSync(join(root, 'data', 'agent-cli-releases.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = {
	version: ajv.compile(JSON.parse(readFileSync(join(schemaDir, `manifest.version.${MANIFEST_VERSION}.json`), 'utf8'))),
	installer: ajv.compile(JSON.parse(readFileSync(join(schemaDir, `manifest.installer.${MANIFEST_VERSION}.json`), 'utf8'))),
	defaultLocale: ajv.compile(JSON.parse(readFileSync(join(schemaDir, `manifest.defaultLocale.${MANIFEST_VERSION}.json`), 'utf8'))),
};

function expectValid(kind, doc) {
	const ok = validators[kind](doc);
	expect(ok, `${kind}: ${JSON.stringify(validators[kind].errors, null, 2)}`).toBe(true);
}

const sample = {
	version: '0.2.0',
	releaseDate: '2026-11-16',
	installers: {
		x64: { url: 'https://storage.googleapis.com/three-ws-lib-releases/agent-cli/0.2.0/three-ws-agent-0.2.0-win-x64.zip', sha256: 'd'.repeat(64) },
		arm64: { url: 'https://storage.googleapis.com/three-ws-lib-releases/agent-cli/0.2.0/three-ws-agent-0.2.0-win-arm64.zip', sha256: 'e'.repeat(64) },
	},
};

const tmp = mkdtempSync(join(tmpdir(), 'winget-manifests-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('generated winget manifests', () => {
	it('validate against the vendored 1.28.0 schemas', () => {
		const m = wingetManifests(sample);
		for (const kind of Object.keys(validators)) expectValid(kind, m[kind]);
	});

	it('round-trip through the rendered YAML unchanged and still validate', () => {
		writeManifests(tmp, sample);
		const names = manifestFileNames();
		const m = wingetManifests(sample);
		for (const [kind, name] of Object.entries(names)) {
			const text = readFileSync(join(tmp, name), 'utf8');
			expect(text).toContain(`$schema=https://aka.ms/winget-manifest.${kind}.${MANIFEST_VERSION}.schema.json`);
			const doc = parse(text);
			expect(doc).toEqual(m[kind]);
			expectValid(kind, doc);
		}
	});

	it('install the nested portable exe under the three-ws-agent alias for both architectures', () => {
		const { installer } = wingetManifests(sample);
		expect(installer.InstallerType).toBe('zip');
		expect(installer.NestedInstallerType).toBe('portable');
		expect(installer.NestedInstallerFiles).toEqual([{ RelativeFilePath: 'three-ws-agent.exe', PortableCommandAlias: 'three-ws-agent' }]);
		expect(installer.Installers.map((i) => i.Architecture).sort()).toEqual(['arm64', 'x64']);
		for (const i of installer.Installers) expect(i.InstallerSha256).toMatch(/^[0-9A-F]{64}$/);
	});

	it('rejects a manifest the schema forbids', () => {
		const { installer } = wingetManifests(sample);
		expect(validators.installer({ ...installer, InstallerType: 'tarball' })).toBe(false);
		expect(validators.installer({ ...installer, Installers: [{ ...installer.Installers[0], InstallerSha256: 'abc' }] })).toBe(false);
	});

	it('use the winget-pkgs folder layout and file names', () => {
		expect(PACKAGE_IDENTIFIER).toBe('ThreeWs.Agent');
		expect(manifestDir('0.2.0')).toBe('manifests/t/ThreeWs/Agent/0.2.0');
		expect(manifestFileNames()).toEqual({
			version: 'ThreeWs.Agent.yaml',
			installer: 'ThreeWs.Agent.installer.yaml',
			defaultLocale: 'ThreeWs.Agent.locale.en-US.yaml',
		});
	});

	it('orders versions numerically', () => {
		expect(['0.10.0', '0.2.0', '0.9.1'].sort(compareSemver)).toEqual(['0.2.0', '0.9.1', '0.10.0']);
		expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
	});
});

describe('committed manifests match the release ledger', () => {
	const versions = Object.keys(ledger.releases);

	it('the ledger points at the public write-once archive', () => {
		expect(ledger.archive).toBe('https://storage.googleapis.com/three-ws-lib-releases/agent-cli');
	});

	it.each(versions.length ? versions : [null])('release %s has committed, valid manifests with the ledger hashes', (version) => {
		if (version === null) return;
		const dir = join(wingetDir, manifestDir(version));
		expect(existsSync(dir), `${dir} missing; run node distributions/winget/scripts/generate-manifests.mjs --version ${version}`).toBe(true);
		const names = manifestFileNames();
		expect(readdirSync(dir).sort()).toEqual(Object.values(names).sort());
		const docs = Object.fromEntries(Object.entries(names).map(([kind, name]) => [kind, parse(readFileSync(join(dir, name), 'utf8'))]));
		for (const [kind, doc] of Object.entries(docs)) expectValid(kind, doc);
		expect(docs).toEqual(wingetManifests(installersFromLedger(ledger, version)));
		const rel = ledger.releases[version];
		for (const inst of docs.installer.Installers) {
			const a = rel.artifacts[inst.Architecture];
			expect(inst.InstallerUrl).toBe(`${ledger.archive}/${version}/${a.file}`);
			expect(inst.InstallerSha256).toBe(a.sha256.toUpperCase());
		}
	});

	it('every committed manifest folder belongs to a released version', () => {
		const pkgDir = join(wingetDir, 'manifests', 't', 'ThreeWs', 'Agent');
		const committed = existsSync(pkgDir) ? readdirSync(pkgDir) : [];
		for (const v of committed) expect(versions, `${v} has manifests but no ledger entry`).toContain(v);
	});
});
