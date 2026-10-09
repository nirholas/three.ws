// GCP credit-program revert — proves the mechanism scripts/gcp/revert-to-free.sh
// relies on: every credit-funded GCP lane is gated purely by env vars, so REMOVING
// the gate var makes the resolver fall through to the pre-program provider. No code
// migration, no redeploy of logic — the same functions, different env.
//
// This is the code-level proof of the revert. A full live-preview flip additionally
// needs the owner's Vercel + GCP credentials (documented in docs/gcp-credits.md);
// this test locks the routing contract those creds ride on.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	resolveBackendId,
	backendIsConfigured,
	outputIsConfigured,
	freeLaneCandidates,
} from '../../api/_lib/forge-tiers.js';
import { isConfigured as imagenIsConfigured } from '../../api/_mcp3d/vertex-imagen.js';
import { resolveProviderName } from '../../api/_lib/regen-provider.js';
import {
	vertexClaudeEnabled,
	vertexClaudePrimary,
} from '../../api/_lib/vertex-claude.js';

// Every env var the revert touches, cleared between tests so each case sets only
// what it means to assert on.
const ALL = [
	'MODEL_TRELLIS_URL', 'GCP_HUNYUAN3D_URL', 'GCP_TRIPOSG_URL', 'GCP_REMESH_URL',
	'GCP_RECONSTRUCTION_URL', 'GCP_RECONSTRUCTION_KEY',
	'GCP_REMBG_URL', 'GCP_TEXTURE_URL', 'GCP_SEGMENT_URL',
	'GOOGLE_CLOUD_PROJECT', 'GCP_SERVICE_ACCOUNT_JSON',
	'VERTEX_CLAUDE_ENABLED', 'VERTEX_CLAUDE_PRIMARY',
	'NVIDIA_API_KEY', 'HF_TOKEN', 'REPLICATE_API_TOKEN', 'AVATAR_REGEN_PROVIDER',
];

let saved;
beforeEach(() => {
	saved = {};
	for (const k of ALL) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
	for (const k of ALL) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('forge image→3D: GCP self-host lane reverts to a free lane by unsetting its gate', () => {
	it('program ON — a photo→3D request resolves to the self-host TRELLIS worker', () => {
		// Self-host TRELLIS is gated by MODEL_TRELLIS_URL + GCP_RECONSTRUCTION_KEY.
		process.env.MODEL_TRELLIS_URL = 'https://model-trellis-abc.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.HF_TOKEN = 'hf_x'; // a free fallback also present, to prove precedence
		expect(backendIsConfigured('trellis_selfhost')).toBe(true);
		// A photo submission can't use the text-only NVIDIA lane, so the self-host
		// worker leads the free candidate ordering.
		const id = resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' });
		expect(id).toBe('trellis_selfhost');
	});

	it('program OFF — unsetting the gate demotes the lane and falls back to the free HF lane', () => {
		// Same request, GCP gate removed (what the revert does).
		delete process.env.MODEL_TRELLIS_URL;
		delete process.env.GCP_RECONSTRUCTION_KEY;
		process.env.HF_TOKEN = 'hf_x'; // the pre-program free image→3D lane
		expect(backendIsConfigured('trellis_selfhost')).toBe(false);
		const id = resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' });
		expect(id).toBe('huggingface');
		// And with no free lane at all, it degrades to the paid standing default —
		// never dead-ends.
		delete process.env.HF_TOKEN;
		expect(resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' })).toBe('trellis');
	});

	it('the Hunyuan3D and sketch/remesh gates flip the same way', () => {
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.GCP_HUNYUAN3D_URL = 'https://hy.run.app';
		process.env.GCP_TRIPOSG_URL = 'https://sg.run.app';
		process.env.GCP_REMESH_URL = 'https://rm.run.app';
		expect(backendIsConfigured('hunyuan3d')).toBe(true);
		expect(backendIsConfigured('triposg')).toBe(true);
		expect(outputIsConfigured('gameready')).toBe(true);
		for (const v of ['GCP_HUNYUAN3D_URL', 'GCP_TRIPOSG_URL', 'GCP_REMESH_URL', 'GCP_RECONSTRUCTION_KEY']) delete process.env[v];
		expect(backendIsConfigured('hunyuan3d')).toBe(false);
		expect(backendIsConfigured('triposg')).toBe(false);
		expect(outputIsConfigured('gameready')).toBe(false);
	});

	it('free-lane candidate ordering prefers self-host, then external free, when configured', () => {
		process.env.MODEL_TRELLIS_URL = 'https://t.run.app';
		process.env.GCP_HUNYUAN3D_URL = 'https://h.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.HF_TOKEN = 'hf_x';
		expect(freeLaneCandidates('image', 'standard', true, null, 'US')).toEqual(['trellis_selfhost', 'hunyuan3d', 'huggingface']);
		// Revert: only the external free lane survives.
		for (const v of ['MODEL_TRELLIS_URL', 'GCP_HUNYUAN3D_URL', 'GCP_RECONSTRUCTION_KEY']) delete process.env[v];
		expect(freeLaneCandidates('image', 'standard', true, null, 'US')).toEqual(['huggingface']);
	});
});

describe('avatar reconstruct/rerig: reverts GCP → Replicate → HF', () => {
	it('picks gcp when only GCP_RECONSTRUCTION_URL is set; falls to replicate/hf/none as the gate is pulled', () => {
		process.env.GCP_RECONSTRUCTION_URL = 'https://ctrl.run.app';
		expect(resolveProviderName()).toBe('gcp');
		// Revert with the recommended fallback present.
		delete process.env.GCP_RECONSTRUCTION_URL;
		process.env.REPLICATE_API_TOKEN = 'r8_x';
		expect(resolveProviderName()).toBe('replicate');
		delete process.env.REPLICATE_API_TOKEN;
		process.env.HF_TOKEN = 'hf_x';
		expect(resolveProviderName()).toBe('huggingface');
		// The pre-flight warning case: no fallback configured → 'none' (feature off).
		delete process.env.HF_TOKEN;
		expect(resolveProviderName()).toBe('none');
	});
});

describe('vertex claude chat lane: reverts by unsetting the VERTEX_CLAUDE_* flags', () => {
	it('enabled/primary require both the flag and GOOGLE_CLOUD_PROJECT; clear the flags to revert', () => {
		process.env.GOOGLE_CLOUD_PROJECT = 'three-ws-prod';
		process.env.VERTEX_CLAUDE_ENABLED = '1';
		process.env.VERTEX_CLAUDE_PRIMARY = '1';
		expect(vertexClaudeEnabled()).toBe(true);
		expect(vertexClaudePrimary()).toBe(true);
		// Revert step 1: demote from primary (leaves it available but not leading).
		delete process.env.VERTEX_CLAUDE_PRIMARY;
		expect(vertexClaudeEnabled()).toBe(true);
		expect(vertexClaudePrimary()).toBe(false);
		// Revert step 2: fully off — Vertex drops out of the chat provider ladder.
		delete process.env.VERTEX_CLAUDE_ENABLED;
		expect(vertexClaudeEnabled()).toBe(false);
		expect(vertexClaudePrimary()).toBe(false);
		// Config alone (project set, flags off) never enables the lane — the flag gates it.
		expect(vertexClaudeEnabled()).toBe(false);
	});
});

describe('imagen text→image: reverts to free NIM FLUX by unsetting GOOGLE_CLOUD_PROJECT', () => {
	it('isConfigured() flips with the project gate', () => {
		process.env.GOOGLE_CLOUD_PROJECT = 'three-ws-prod';
		expect(imagenIsConfigured()).toBe(true);
		delete process.env.GOOGLE_CLOUD_PROJECT;
		expect(imagenIsConfigured()).toBe(false);
	});
});
