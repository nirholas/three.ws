// The CDN embed (dist-lib/agent-3d.js, dist-lib/agent-3d.umd.cjs) is a single,
// self-contained file by design (vite.config.js's libConfig: no externals,
// inlineDynamicImports: true) so a <script type="module"> drop-in never fetches
// a second chunk. That setting also inlines any dynamic import() reachable from
// the entry, so a heavy optional dependency loaded lazily inside src/ (meant to
// stay a separate chunk/CDN fetch) gets baked into the single file instead.
//
// 2026-10-12: src/runtime/whisper-stt.js's on-device speech recognizer lazily
// imports '@huggingface/transformers', which pulls in onnxruntime-web's WebGPU
// bundle. inlineDynamicImports forced that whole graph into agent-3d.js, which
// bloated it from the documented ~600-900KB gzipped to 73MB raw (76MB over the
// wire), well past Cloud Run's response-size handling for HTTP/1.1 and
// identity-encoding clients: curl -H "Accept-Encoding: identity"
// https://three.ws/dist-lib/agent-3d.js returned a bare 500 in production.
//
// 2026-10-30: three 0.187's DRACOLoader and KTX2Loader resolve their default
// decoder URLs with `new URL('../libs/draco/...', import.meta.url)`. Vite's
// library mode inlines every such asset as a base64 data: URL, so about 2.8MB
// of Draco and Basis decoders (wasm and js, twice over for the glTF variant)
// were baked into the bundle even though every loader in src/ points at the
// hosted copies under /three/. That pushed agent-3d.js to 6.4MB.
//
// Skips when dist-lib/ has not been built locally (npm run build:lib:full),
// same convention as tests/helpers/dist-built.js.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB_JS = path.join(REPO_ROOT, 'dist-lib', 'agent-3d.js');
const LIB_UMD = path.join(REPO_ROOT, 'dist-lib', 'agent-3d.umd.cjs');

// Generous headroom over the documented ~600-900KB gzipped (raw is larger);
// 5MB catches a regression of this magnitude without being flaky on growth.
const MAX_BYTES = 5 * 1024 * 1024;

describe('lib bundle size (dist-lib/agent-3d.{js,umd.cjs})', () => {
	const hasBuild = existsSync(LIB_JS) && existsSync(LIB_UMD);
	const maybe = hasBuild ? it : it.skip;

	maybe('keeps the ES CDN embed free of bundled optional heavy dependencies', () => {
		const size = statSync(LIB_JS).size;
		expect(size).toBeLessThan(MAX_BYTES);
	});

	maybe('keeps the UMD CDN embed free of bundled optional heavy dependencies', () => {
		const size = statSync(LIB_UMD).size;
		expect(size).toBeLessThan(MAX_BYTES);
	});

	// The decoders are fetched from /three/{draco,basis}/ at runtime; none of
	// them belongs inside the embed as an inlined data: URL.
	for (const file of [LIB_JS, LIB_UMD]) {
		maybe(`does not inline the Draco or Basis decoders into ${path.basename(file)}`, () => {
			const code = readFileSync(file, 'utf8');
			// A Vite-inlined asset is the data: prefix followed directly by its payload.
			// three's zstd decoder builds `'data:application/wasm;base64,' + wasm` from
			// its own source string, which is expected and not matched here. Counted
			// rather than matched so a failure reports a number, not the bundle.
			const inlined = code.match(/data:(?:application\/wasm|text\/javascript);base64,[A-Za-z0-9+/]{64}/g) ?? [];
			expect(inlined.length).toBe(0);
		});
	}

	if (!hasBuild) {
		it.skip('dist-lib/ has not been built locally; run `npm run build:lib:full`', () => {});
	}
});
