// The CDN embed (dist-lib/agent-3d.js) loads livekit-client and vad-web (with its
// onnxruntime-web) from a pinned CDN URL instead of inlining them (see tests/lib-bundle-size.test.js).
// The app build bundles the installed copies, so a pin that drifts from the
// lockfile would run a different library version in embeds than everywhere
// else, and an onnxruntime-web JS that does not match the wasm we serve fails to load.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const locked = (pkg) => lock.packages[`node_modules/${pkg}`].version;
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('lib CDN pins match the lockfile', () => {
	it('livekit-client', () => {
		expect(src('src/runtime/livekit-voice.js')).toContain(`https://esm.sh/livekit-client@${locked('livekit-client')}'`);
	});
	it('@ricky0123/vad-web, with its onnxruntime-web dependency pinned to the installed copy', () => {
		expect(src('src/voice/vad.js')).toContain(
			`https://esm.sh/@ricky0123/vad-web@${locked('@ricky0123/vad-web')}?deps=onnxruntime-web@${locked('onnxruntime-web')}'`,
		);
	});
});
