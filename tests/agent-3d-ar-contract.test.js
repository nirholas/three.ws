/**
 * <agent-3d>'s model-viewer-compatible AR/variant/hotspot contract:
 * ar, ar-modes, ar-placement, ios-src, variant-name, poster, and the
 * slot="hotspot" camera-fly-to pattern (work order 073).
 *
 * src/viewer.js constructs a real WebGLRenderer, so booting the element for
 * real needs a browser (see tests/e2e/agent-3d-ar.spec.js for that). These
 * tests pin the wiring statically: the attributes are observed, every
 * attribute change reaches the right handler, and the public JS API mirrors
 * model-viewer's names so pages/ar.html's existing click handler keeps
 * working unmodified.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');

const element = read('../src/element.js');
const viewer = read('../src/viewer.js');
const sceneViewer = read('../src/ar/scene-viewer.js');

describe('agent-3d observed attributes', () => {
	it('observes every new AR/variant attribute', () => {
		for (const attr of ['poster', 'ar', 'ar-modes', 'ar-placement', 'ios-src', 'variant-name']) {
			expect(element).toContain(`'${attr}'`);
		}
	});

	it('routes ar/ar-modes/ar-placement/ios-src changes to _refreshAR', () => {
		expect(element).toMatch(/\['ar', 'ar-modes', 'ar-placement', 'ios-src'\].*_refreshAR/);
	});

	it('routes variant-name changes to _applyVariantName', () => {
		expect(element).toMatch(/name === 'variant-name'.*_applyVariantName/);
	});
});

describe('agent-3d public JS API mirrors model-viewer', () => {
	it('exposes canActivateAR and activateAR()', () => {
		expect(element).toContain('get canActivateAR()');
		expect(element).toContain('async activateAR()');
	});

	it('exposes availableVariants and a variantName accessor pair', () => {
		expect(element).toContain('get availableVariants()');
		expect(element).toContain('get variantName()');
		expect(element).toContain('set variantName(');
	});
});

describe('agent-3d variant wiring', () => {
	it('imports the KHR_materials_variants controller', () => {
		expect(element).toContain("from './khr-variants.js'");
	});

	it('builds the controller after the body loads and emits agent:variants-ready', () => {
		expect(element).toContain('_setupVariants(bytes, gltf, token)');
		expect(element).toContain('createVariantController(bytes, gltf)');
		expect(element).toContain("'agent:variants-ready'");
	});

	it('emits agent:variant-changed when variant-name is applied', () => {
		expect(element).toContain("'agent:variant-changed'");
	});
});

describe('agent-3d AR wiring', () => {
	it('imports the shared best-effort USDZ builder instead of duplicating it', () => {
		expect(element).toContain("from './usdz-animated.js'");
		expect(element).toContain('buildBestEffortArUsdz(');
	});

	it('only generates an on-device USDZ when ios-src was not already supplied', () => {
		expect(element).toMatch(/let usdzUrl = this\.getAttribute\('ios-src'\) \|\| null;[\s\S]{0,200}if \(!usdzUrl/);
	});

	it('emits agent:ar-status while generating and agent:ar-ready once armed', () => {
		expect(element).toContain("'agent:ar-status'");
		expect(element).toContain("'agent:ar-ready'");
	});

	it('cancels a stale AR/variant setup against a reboot via _bootToken', () => {
		expect(element).toContain('this._bootToken++');
		expect(element).toMatch(/if \(token !== this\._bootToken\) return;/);
	});

	it('revokes a generated USDZ object URL on teardown', () => {
		expect(element).toMatch(/_teardown\(\)\s*\{[\s\S]{0,400}URL\.revokeObjectURL\(this\._generatedUsdzUrl\)/);
	});
});

describe('agent-3d hotspot slot', () => {
	it('renders a real <slot name="hotspot"> over the stage', () => {
		expect(element).toContain("hotspotSlot.name = 'hotspot'");
	});

	it('projects each assigned hotspot element to screen space every frame', () => {
		expect(element).toContain('_updateHotspots()');
		expect(element).toContain('projectToScreen(worldPos)');
	});

	it('flies the camera to a saved orbit on hotspot click via data-camera-orbit', () => {
		expect(element).toContain('data-camera-orbit');
		expect(element).toContain('setCameraOrbit(');
	});
});

describe('Viewer AR surface (src/viewer.js)', () => {
	it('setARTarget accepts an ar-modes allow-list and ar-placement', () => {
		expect(viewer).toMatch(/setARTarget\(glbUrl, usdzUrl = null, \{ modes, placement \} = \{\}\)/);
	});

	it('exposes canActivateAR and activateAR() honoring the configured modes', () => {
		expect(viewer).toContain('get canActivateAR()');
		expect(viewer).toContain('async activateAR()');
		expect(viewer).toContain('this._arModes');
	});

	it('exposes setCameraOrbit() and projectToScreen() for hotspots', () => {
		expect(viewer).toContain('setCameraOrbit(thetaDeg, phiDeg, radius, target');
		expect(viewer).toContain('projectToScreen(worldPos)');
	});
});

describe('Scene Viewer wall placement (src/ar/scene-viewer.js)', () => {
	it('sets enable_vertical_placement only for wall placement', () => {
		expect(sceneViewer).toContain("placement === 'wall'");
		expect(sceneViewer).toContain('enable_vertical_placement');
	});
});
