// The free chain must never call a NIM model NVIDIA has retired.
//
// nvidia/nemotron-3-super-120b-a12b reached end of life on 2026-10-03: every
// call now answers HTTP 410 "has reached its end of life ... and is no longer
// available" (measured by the /api/cron/nvidia-lane-probes probe 2026-11-16).
// chat-models.js moved its NIM default off it, but the lead NIM rung of the
// LLM free chain (one per nvapi key) still pinned it, so every chain walk that
// reached NVIDIA burned one 410 per key before landing on a live model.
//
// Retired ids are listed here with the date NVIDIA's 410 body gives, so a
// future re-pin back onto one fails loudly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const RETIRED_NIM_MODELS = Object.freeze({
	'nvidia/nemotron-3-super-120b-a12b': '2026-10-03',
	'nvidia/nemotron-3-nano-30b-a3b': '2026-09-10',
	'meta/llama-3.3-70b-instruct': '2026-08-26',
});

const ENV_KEYS = ['NVIDIA_API_KEY', 'NVIDIA_FALLBACK_KEYS'];
const saved = {};
let llm;

beforeEach(async () => {
	for (const k of ENV_KEYS) saved[k] = process.env[k];
	process.env.NVIDIA_API_KEY = 'nvapi-x';
	process.env.NVIDIA_FALLBACK_KEYS = 'nvapi-y';
	vi.resetModules();
	llm = await import('../../api/_lib/llm.js');
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('NIM pins in the free chain', () => {
	it('pins no retired NIM model', () => {
		for (const id of llm.NVIDIA_PINNED_MODELS) {
			expect(RETIRED_NIM_MODELS[id], `${id} retired on ${RETIRED_NIM_MODELS[id]}`).toBeUndefined();
		}
	});

	it('routes no direct NIM rung to a retired model, on any key', () => {
		const nim = llm.providerChain().filter((p) => String(p.url || '').includes('integrate.api.nvidia.com'));
		expect(nim.length).toBeGreaterThan(0);
		for (const p of nim) {
			expect(RETIRED_NIM_MODELS[p.model], `${p.name} calls ${p.model}`).toBeUndefined();
		}
	});

	it('still gives each nvapi key its own NIM rung', () => {
		const names = llm.providerChain().map((p) => p.name);
		expect(names).toContain('nvidia');
		expect(names).toContain('nvidia#2');
	});
});
