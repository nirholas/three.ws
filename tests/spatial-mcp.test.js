import { describe, it, expect, vi, afterEach } from 'vitest';

import {
	SPATIAL_MCP_VERSION,
	buildSpatialArtifact,
	validateSpatialArtifact,
	isConformantSpatialArtifact,
} from '../api/_lib/spatial-mcp.js';
import { toolDefs as spatialDefs } from '../api/_mcp3d/tools/spatial.js';
import { dispatch as rawDispatch } from '../api/_mcp-studio/dispatch.js';
import { signedInDispatch } from './_helpers/studio-account.js';

// The creator tools need an account; these cases run past that gate.
const dispatch = signedInDispatch(rawDispatch);

const GLB = 'https://three.ws/cdn/creations/model.glb';

describe('buildSpatialArtifact', () => {
	it('produces a conformant artifact from just a glbUrl', () => {
		const a = buildSpatialArtifact({ glbUrl: GLB });
		expect(a.spatialMcpVersion).toBe(SPATIAL_MCP_VERSION);
		expect(a.kind).toBe('model');
		expect(a.scene.glbUrl).toBe(GLB);
		expect(a.scene.format).toBe('glb');
		expect(isConformantSpatialArtifact(a)).toBe(true);
	});

	it('omits optional blocks that were not provided (no empty scaffolding)', () => {
		const a = buildSpatialArtifact({ glbUrl: GLB });
		expect(a.animation).toBeUndefined();
		expect(a.persona).toBeUndefined();
		expect(a.ar).toBeUndefined();
		expect(a.meta).toBeUndefined();
	});

	it('adds animation hooks only when rigged/clips are present', () => {
		expect(buildSpatialArtifact({ glbUrl: GLB, rigged: true }).animation).toBeTruthy();
		expect(buildSpatialArtifact({ glbUrl: GLB, clips: ['idle'] }).animation.clips).toEqual(['idle']);
	});

	it('includes an AR block only when a real https AR asset is supplied', () => {
		expect(buildSpatialArtifact({ glbUrl: GLB, ar: { usdzUrl: 'http://x/m.usdz' } }).ar).toBeUndefined();
		const a = buildSpatialArtifact({ glbUrl: GLB, ar: { usdzUrl: 'https://three.ws/m.usdz' } });
		expect(a.ar.supported).toBe(true);
		expect(a.ar.usdzUrl).toBe('https://three.ws/m.usdz');
	});

	it('maps a persona id into a speakable hook', () => {
		expect(buildSpatialArtifact({ glbUrl: GLB, personaId: 'psn_1' }).persona).toEqual({ id: 'psn_1', speakable: true });
	});
});

describe('validateSpatialArtifact — rejects with actionable errors', () => {
	it('flags a non-object payload', () => {
		const r = validateSpatialArtifact('nope');
		expect(r.valid).toBe(false);
		expect(r.errors[0].message).toMatch(/JSON object/);
	});

	it('requires spatialMcpVersion, kind, and scene.glbUrl', () => {
		const r = validateSpatialArtifact({});
		expect(r.valid).toBe(false);
		const paths = r.errors.map((e) => e.path);
		expect(paths).toContain('spatialMcpVersion');
		expect(paths).toContain('kind');
		expect(paths).toContain('scene');
	});

	it('rejects a non-https glbUrl with a fix message', () => {
		const r = validateSpatialArtifact({ spatialMcpVersion: '0.1', kind: 'model', scene: { glbUrl: 'http://x/m.glb' } });
		expect(r.valid).toBe(false);
		const e = r.errors.find((x) => x.path === 'scene.glbUrl');
		expect(e.message).toMatch(/https/);
	});

	it('rejects an unknown version and unknown kind', () => {
		const rv = validateSpatialArtifact({ spatialMcpVersion: '9.9', kind: 'model', scene: { glbUrl: GLB } });
		expect(rv.errors.some((e) => e.path === 'spatialMcpVersion')).toBe(true);
		const rk = validateSpatialArtifact({ spatialMcpVersion: '0.1', kind: 'hologram', scene: { glbUrl: GLB } });
		expect(rk.errors.some((e) => e.path === 'kind')).toBe(true);
	});

	it('rejects ar.supported:true with no concrete asset', () => {
		const r = validateSpatialArtifact({ spatialMcpVersion: '0.1', kind: 'model', scene: { glbUrl: GLB, format: 'glb' }, ar: { supported: true } });
		expect(r.errors.some((e) => e.path === 'ar.supported')).toBe(true);
	});

	it('warns (not errors) on unknown top-level fields', () => {
		const r = validateSpatialArtifact({ spatialMcpVersion: '0.1', kind: 'model', scene: { glbUrl: GLB, format: 'glb' }, camera: { autoRotate: true }, wat: 1 });
		expect(r.valid).toBe(true);
		expect(r.warnings.some((w) => w.path === 'wat')).toBe(true);
	});

	it('accepts a fully-populated artifact', () => {
		const a = buildSpatialArtifact({
			glbUrl: GLB, kind: 'avatar', rigged: true, clips: ['idle', 'wave'],
			personaId: 'psn_9', ar: { usdzUrl: 'https://three.ws/m.usdz', launchUrl: 'https://three.ws/ar?x=1' },
			prompt: 'a knight', title: 'Knight', viewerUrl: 'https://three.ws/viewer?src=x',
		});
		expect(validateSpatialArtifact(a).valid).toBe(true);
	});
});

describe('validate_spatial_response tool', () => {
	const tool = spatialDefs.find((d) => d.name === 'validate_spatial_response');

	it('is a free, read-only tool with the correct annotations', () => {
		expect(tool).toBeTruthy();
		expect(tool.scope).toBeUndefined(); // free — no payment scope
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
	});

	it('returns valid:true with the spec version for a conformant artifact', async () => {
		const r = await tool.handler({ artifact: buildSpatialArtifact({ glbUrl: GLB }) });
		expect(r.structuredContent.valid).toBe(true);
		expect(r.structuredContent.specVersion).toBe(SPATIAL_MCP_VERSION);
		expect(r.content[0].text).toMatch(/Conformant/);
	});

	it('returns valid:false with actionable errors for a broken artifact', async () => {
		const r = await tool.handler({ artifact: { kind: 'model' } });
		expect(r.structuredContent.valid).toBe(false);
		expect(r.structuredContent.errors.length).toBeGreaterThan(0);
		expect(r.content[0].text).toMatch(/Fix these/);
	});

	it('carries no payment/coin surface in its definition', () => {
		const FORBIDDEN = /x402|payment|wallet|usdc|\$three|token|coin|price|\bpaid\b|onchain|web3|mint/i;
		expect(FORBIDDEN.test(JSON.stringify({ ...tool, handler: undefined }))).toBe(false);
	});
});

// The adoption invariant: every three.ws 3D generation tool emits a conformant
// spatial artifact. We drive the free studio dispatcher with a mocked /api/forge
// (synchronous done) and validate the real structuredContent.spatial it returns.
describe('all free-studio 3D tools emit conformant spatial artifacts', () => {
	afterEach(() => vi.restoreAllMocks());

	function mockForgeDone() {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ status: 'done', glb_url: GLB, job_id: 'J', creation_id: 'C', backend: 'x' }),
		}));
	}
	const auth = { userId: null, rateKey: '127.0.0.1', scope: '' };
	const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };
	const call = (name, args) =>
		dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, auth, req);

	const cases = [
		['forge_free', { prompt: 'a friendly robot mascot' }],
		['text_to_avatar', { prompt: 'a knight in armor' }],
		['mesh_forge', { prompt: 'a worn leather armchair' }],
		['rig_mesh', { glb_url: GLB }],
		['forge_avatar', { prompt: 'a wizard character' }],
	];

	for (const [name, args] of cases) {
		it(`${name} → conformant spatial artifact`, async () => {
			mockForgeDone();
			const r = await call(name, args);
			const spatial = r.result?.structuredContent?.spatial;
			expect(spatial, `${name} must emit structuredContent.spatial`).toBeTruthy();
			const v = validateSpatialArtifact(spatial);
			expect(v.valid, `${name} spatial errors: ${JSON.stringify(v.errors)}`).toBe(true);
		});
	}

	it('refine_model → conformant spatial artifact', async () => {
		mockForgeDone();
		const r = await call('refine_model', { glb_url: GLB, instruction: 'make it gold', parent_prompt: 'a robot' });
		const spatial = r.result?.structuredContent?.spatial;
		expect(spatial).toBeTruthy();
		expect(validateSpatialArtifact(spatial).valid).toBe(true);
	});
});
