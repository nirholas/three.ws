/**
 * Live Avatar Forge — pure frame/narration logic.
 *
 * Covers the stage→narration mapping, the prompt clamp to the TRELLIS
 * conditioning window, and the final-frame sidecar round-trip (build → parse)
 * that carries the generated GLB url from the forge driver to every viewer.
 * No network, no DOM — the real /api/forge call and GLB load live in callers.
 */

import { describe, it, expect } from 'vitest';
import {clampPrompt,
	validatePrompt,
	forgeStageNarration,
	buildForgeFrame,
	finalForgeFrame,
	parseForgeFrame,
	viewerLinkFor,
	sanitizeFrameMeta,
	TRELLIS_PROMPT_LIMIT, coldStartState, coldStartLabel } from '../src/shared/forge-frames.js';

describe('clampPrompt', () => {
	it('passes a short prompt through untouched', () => {
		const r = clampPrompt('a glossy white robot mascot');
		expect(r.trimmed).toBe(false);
		expect(r.prompt).toBe('a glossy white robot mascot');
	});

	it('collapses whitespace and trims', () => {
		const r = clampPrompt('   a   round\n robot   ');
		expect(r.prompt).toBe('a round robot');
		expect(r.trimmed).toBe(false);
	});

	it('trims an over-long prompt to the conditioning window on a word boundary', () => {
		const long = 'a friendly round robot mascot, glossy white plastic, big expressive blue eyes and tiny antennae';
		const r = clampPrompt(long);
		expect(r.trimmed).toBe(true);
		expect(r.prompt.length).toBeLessThanOrEqual(TRELLIS_PROMPT_LIMIT);
		// word boundary — no trailing partial word / space
		expect(r.prompt).not.toMatch(/\s$/);
		expect(long.startsWith(r.prompt)).toBe(true);
		expect(r.originalLength).toBe(long.length);
	});

	it('handles null / undefined safely', () => {
		expect(clampPrompt(null).prompt).toBe('');
		expect(clampPrompt(undefined).prompt).toBe('');
	});
});

describe('validatePrompt', () => {
	it('rejects too-short prompts', () => {
		expect(validatePrompt('ab').ok).toBe(false);
		expect(validatePrompt('   ').ok).toBe(false);
	});
	it('accepts a real prompt', () => {
		expect(validatePrompt('a red apple').ok).toBe(true);
	});
});

describe('forgeStageNarration', () => {
	it('narrates each real pipeline state distinctly', () => {
		const submitting = forgeStageNarration({ status: 'submitting' });
		const queued = forgeStageNarration({ status: 'queued', eta_seconds: 20 });
		const running = forgeStageNarration({ status: 'running' });
		const done = forgeStageNarration({ status: 'done' });
		const failed = forgeStageNarration({ status: 'failed' });
		for (const v of [submitting, queued, running, done, failed]) {
			expect(typeof v).toBe('string');
			expect(v.length).toBeGreaterThan(0);
		}
		expect(new Set([submitting, queued, running, done, failed]).size).toBe(5);
	});

	it('includes the ETA when the pipeline reports one', () => {
		expect(forgeStageNarration({ status: 'queued', eta_seconds: 18 })).toContain('18s');
		expect(forgeStageNarration({ status: 'queued' })).not.toContain('~');
	});

	it('falls back to a neutral line for unknown states', () => {
		expect(forgeStageNarration({ status: 'weird' })).toMatch(/forging/i);
		expect(forgeStageNarration({})).toMatch(/forging/i);
	});
});

describe('buildForgeFrame', () => {
	it('defaults to the analysis lane and omits empty meta', () => {
		const f = buildForgeFrame({ activity: 'hi' });
		expect(f).toEqual({ activity: 'hi', type: 'analysis' });
	});
	it('attaches meta when provided', () => {
		const f = buildForgeFrame({ activity: 'hi', meta: { kind: 'forge' } });
		expect(f.meta).toEqual({ kind: 'forge' });
	});
});

describe('finalForgeFrame ↔ parseForgeFrame round-trip', () => {
	it('packs the GLB url + viewer link into the sidecar and reads it back', () => {
		const frame = finalForgeFrame({
			prompt: 'a glossy white robot mascot',
			glbUrl: 'https://three.ws/cdn/forge/abc.glb',
			viewerUrl: 'https://three.ws/viewer?src=x',
			tier: 'draft',
			backend: 'nvidia',
			durable: true,
		});
		expect(frame.type).toBe('analysis');
		expect(frame.meta.kind).toBe('forge');

		const parsed = parseForgeFrame(frame);
		expect(parsed).not.toBeNull();
		expect(parsed.glbUrl).toBe('https://three.ws/cdn/forge/abc.glb');
		expect(parsed.viewerUrl).toBe('https://three.ws/viewer?src=x');
		expect(parsed.prompt).toBe('a glossy white robot mascot');
		expect(parsed.tier).toBe('draft');
		expect(parsed.backend).toBe('nvidia');
		expect(parsed.durable).toBe(true);
	});

	it('returns null for non-forge frames', () => {
		expect(parseForgeFrame({ activity: 'x', type: 'trade' })).toBeNull();
		expect(parseForgeFrame({ activity: 'x', meta: { kind: 'other' } })).toBeNull();
		expect(parseForgeFrame(null)).toBeNull();
	});

	it('rejects a sidecar whose GLB url is not http(s)', () => {
		const bad = { meta: { kind: 'forge', glbUrl: 'javascript:alert(1)', viewerUrl: '', prompt: 'x' } };
		expect(parseForgeFrame(bad)).toBeNull();
	});
});

describe('viewerLinkFor', () => {
	it('builds an encoded viewer link from an origin', () => {
		expect(viewerLinkFor('https://cdn/x y.glb', 'https://three.ws/')).toBe(
			'https://three.ws/viewer?src=https%3A%2F%2Fcdn%2Fx%20y.glb',
		);
	});
});

describe('sanitizeFrameMeta', () => {
	it('keeps a valid forge sidecar and caps lengths', () => {
		const out = sanitizeFrameMeta({
			kind: 'forge',
			glbUrl: 'https://three.ws/cdn/a.glb',
			viewerUrl: 'https://three.ws/viewer?src=a',
			prompt: 'x'.repeat(1000),
			tier: 'draft',
			backend: 'nvidia',
			durable: false,
			injected: 'should be dropped',
		});
		expect(out.glbUrl).toBe('https://three.ws/cdn/a.glb');
		expect(out.prompt.length).toBe(320);
		expect(out.tier).toBe('draft');
		expect('injected' in out).toBe(false);
	});

	it('returns null for non-forge or url-less meta', () => {
		expect(sanitizeFrameMeta(null)).toBeNull();
		expect(sanitizeFrameMeta({ kind: 'other' })).toBeNull();
		expect(sanitizeFrameMeta({ kind: 'forge', glbUrl: 'not-a-url' })).toBeNull();
	});
});

// ── cold-start state ─────────────────────────────────────────────────────────
//
// A queued job on a scale-to-zero GPU worker is waiting on a container boot, not
// behind other people's work. Four surfaces render that state (the homepage
// chamber, the Studio step list, the in-world prop forge, the MCP tool
// responses) and three of them had grown their own copy of this arithmetic, so
// it lives here once. Every value is read off a real /api/forge frame; nothing
// is timed locally, which is what stops a page resumed mid-generation from
// restarting the countdown at zero.
describe('coldStartState / coldStartLabel', () => {
	it('reports nothing for a frame the API did not flag as cold', () => {
		expect(coldStartState({ status: 'queued', eta_seconds: 120 })).toBeNull();
		expect(coldStartLabel({ status: 'running' })).toBeNull();
		expect(coldStartState()).toBeNull();
	});

	it('counts the remaining boot from the stated budget and the job age', () => {
		const c = coldStartState({ cold_start: true, cold_start_seconds: 75, elapsed_seconds: 20 });
		expect(c).toEqual({ budgetSeconds: 75, elapsedSeconds: 20, remainingSeconds: 55, pastBudget: false });
		expect(coldStartLabel({ cold_start: true, cold_start_seconds: 75, elapsed_seconds: 20 })).toBe(
			'Waking up a GPU: about 55s of boot left (20s in)',
		);
	});

	it('a boot past its budget says so instead of counting into negatives', () => {
		const c = coldStartState({ cold_start: true, cold_start_seconds: 75, elapsed_seconds: 200 });
		expect(c.remainingSeconds).toBeNull();
		expect(c.pastBudget).toBe(true);
		const label = coldStartLabel({ cold_start: true, cold_start_seconds: 75, elapsed_seconds: 200 });
		expect(label).toBe('Still waking the GPU (200s in)');
		expect(label).not.toMatch(/-\d+s/);
	});

	// The exact boundary: elapsed === budget is spent, not "0s left", because a
	// "about 0s of boot left" line reads as broken.
	it('treats a boot exactly at its budget as spent', () => {
		const c = coldStartState({ cold_start: true, cold_start_seconds: 75, elapsed_seconds: 75 });
		expect(c.remainingSeconds).toBeNull();
		expect(c.pastBudget).toBe(true);
	});

	it('names the state but promises no number when the lane states no budget', () => {
		expect(coldStartLabel({ cold_start: true })).toBe('Waking up a GPU');
		expect(coldStartLabel({ cold_start: true, cold_start_seconds: 60 })).toBe('Waking up a GPU (about 60s)');
	});

	// Number(null) is 0, which passes a bare `>= 0` check: a job of unknown age
	// would otherwise be reported as "0s in" on every frame.
	it('does not invent an age for a frame that carries none', () => {
		const c = coldStartState({ cold_start: true, cold_start_seconds: 75 });
		expect(c.elapsedSeconds).toBeNull();
		expect(c.remainingSeconds).toBeNull();
		expect(c.pastBudget).toBe(false);
		expect(coldStartLabel({ cold_start: true, cold_start_seconds: 75 })).not.toContain('0s in');
	});

	// Under 5s the age just flickers as the first polls land, so it is omitted.
	it('omits an age too small to mean anything', () => {
		expect(coldStartLabel({ cold_start: true, cold_start_seconds: 75, elapsed_seconds: 2 })).toBe(
			'Waking up a GPU: about 73s of boot left',
		);
	});
});
