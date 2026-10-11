// Tests for Anatomy (/anatomy): the spec normalizer, the streaming partial
// scanner the page draws from, the server's salvage path for cut-off model
// text, the writer's stream readers and degenerate-output guard, the opening
// cutaway axis, and the rotor line budget that keeps dense engines fluid.

import { describe, it, expect } from 'vitest';

import { normalizeSpec, extractSpecJson, specStats, AnatomySpecError, LIMITS } from '../src/anatomy/spec.js';
import { scanPartialSpec } from '../src/anatomy/stream.js';
import { buildShape } from '../src/anatomy/shapes.js';
import { openingSection } from '../src/anatomy/viewer.js';
import { parseSpecText } from '../api/_lib/anatomy/service.js';
import { isDegenerate, readChatStream, readAnthropicStream, writerRungs } from '../api/_lib/anatomy/writer.js';
import { SPEC_GUIDE, OUTPUT_RULES } from '../api/_lib/anatomy/guide.js';

const part = (id, extra = {}) => ({ id, name: id, shape: { type: 'box', size: [1, 1, 1] }, ...extra });

function body(chunks) {
	const enc = new TextEncoder();
	return new ReadableStream({
		start(c) {
			for (const ch of chunks) c.enqueue(enc.encode(ch));
			c.close();
		},
	});
}

describe('normalizeSpec', () => {
	it('keeps good parts and warns about bad ones instead of failing', () => {
		const { spec, warnings } = normalizeSpec({
			title: 'Pump',
			parts: [part('a'), part('b', { shape: { type: 'warpdrive' } }), 'junk'],
		});
		expect(spec.parts.map((p) => p.id)).toEqual(['a', 'b']);
		expect(spec.parts[1].shape.type).toBe('box');
		expect(warnings.some((w) => w.includes('warpdrive'))).toBe(true);
	});

	it('rejects a spec with nothing renderable', () => {
		expect(() => normalizeSpec({ title: 'x', parts: [] })).toThrow(AnatomySpecError);
		expect(() => normalizeSpec('nope')).toThrow(AnatomySpecError);
	});

	it('re-roots missing parents and breaks parent cycles', () => {
		const { spec } = normalizeSpec({
			parts: [part('a', { parent: 'b' }), part('b', { parent: 'a' }), part('c', { parent: 'ghost' })],
		});
		const byId = Object.fromEntries(spec.parts.map((p) => [p.id, p]));
		expect(byId.c.parent).toBeNull();
		expect(byId.a.parent === null || byId.b.parent === null).toBe(true);
	});

	it('clamps rotor blades and drops unknown step focus ids', () => {
		const { spec, warnings } = normalizeSpec({
			parts: [part('fan', { shape: { type: 'rotor', blades: 5000, radius: 2 } })],
			steps: [{ title: 'Spin', body: 'It spins.', focus: ['fan', 'nope'] }],
			view: { section: 'q' },
		});
		expect(spec.parts[0].shape.blades).toBe(LIMITS.rotorBlades);
		expect(spec.steps[0].focus).toEqual(['fan']);
		expect(spec.view.section).toBeNull();
		expect(warnings.some((w) => w.includes('nope'))).toBe(true);
	});

	it('counts repeated and moving instances', () => {
		const { spec } = normalizeSpec({
			parts: [part('a', { repeat: { count: 6, radial: { axis: 'y' } }, motion: { type: 'spin', axis: 'y', speed: 1 } }), part('b')],
		});
		const stats = specStats(spec);
		expect(stats.parts).toBe(2);
		expect(stats.instances).toBe(spec.parts[0].repeat.count + 1);
		expect(stats.moving).toBe(spec.parts[0].repeat.count);
	});
});

describe('extractSpecJson', () => {
	it('reads a fenced block or the outermost object', () => {
		expect(extractSpecJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(extractSpecJson('prose {"b":2} more')).toEqual({ b: 2 });
		expect(extractSpecJson('no json')).toBeNull();
	});
});

describe('scanPartialSpec', () => {
	it('returns every finished element while the text is still arriving', () => {
		const full = JSON.stringify({ title: 'Engine {v2}', parts: [part('a', { description: 'has } braces "and" quotes' }), part('b')] });
		const cut = full.slice(0, full.indexOf('"b"') + 5);
		const out = scanPartialSpec(cut);
		expect(out.title).toBe('Engine {v2}');
		expect(out.parts.map((p) => p.id)).toEqual(['a']);
		expect(scanPartialSpec(full).parts).toHaveLength(2);
	});

	it('never throws on garbage', () => {
		expect(scanPartialSpec('')).toEqual({ parts: [], effects: [], flows: [], steps: [] });
		expect(scanPartialSpec('{"parts":[{"id":')).toMatchObject({ parts: [] });
	});
});

describe('parseSpecText', () => {
	it('salvages the finished parts of a cut-off completion', () => {
		const parts = Array.from({ length: 14 }, (_, i) => part(`p${i}`));
		const text = JSON.stringify({ title: 'Cut', parts }).slice(0, -20);
		const out = parseSpecText(text);
		expect(out.salvaged).toBe(true);
		expect(out.spec.parts.length).toBeGreaterThan(0);
		expect(out.warnings[0]).toMatch(/ran out of room/);
	});

	it('throws when the model returned no spec', () => {
		expect(() => parseSpecText('I cannot do that.')).toThrow(/did not return a JSON spec/);
	});
});

describe('writer', () => {
	it('flags one character repeated forever, not ordinary JSON', () => {
		expect(isDegenerate('{"a":1}' + '!'.repeat(400))).toBe(true);
		expect(isDegenerate(JSON.stringify({ parts: Array.from({ length: 20 }, (_, i) => part(`p${i}`)) }))).toBe(false);
		expect(isDegenerate('!'.repeat(100))).toBe(false);
	});

	it('reads chat-completion deltas split across chunks', async () => {
		const seen = [];
		const out = await readChatStream(
			body([
				'data: {"choices":[{"delta":{"content":"{\\"ti"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"tle\\"}"},"finish_reason":"stop"}],',
				'"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
			]),
			(t) => seen.push(t),
		);
		expect(out.text).toBe('{"title"}');
		expect(seen).toEqual(['{"ti', 'tle"}']);
		expect(out.stopReason).toBe('stop');
		expect(out.usage).toEqual({ input: 7, output: 3 });
	});

	it('reads Anthropic message streams and surfaces stream errors', async () => {
		const ok = await readAnthropicStream(
			body([
				'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12}}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{}"}}\n\n',
				'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
			]),
			() => {},
		);
		expect(ok).toEqual({ text: '{}', usage: { input: 12, output: 2 }, stopReason: 'end_turn' });
		await expect(readAnthropicStream(body(['data: {"type":"error","error":{"message":"overloaded"}}\n\n']), () => {})).rejects.toThrow(/overloaded/);
	});

	it('only offers rungs whose credentials are configured', () => {
		expect(writerRungs({})).toEqual([]);
		const rungs = writerRungs({ NVIDIA_API_KEY: 'k', GOOGLE_CLOUD_PROJECT: 'p' });
		expect(rungs.every((r) => r.provider === 'nvidia')).toBe(true);
		expect(writerRungs({ GOOGLE_CLOUD_PROJECT: 'p', VERTEX_CLAUDE_ENABLED: '1' })[0].provider).toBe('vertex');
	});
});

describe('openingSection', () => {
	it('opens a long machine lengthwise instead of slicing across it', () => {
		expect(openingSection('x', { x: 11, y: 3, z: 3 })).toBe('z');
		expect(openingSection('z', { x: 3, y: 3, z: 11 })).toBe('x');
		expect(openingSection('y', { x: 2, y: 6, z: 2 })).toBe('z');
	});

	it('honours a cut across a short axis or a squat machine', () => {
		expect(openingSection('z', { x: 11, y: 3, z: 3 })).toBe('z');
		expect(openingSection('x', { x: 4, y: 3, z: 3 })).toBe('x');
		expect(openingSection(null, { x: 1, y: 1, z: 1 })).toBeNull();
		expect(openingSection('y', null)).toBe('y');
	});
});

describe('rotor line drawing', () => {
	const rotor = (blades) => normalizeSpec({ parts: [part('r', { shape: { type: 'rotor', axis: 'x', blades, radius: 1.4 } })] }).spec.parts[0].shape;
	const segments = (shape) => {
		const { fill, lines } = buildShape(shape);
		fill.dispose();
		return lines.length / 6;
	};

	it('draws each blade as an outline, not its triangle mesh', () => {
		// Wide blades: 5 segments on each edge, a tip and a root, plus two
		// 32-segment hub circles.
		expect(segments(rotor(12))).toBe(12 * 12 + 64);
	});

	it('keeps a dense compressor stage within a few hundred segments', () => {
		const n = segments(rotor(LIMITS.rotorBlades));
		// Dense stages drop to 3 segments per edge and hide the root.
		expect(n).toBe(LIMITS.rotorBlades * 7 + 64);
		expect(n).toBeLessThan(600);
	});
});

describe('guide', () => {
	it('documents every shape and effect the normalizer accepts', async () => {
		const { SHAPE_TYPES, EFFECT_TYPES, MOTION_TYPES } = await import('../src/anatomy/spec.js');
		for (const t of [...SHAPE_TYPES, ...EFFECT_TYPES, ...MOTION_TYPES]) expect(SPEC_GUIDE).toContain(t);
		expect(SPEC_GUIDE).toMatch(/opened with `"z"`/);
		expect(OUTPUT_RULES).toMatch(/title, subtitle, summary, view, parts/);
	});

	it('ships the same guide in the agent skill', async () => {
		const { readFileSync } = await import('node:fs');
		const { renderReference, REFERENCE_PATH } = await import('../scripts/build-anatomy-skill.mjs');
		expect(readFileSync(REFERENCE_PATH, 'utf8')).toBe(renderReference());
	});
});
