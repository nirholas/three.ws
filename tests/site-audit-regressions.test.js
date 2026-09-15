import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('production page-audit regressions', () => {
	it('gives the standalone auto-rig demo resolvable Three.js imports', () => {
		const html = source('public/demos/agents/auto-rig.html');
		expect(html).toContain('<script type="importmap">');
		expect(html).toContain('"three": "https://esm.sh/three@0.184.0"');
		expect(html).toContain('"three/addons/": "https://esm.sh/three@0.184.0/examples/jsm/"');
	});

	it('loads the Meshopt-ready model-viewer release in the deploy preview', () => {
		const js = source('src/erc8004/register-ui.js');
		expect(js).toContain('/model-viewer/4.3.1/model-viewer.min.js');
		expect(js).not.toContain('/model-viewer/4.0.0/model-viewer.min.js');
	});

	it('marks only the intentional voice error preview as audit documentation', () => {
		const voice = source('src/voice-home.js');
		const audit = source('scripts/page-audit.mjs');
		expect(voice).toContain("if (state === STATES.ERROR) wrap.dataset.auditIntentionalError = ''");
		expect(audit).toContain('[data-audit-intentional-error]');
	});

	it('routes showcase registry images through the resilient image proxy', () => {
		const js = source('src/erc8004/showcase.js');
		expect(js).toContain("import { proxiedImageURL } from '../ipfs.js'");
		expect(js).toContain('proxiedImageURL(a.image');
	});
});
