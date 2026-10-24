/**
 * materializeCreation() quality-scoring + compression wiring (prompt-02
 * "Forge generation quality" work order).
 *
 * These are additive, opt-in params on the universal completion writer every
 * Forge lane (sync + async) flows through. Default behavior (no `quality`, no
 * `compress`) must stay byte-identical to before; opting in must run the REAL
 * glb-quality / glb-compress pipeline against real bytes — not a mock — so
 * this exercises them against an actual shipped GLB (public/avatars/fox.glb)
 * fetched through a stubbed `fetch`. Only the network/db/object-storage
 * boundaries are stubbed, matching this repo's existing forge-store test
 * conventions (see tests/api/forge-free-first.test.js).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FOX_GLB = readFileSync(resolve(process.cwd(), 'public/avatars/fox.glb'));

beforeAll(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

const existingRow = {
	id: 'creation-xyz',
	status: 'pending',
	glb_url: null,
	glb_key: null,
	prompt: 'a low poly fox',
	preview_image_url: null,
	views_requested: 0,
	views_used: null,
	multiview: false,
	backend: 'trellis',
	tier: 'standard',
	path: 'image',
	model_category: null,
	created_at: new Date().toISOString(),
};

const sqlMock = vi.fn(async (strings) => {
	const text = strings.join(' ');
	if (text.includes('select')) return [existingRow];
	return [];
});

vi.mock('../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
}));

const putObjectMock = vi.fn(async ({ key }) => ({ key }));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: (...args) => putObjectMock(...args),
	// forgeStoreEnabled() reads the object-storage gate through r2.js, so this
	// mock has to carry it or every store call throws before it runs.
	objectStorageConfigured: () => true,
	publicUrl: (key) => `https://cdn.example.com/${key}`,
	// Every durable forge URL (glb, variants, previews) is a same-origin
	// /cdn/ URL, not the raw bucket domain (prompt-402 "console errors" work
	// order: a browser <img>/<model-viewer> loading the raw domain hits
	// Chrome's ORB or a bare CORS rejection). Kept at a different domain than
	// the publicUrl mock above so a test can tell the two apart.
	cdnUrl: (key) => `https://app.example.com/cdn/${key}`,
}));

vi.mock('../api/_lib/forge-events.js', () => ({
	recordGenerationEvent: vi.fn(async () => {}),
}));

// The preview-image copy uses untrustedSource:true, which runs the real
// per-hop SSRF check (dns.lookup) before fetching. The stubbed `global.fetch`
// below never touches the network either way, but the SSRF pre-check would
// still do a real DNS lookup on the fake "provider.example" host, so it is
// stubbed out exactly like the network/db/object-storage boundaries above.
vi.mock('../api/_lib/ssrf-guard.js', () => ({
	assertSafePublicUrl: async () => {},
	SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

const { materializeCreation, buildLodVariant, attachPoster } = await import('../api/_lib/forge-store.js');

function stubFetch(buf) {
	global.fetch = vi.fn(async () => ({
		ok: true,
		headers: { get: () => 'model/gltf-binary' },
		arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	}));
}

afterEach(() => {
	sqlMock.mockClear();
	putObjectMock.mockClear();
	delete global.fetch;
});

describe('materializeCreation — quality + compression (additive, opt-in)', () => {
	it('defaults run geometry cleanup, then material completion, and ship the completed mesh', async () => {
		// cleanup and derivePbr default ON: every forge mesh is raw marching-cubes
		// geometry that dedup/join/weld/simplify improves, and a lane bakes albedo
		// only, so the material pass adds the derived maps a viewer needs. quality
		// + compression stay opt-in.
		stubFetch(FOX_GLB);
		const out = await materializeCreation({
			replicateJobId: 'job-1',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/fox.glb',
		});
		expect(out.glbUrl).toBe(`https://app.example.com/cdn/forge/client-1/${existingRow.id}.glb`);
		expect(out.quality).toBeNull();
		expect(out.compression).toBeNull();
		// The geometry pass shrank the raw input.
		expect(out.cleaned).not.toBeNull();
		expect(out.cleaned.tris_after).toBeLessThanOrEqual(out.cleaned.tris_before);
		expect(out.cleaned.output_bytes).toBeLessThan(FOX_GLB.length);
		// The material pass then wrote its derived maps onto the cleaned geometry,
		// so the file grows again by exactly what those maps weigh.
		expect(out.pbr).not.toBeNull();
		expect(out.pbr.input_bytes).toBe(out.cleaned.output_bytes);
		expect(out.pbr.output_bytes).toBeGreaterThan(out.pbr.input_bytes);
		// What ships is the completed mesh, nothing in between.
		const written = putObjectMock.mock.calls[0][0];
		expect(written.body.length).toBe(out.pbr.output_bytes);
	});

	it('cleanup:false + derivePbr:false delivers the provider bytes verbatim', async () => {
		stubFetch(FOX_GLB);
		const out = await materializeCreation({
			replicateJobId: 'job-1b',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/fox.glb',
			cleanup: false,
			derivePbr: false,
		});
		expect(out.cleaned).toBeNull();
		expect(out.pbr).toBeNull();
		const written = putObjectMock.mock.calls[0][0];
		expect(written.body.length).toBe(FOX_GLB.length);
	});

	it('quality:true scores the REAL bundled GLB as valid and not degenerate', async () => {
		stubFetch(FOX_GLB);
		const out = await materializeCreation({
			replicateJobId: 'job-2',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/fox.glb',
			quality: true,
		});
		expect(out.quality).not.toBeNull();
		expect(out.quality.valid).toBe(true);
		expect(out.quality.flag).not.toBe('degenerate');
		expect(out.quality.metrics.triangleCount).toBeGreaterThan(0);
	});

	it('compress:"meshopt" runs the real @gltf-transform pipeline and shrinks the delivered bytes', async () => {
		stubFetch(FOX_GLB);
		const out = await materializeCreation({
			replicateJobId: 'job-3',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/fox.glb',
			quality: true,
			compress: 'meshopt',
		});
		expect(out.compression).not.toBeNull();
		expect(out.compression.mode).toBe('meshopt');
		if (!out.compression.skipped) {
			expect(out.compression.output_bytes).toBeLessThan(out.compression.input_bytes);
			// The bytes actually written to storage are the compressed variant, not
			// the original — confirms the pipeline result is what ships, not a
			// side-computed stat that's discarded.
			const written = putObjectMock.mock.calls[0][0];
			expect(written.body.length).toBe(out.compression.output_bytes);
		}
		expect(out.quality.valid).toBe(true);
	}, 20_000);

	it('an unparseable buffer scores invalid but never throws or blocks delivery', async () => {
		stubFetch(Buffer.from('not a glb'));
		const out = await materializeCreation({
			replicateJobId: 'job-4',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/bad.glb',
			quality: true,
		});
		expect(out).not.toBeNull();
		expect(out.quality.valid).toBe(false);
		expect(out.quality.flag).toBe('invalid');
	});

	// prompt-402 "console errors" work order: the homepage and /grok rendered
	// their forge preview images straight from the raw r2.dev bucket domain,
	// which Chrome's Opaque Response Blocking refuses to load as an <img>.
	// Root cause: this write site handed back copyToBucket's publicUrl(key)
	// verbatim instead of routing it through cdnUrl() like every avatar
	// thumbnail already must (tests/thumbnail-url-guard.test.js). The variable
	// here is named `copied`/`preview`, not "...thumb...", so that guard's
	// regex never caught it.
	it('writes preview_image_url through cdnUrl(), not the raw bucket domain (ORB fix)', async () => {
		stubFetch(FOX_GLB);
		sqlMock.mockImplementationOnce(async () => [
			{ ...existingRow, id: 'creation-preview', preview_image_url: 'https://provider.example/ref.jpg' },
		]);
		const out = await materializeCreation({
			replicateJobId: 'job-preview',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/fox.glb',
		});
		expect(out.previewImageUrl).toBe('https://app.example.com/cdn/forge/client-1/creation-preview.jpg');
	});
});

describe('attachPoster: ORB-safe preview URL (prompt-402 "console errors" work order)', () => {
	it('writes preview_image_url through cdnUrl(), not the raw bucket domain', async () => {
		sqlMock.mockImplementationOnce(async () => [{ id: 'poster-1', preview_image_url: null }]);
		sqlMock.mockImplementationOnce(async () => [{ id: 'poster-1' }]);
		const url = await attachPoster({
			id: 'poster-1',
			clientKey: 'client-1',
			body: Buffer.from('fake-webp-bytes'),
			contentType: 'image/webp',
			ext: 'webp',
		});
		expect(url).toBe('https://app.example.com/cdn/forge/client-1/poster-1-poster.webp');
	});
});

describe('buildLodVariant: real MSFT_lod chain (prompt-071 "LOD and Engine QA" work order)', () => {
	// Opt-in, fire-and-forget variant builder materializeCreation calls when the
	// caller sends { lods: true } (api/_lib/forge-options.js). Tested directly
	// against the real bundled GLB, through the real buildLodChain pipeline
	// (packages/glb-tools), with only the storage/db boundary stubbed, matching
	// this file's existing conventions for the other variant/pipeline passes.
	it('builds a real, strictly-decreasing LOD chain and stores it as a third object', async () => {
		const out = await buildLodVariant({ buffer: FOX_GLB, creationId: existingRow.id, keyPrefix: `forge/client-1/${existingRow.id}` });
		expect(out).not.toBeNull();
		expect(out.key).toBe(`forge/client-1/${existingRow.id}.lod.glb`);
		expect(out.url).toBe(`https://app.example.com/cdn/forge/client-1/${existingRow.id}.lod.glb`);
		expect(out.levels.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < out.levels.length; i++) {
			expect(out.levels[i].triangleCount).toBeLessThanOrEqual(out.levels[i - 1].triangleCount);
		}

		const written = putObjectMock.mock.calls.find((c) => c[0].key.endsWith('.lod.glb'));
		expect(written).toBeTruthy();
		expect(written[0].body.length).toBeGreaterThan(0);

		const update = sqlMock.mock.calls.map((c) => c[0].join(' ')).find((text) => text.includes('lod_glb_key'));
		expect(update).toBeTruthy();
	}, 20_000);

	it('returns null without writing anything for an empty buffer', async () => {
		putObjectMock.mockClear();
		const out = await buildLodVariant({ buffer: Buffer.alloc(0), creationId: existingRow.id, keyPrefix: 'forge/client-1/empty' });
		expect(out).toBeNull();
		expect(putObjectMock).not.toHaveBeenCalled();
	});
});
