// Sculptor (capability bit 1) — the headline profession: a citizen that turns a
// task into a textured, rig-ready GLB and proves it with sha256(GLB). This is the
// verifiable 3D supply chain — text in, a real mesh out, a hash anyone can
// re-derive by re-downloading the GLB.
//
// Backed by @three-ws/forge over the public /api/forge endpoint, called as a
// platform job (platformJobHeaders: making a model needs an accountable caller). The
// free lane (NVIDIA NIM / HuggingFace) produces a real GLB; if it is unavailable
// or out of credits, forge throws and the citizen reports a real job failure —
// never a fabricated success. Same `run<Profession>` contract as work/fetcher.js.

import { createForge } from '../../../packages/forge/src/index.js';
import { buildWorkResult, storeDeliverable, httpBytes, jobPrompt, platformJobHeaders } from './_skills.js';

// A real creative brief when a dispatcher task doesn't carry one. Re-derivable
// per-citizen so the world isn't a row of identical meshes.
const DEFAULT_BRIEFS = [
	'a low-poly desert fox, stylized, game-ready',
	'a weathered brass key with ornate bow',
	'a small potted bonsai tree',
	'a hand-painted ceramic teapot',
	'a sci-fi cargo crate with panel detailing',
	'a medieval wooden treasure chest',
];

function briefFor(citizen, job) {
	const explicit = jobPrompt(job);
	if (explicit) return explicit;
	const seed = String(citizen?.agentIdHex || job?.taskPda || '0');
	let h = 0;
	for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return DEFAULT_BRIEFS[h % DEFAULT_BRIEFS.length];
}

export async function runSculptor({ cfg, citizen, job } = {}) {
	const apiBase = cfg?.apiBase || 'https://three.ws';
	const log = cfg?.log || (() => {});
	const prompt = briefFor(citizen, job);
	const tier = job?.tier || 'draft'; // free lane defaults to the fast draft tier

	log?.(`sculptor: forging GLB for "${prompt.slice(0, 80)}" (tier ${tier})`);

	const forge = createForge({ baseUrl: apiBase });
	let result;
	try {
		result = await forge.forge(prompt, {
			tier,
			path: 'image',
			headers: platformJobHeaders(),
			pollIntervalMs: 2500,
			timeoutMs: 240_000,
			onProgress: (j) => log?.(`sculptor: forge ${j.status}${j.backend ? ` via ${j.backend}` : ''}`),
		});
	} catch (err) {
		throw new Error(`sculptor: forge failed (${err?.code || 'error'}): ${err?.message || err}`);
	}
	if (!result?.glbUrl) throw new Error('sculptor: forge returned no GLB url');

	// Download the EXACT bytes the proof binds — re-downloading the deliverable
	// must reproduce this hash.
	const { bytes } = await httpBytes(apiBase, result.glbUrl);
	if (!bytes?.length) throw new Error('sculptor: forge GLB url returned 0 bytes');

	const deliverable = await storeDeliverable({
		profession: 'sculptor',
		ext: 'glb',
		contentType: 'model/gltf-binary',
		bytes,
		sourceUrl: result.glbUrl,
	});

	return buildWorkResult({
		profession: 'sculptor',
		citizen,
		deliverableUrl: deliverable.url,
		deliverableBytes: bytes,
		summary: `Sculpted "${prompt}" → ${bytes.length.toLocaleString()}-byte GLB (${result.backend || 'forge'}, ${result.tier || tier})`,
		meta: {
			prompt,
			backend: result.backend || null,
			tier: result.tier || tier,
			viewerUrl: result.viewerUrl || null,
			forgeGlbUrl: result.glbUrl,
			creationId: result.creationId || null,
			stored: deliverable.stored,
		},
	});
}

export default runSculptor;
