import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import semver from 'semver';

// The Teams meeting stage (src/microsoft-teams-stage/session.js) builds its
// container through @microsoft/live-share and registers a SharedMap imported
// straight from fluid-framework. Live Share 1.x is written against the Fluid 1.x
// runtime and declares it as a peer. The repo installs with legacy-peer-deps, so
// npm never refuses a Fluid major that breaks that peer: Dependabot PR #617
// (fluid-framework 1.4.0 -> 3.11.0) installed cleanly, yet Live Share could no
// longer load (it requires @fluidframework/common-utils, which Fluid 2+ dropped)
// and the stage would have mixed a 3.x SharedMap into a 1.x container.
// .github/dependabot.yml ignores those majors; this test is the backstop for a
// hand edit or a lockfile that drifts.
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const root = json('../package.json');
const lock = json('../package-lock.json').packages;

const liveShare = lock['node_modules/@microsoft/live-share'];
const declared = (name) => root.dependencies?.[name] ?? root.devDependencies?.[name];

describe('Teams stage Fluid pin', () => {
	it('locks a Live Share release that declares its Fluid peers', () => {
		expect(liveShare?.version, '@microsoft/live-share must be in package-lock.json').toBeTruthy();
		expect(liveShare.peerDependencies?.['fluid-framework']).toBeTruthy();
		expect(liveShare.peerDependencies?.['@fluidframework/azure-client']).toBeTruthy();
	});

	for (const name of ['fluid-framework', '@fluidframework/azure-client']) {
		it(`declares a ${name} range inside the Live Share peer range`, () => {
			const peer = liveShare.peerDependencies[name];
			const range = declared(name);
			expect(range, `package.json must declare ${name}`).toBeTruthy();
			expect(semver.subset(range, peer), `${name}@${range} must stay within Live Share's peer ${peer}`).toBe(true);
		});

		it(`locks ${name} at a version Live Share supports`, () => {
			const peer = liveShare.peerDependencies[name];
			const locked = lock[`node_modules/${name}`]?.version;
			expect(locked, `${name} must be locked at the root`).toBeTruthy();
			expect(semver.satisfies(locked, peer), `${name} locked at ${locked}, Live Share needs ${peer}`).toBe(true);
		});
	}
});
