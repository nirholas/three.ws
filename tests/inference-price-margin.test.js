// The published three-ws/agent rate must clear what the costliest paid lane in
// the agent chain costs the platform, with margin. The chain routes free lanes
// first, but when every free lane is throttled a request lands on a paid one
// (the OpenAI nano lane, then the Vertex Gemini anchor), and a rate below that
// lane's list price sells those tokens at a loss on both the keyed credits path
// and the pay-per-request x402 path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerChain } from '../api/_lib/llm-tool-chain.js';
import { costMicroUsd, isFreeLane } from '../api/_lib/llm-pricing.js';
import { INFERENCE_MODEL_ROWS, INFERENCE_MIN_MARGIN } from '../api/_lib/pricing/inference-models.js';

const LANE_ENV = {
	GROQ_API_KEY: 'k',
	CEREBRAS_API_KEY: 'k',
	OPENROUTER_API_KEY: 'k',
	NVIDIA_API_KEY: 'k',
	SAMBANOVA_API_KEY: 'k',
	MISTRAL_API_KEY: 'k',
	ZAI_API_KEY: 'k',
	GEMINI_API_KEY: 'k',
	OPENAI_API_KEY: 'k',
	GOOGLE_CLOUD_PROJECT: 'synthetic-project',
};

let saved;
beforeEach(() => {
	saved = {};
	for (const [k, v] of Object.entries(LANE_ENV)) {
		saved[k] = process.env[k];
		process.env[k] = v;
	}
	saved.VERTEX_GEMINI_MODEL = process.env.VERTEX_GEMINI_MODEL;
	delete process.env.VERTEX_GEMINI_MODEL;
});
afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

function paidLanes() {
	return providerChain().filter((lane) => !isFreeLane(lane.name, lane.model));
}

function usdPerMtok(lane, side) {
	const micro = costMicroUsd({ provider: lane.name, model: lane.model, [side]: 1_000_000 });
	return micro == null ? null : micro / 1e6;
}

describe('three-ws/agent published rate', () => {
	it('sees the paid lanes of the full chain, including the Vertex anchor', () => {
		const names = paidLanes().map((l) => l.name);
		expect(names).toContain('vertex-gemini');
		expect(names).toContain('openai');
	});

	it('knows a list price for every paid lane, so the margin check is not vacuous', () => {
		for (const lane of paidLanes()) {
			expect(usdPerMtok(lane, 'input'), `${lane.name} ${lane.model} input`).not.toBeNull();
			expect(usdPerMtok(lane, 'output'), `${lane.name} ${lane.model} output`).not.toBeNull();
		}
	});

	it('clears the costliest paid lane by the published margin on input and output', () => {
		const row = INFERENCE_MODEL_ROWS.find((r) => r.id === 'three-ws/agent');
		expect(INFERENCE_MIN_MARGIN).toBeGreaterThan(0);
		for (const lane of paidLanes()) {
			const inCost = usdPerMtok(lane, 'input');
			const outCost = usdPerMtok(lane, 'output');
			expect(row.input_usd_per_mtok, `${lane.model} input ${inCost}`).toBeGreaterThanOrEqual(inCost * (1 + INFERENCE_MIN_MARGIN));
			expect(row.output_usd_per_mtok, `${lane.model} output ${outCost}`).toBeGreaterThanOrEqual(outCost * (1 + INFERENCE_MIN_MARGIN));
		}
	});
});
