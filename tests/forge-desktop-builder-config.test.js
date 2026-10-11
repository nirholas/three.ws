import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../apps/forge-desktop/electron-builder.config.cjs');

// electron-builder 26 rejects the whole config ("does not match the API schema")
// when these two settings sit where 25 accepted them, which fails every Forge
// build on Cloud Build and on a Mac before it packages anything.
describe('Forge electron-builder config (electron-builder 26 schema)', () => {
	it('sets the Windows publisher under signtoolOptions, not on win', () => {
		expect(config.win.publisherName).toBeUndefined();
		expect(config.win.signtoolOptions.publisherName).toBe('three.ws');
	});

	it('declares the Linux desktop entry fields under desktop.entry', () => {
		expect(config.linux.desktop.StartupWMClass).toBeUndefined();
		expect(config.linux.desktop.entry.StartupWMClass).toBe('three.ws Forge');
	});
});
