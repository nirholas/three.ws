// Grok model ids live in exactly one place: GROK_MODELS in
// api/_lib/chat-models.js. xAI retires ids in batches, and every copy typed
// somewhere else is a copy that keeps calling a retired slug after the catalog
// moved on (that is how the platform's budget Grok sat on grok-4.1-fast for
// months after xAI retired it). This file fails the build when a Grok id shows
// up as a string literal in runtime code outside the catalog, and holds the
// catalog itself to the invariants its consumers rely on.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
	GROK_MODELS,
	GROK_CHAT_MODELS,
	GROK_MENU_MODELS,
	GROK_RETIRED_ALIASES,
	GROK_RETIRED_PRICES,
	GROK_DEFAULT_MODEL,
	GROK_BUDGET_MODEL,
	GROK_BUDGET_EXTRA_BODY,
	MODEL_CATALOG,
	PROVIDER_MODEL_DEFAULTS,
	resolveModelId,
	grokMenuModelId,
	routableGrokModelId,
} from '../api/_lib/chat-models.js';
import { modelPrice } from '../api/_lib/llm-pricing.js';

const ROOT = join(import.meta.dirname, '..');
const SCAN_DIRS = ['api', 'src', 'server'];
const SOURCE_OF_TRUTH = 'api/_lib/chat-models.js';
const CODE_FILE = /\.(m?js|ts|svelte)$/;
// A quoted Grok model slug, bare (`grok-4.3`) or OpenRouter-namespaced
// (`x-ai/grok-4.3`). `grok:` menu ids and the word "grok" are not slugs.
const GROK_LITERAL = /(['"`])(?:x-ai\/)?grok-(?:\d|build|code|beta|mini|vision)[^'"`\s]*\1/g;

function* codeFiles(dir) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
		const path = join(dir, name);
		const st = statSync(path);
		if (st.isDirectory()) yield* codeFiles(path);
		else if (CODE_FILE.test(name)) yield path;
	}
}

// Comment lines may name an id while explaining history; only code counts.
function isCommentLine(line) {
	const t = line.trimStart();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function findGrokLiterals(text) {
	const hits = [];
	text.split('\n').forEach((line, i) => {
		if (isCommentLine(line)) return;
		for (const m of line.matchAll(GROK_LITERAL)) hits.push({ line: i + 1, literal: m[0] });
	});
	return hits;
}

describe('Grok model ids have one source of truth', () => {
	it('no runtime file outside chat-models.js types a Grok id as a string literal', () => {
		const offenders = [];
		for (const dir of SCAN_DIRS) {
			for (const file of codeFiles(join(ROOT, dir))) {
				const rel = relative(ROOT, file);
				if (rel === SOURCE_OF_TRUTH) continue;
				for (const hit of findGrokLiterals(readFileSync(file, 'utf8'))) {
					offenders.push(`${rel}:${hit.line} ${hit.literal}`);
				}
			}
		}
		expect(offenders, `import the id from ${SOURCE_OF_TRUTH} instead`).toEqual([]);
	});

	it('the scanner catches bare, namespaced and template-quoted ids but not menu keys or comments', () => {
		const sample = [
			"const a = 'grok-4.7';",
			'const b = "x-ai/grok-4.3";',
			'const c = `grok-build-0.1`;',
			'const d = `grok:${id}`;',
			"// the old 'grok-4.1-fast' default",
			"const e = 'grok';",
		].join('\n');
		expect(findGrokLiterals(sample).map((h) => h.literal)).toEqual([
			"'grok-4.7'",
			'"x-ai/grok-4.3"',
			'`grok-build-0.1`',
		]);
	});
});

describe('GROK_MODELS catalog invariants', () => {
	it('ids are unique and every row carries the capability fields', () => {
		const ids = GROK_MODELS.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const m of GROK_MODELS) {
			expect(Number.isInteger(m.contextWindow) && m.contextWindow > 0, `${m.id} contextWindow`).toBe(true);
			expect(typeof m.tools, `${m.id} tools`).toBe('boolean');
			expect(typeof m.vision, `${m.id} vision`).toBe('boolean');
			expect(typeof m.reasoning, `${m.id} reasoning`).toBe('boolean');
			expect(Array.isArray(m.reasoningEfforts), `${m.id} reasoningEfforts`).toBe(true);
			expect(m.price).toHaveLength(2);
			expect(m.price.every((p) => typeof p === 'number' && p > 0), `${m.id} price`).toBe(true);
			expect(m.label && m.tier && m.description, `${m.id} menu text`).toBeTruthy();
		}
	});

	it('every chat-completions Grok is routable through MODEL_CATALOG and nothing else is', () => {
		const catalogGrok = Object.entries(MODEL_CATALOG)
			.filter(([, meta]) => meta.provider === 'grok')
			.map(([id]) => id);
		expect(catalogGrok.sort()).toEqual(GROK_CHAT_MODELS.map((m) => m.id).sort());
		for (const retired of Object.keys(GROK_RETIRED_ALIASES)) {
			expect(MODEL_CATALOG[retired], `${retired} is retired`).toBeUndefined();
		}
	});

	it('every retired slug resolves to a live chat model', () => {
		const live = new Set(GROK_CHAT_MODELS.map((m) => m.id));
		for (const [retired, successor] of Object.entries(GROK_RETIRED_ALIASES)) {
			expect(live.has(successor), `${retired} -> ${successor}`).toBe(true);
			expect(resolveModelId(retired)).toBe(successor);
			expect(routableGrokModelId(retired)).toBe(successor);
		}
	});

	it('every live model a menu omits names a menu model that replaces it', () => {
		const menu = new Set(GROK_MENU_MODELS.map((m) => m.id));
		for (const m of GROK_CHAT_MODELS.filter((x) => !x.menu)) {
			expect(menu.has(m.supersededBy), `${m.id} supersededBy ${m.supersededBy}`).toBe(true);
			expect(grokMenuModelId(m.id)).toBe(m.supersededBy);
		}
		for (const retired of Object.keys(GROK_RETIRED_ALIASES)) {
			expect(menu.has(grokMenuModelId(retired)), `${retired} reaches a menu model`).toBe(true);
		}
	});

	it('the default and budget models are live menu models, and the budget knob is one the model accepts', () => {
		const menu = new Set(GROK_MENU_MODELS.map((m) => m.id));
		expect(menu.has(GROK_DEFAULT_MODEL)).toBe(true);
		expect(menu.has(GROK_BUDGET_MODEL)).toBe(true);
		expect(PROVIDER_MODEL_DEFAULTS.grok).toBe(GROK_DEFAULT_MODEL);
		const budget = GROK_MODELS.find((m) => m.id === GROK_BUDGET_MODEL);
		expect(budget.reasoningEfforts).toContain(GROK_BUDGET_EXTRA_BODY.reasoning_effort);
	});

	it('a Responses-only model never reaches a chat-completions call; an unknown id passes through for BYOK', () => {
		const responsesOnly = GROK_MODELS.find((m) => !m.chatCompletions);
		expect(routableGrokModelId(responsesOnly.id, GROK_BUDGET_MODEL)).toBe(GROK_BUDGET_MODEL);
		expect(routableGrokModelId(null)).toBe(GROK_DEFAULT_MODEL);
		expect(routableGrokModelId('grok-99-preview')).toBe('grok-99-preview');
	});

	it('llm-pricing prices every live and retired Grok from the catalog', () => {
		for (const m of GROK_MODELS) expect(modelPrice(m.id)).toEqual([...m.price]);
		for (const [id, price] of Object.entries(GROK_RETIRED_PRICES)) expect(modelPrice(id)).toEqual([...price]);
	});
});
