import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../apps/desktop/electron-builder.config.cjs');

// The Windows installers are built on Linux under wine (apps/desktop/cloudbuild.yaml).
// electron-builder's default native-module rebuild runs node-gyp for win32 there,
// and node-gyp refuses to cross-compile ("does not support cross-compiling native
// modules from source"), so the Windows step died on ws's optional bufferutil
// before packaging. The app's only native modules are those optional ws
// accelerators: N-API prebuilds that load under any Electron ABI, with a pure-JS
// fallback in ws when absent. Nothing needs rebuilding on any platform.
describe('three.ws Desktop electron-builder config', () => {
	it('skips the native rebuild so Windows can be built under wine', () => {
		expect(config.npmRebuild).toBe(false);
	});

	it('builds the NSIS installer and the portable exe for x64', () => {
		expect(config.win.target.map((t) => t.target)).toEqual(['nsis', 'portable']);
		expect(config.win.signtoolOptions.publisherName).toBe('three.ws');
	});
});
