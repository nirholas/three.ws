import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import semver from 'semver';

// The multiplayer image installs from multiplayer/package-lock.json with `npm ci`,
// and the browser client speaks the wire protocol of the colyseus.js version in the
// root package.json. A Dependabot bump that moves the server to a new Colyseus minor
// without the client builds an image that drops every player on join, and one that
// updates package.json without the standalone lock fails `npm ci` in Cloud Build.
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const server = json('../multiplayer/package.json');
const lock = json('../multiplayer/package-lock.json');
const root = json('../package.json');

const clientVersion = root.dependencies?.['colyseus.js'] ?? root.devDependencies?.['colyseus.js'];
const serverDeps = server.dependencies;

describe('multiplayer Colyseus pin', () => {
	it('runs the server on the same Colyseus minor the browser client speaks', () => {
		const client = semver.minVersion(clientVersion);
		const core = semver.minVersion(serverDeps['@colyseus/core']);
		expect(`${core.major}.${core.minor}`).toBe(`${client.major}.${client.minor}`);
	});

	it('keeps every @colyseus server package on that minor', () => {
		const client = semver.minVersion(clientVersion);
		const offMinor = Object.entries(serverDeps)
			.filter(([name]) => name.startsWith('@colyseus/') && name !== '@colyseus/schema')
			.filter(([, range]) => {
				const v = semver.minVersion(range);
				return v.major !== client.major || v.minor !== client.minor;
			})
			.map(([name, range]) => `${name}@${range}`);
		expect(offMinor).toEqual([]);
	});

	it('uses the schema major the client decodes with', () => {
		const clientSchema = lock.packages['node_modules/@colyseus/core']?.dependencies?.['@colyseus/schema'];
		const schema = semver.minVersion(serverDeps['@colyseus/schema']);
		expect(schema.major).toBe(3);
		if (clientSchema) expect(semver.satisfies(schema, clientSchema)).toBe(true);
	});

	it('resolves @colyseus/schema for the browser bundle to the version colyseus.js decodes with', () => {
		// packages/ar-studio/src/studio/schemas.js is bundled into the app. It
		// used to resolve through a schema 5 that the 0.18 server hoisted; with
		// nothing at the root, vite substitutes an empty optional-peer stub and
		// the build dies on "Schema is not exported" (2026-10-30).
		const pinned = root.dependencies?.['@colyseus/schema'];
		expect(pinned, 'root package.json must declare @colyseus/schema').toBeTruthy();
		const nested = JSON.parse(readFileSync(new URL('../node_modules/colyseus.js/package.json', import.meta.url), 'utf8'));
		expect(semver.satisfies(semver.minVersion(pinned), nested.dependencies['@colyseus/schema'])).toBe(true);
		const resolved = JSON.parse(readFileSync(new URL('../node_modules/@colyseus/schema/package.json', import.meta.url), 'utf8'));
		expect(semver.satisfies(resolved.version, pinned)).toBe(true);
	});

	it('has a standalone lock that satisfies package.json, so npm ci succeeds in the image', () => {
		const unsatisfied = Object.entries(serverDeps)
			.filter(([name, range]) => {
				const locked = lock.packages[`node_modules/${name}`]?.version;
				return !locked || !semver.satisfies(locked, range);
			})
			.map(([name, range]) => `${name}@${range} locked ${lock.packages[`node_modules/${name}`]?.version}`);
		expect(unsatisfied).toEqual([]);
	});
});
