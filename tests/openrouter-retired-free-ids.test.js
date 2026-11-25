// OpenRouter retired these `:free` routes with no notice (gone from
// GET /api/v1/models and 404 on call, found 2026-11-25). Each one took a rung
// out of production: the LLM chain's two alternate OpenRouter rungs and Kilo's
// Super rung answered 404 on every call, so a Groq burst fell straight through
// to an exhausted chain, the vision lane paid a dead round trip per image, and
// the "Nemotron 3 Super" entry in five model pickers could never answer.
//
// The free-model audit cron (api/cron/free-model-audit.js) exists to page ops
// the day this happens, but it only read MODEL_CATALOG, DEFAULT_FREE_MODEL and
// OPENROUTER_SIBLINGS, so the rungs that actually died were never audited. The
// last test below keeps every hardcoded `:free` literal in api/ inside its
// reach.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MODEL_CATALOG, resolveModelId } from '../api/_lib/chat-models.js';
import { collectHardcodedFreeIds } from '../api/cron/free-model-audit.js';
import { KILO_FREE_MODELS } from '../api/_lib/llm.js';

const ROOT = join(import.meta.dirname, '..');

const RETIRED = [
	'nvidia/nemotron-3-super-120b-a12b:free',
	'qwen/qwen3.8-27b:free',
	'minimax/minimax-m2.7:free',
	'inclusionai/ling-3.0-flash-fin:free',
	'inclusionai/ling-3.0-flash:free',
	'meta-llama/llama-3.1-8b-instruct:free',
	'google/gemini-2.0-flash-exp:free',
	'dots-studio/dots-3-note-preview:free',
];

// Files allowed to name a retired id, and why. Stored agent configs, saved
// embed policies and old chat sessions still carry these ids, so the tables
// that map them forward are the only place they may appear.
const ALLOWED = new Set([
	'api/_lib/chat-models.js', // RETIRED_MODEL_ALIASES (the /api/chat forward map)
	'api/llm/anthropic.js', // RETIRED_MODEL_IDS (the embed proxy forward map)
	'src/dashboard-next/pages/agents.js', // BRAIN_LABELS for stored retired ids
]);

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'migrations' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
	}
	return out;
}

const SOURCE_DIRS = ['api', 'src', join('chat', 'src')].map((d) => join(ROOT, d));

describe('retired OpenRouter :free ids', () => {
	it('appear in api/, src/ and chat/src/ only inside the forward-alias tables', () => {
		const offenders = [];
		for (const file of SOURCE_DIRS.flatMap((d) => walk(d))) {
			const rel = relative(ROOT, file);
			if (ALLOWED.has(rel)) continue;
			const text = readFileSync(file, 'utf8');
			for (const id of RETIRED) if (text.includes(id)) offenders.push(`${rel}: ${id}`);
		}
		expect(offenders).toEqual([]);
	});

	it('resolve forward to a model the catalog can serve', () => {
		const unresolved = RETIRED.filter((id) => {
			const live = resolveModelId(id);
			return live === id || !MODEL_CATALOG[live];
		});
		expect(unresolved).toEqual([]);
	});

	it('are no longer audited as live rungs', () => {
		const audited = new Set(collectHardcodedFreeIds().map((e) => e.id));
		expect(RETIRED.filter((id) => audited.has(id))).toEqual([]);
	});
});

describe('free-model audit coverage', () => {
	it('audits every OpenRouter :free literal hardcoded in api/', () => {
		// Kilo's `:free` pins are audited on the Kilo lane (auditCatalogLane).
		const audited = new Set([...collectHardcodedFreeIds().map((e) => e.id), ...KILO_FREE_MODELS]);
		const literal = /['"`]([a-z0-9][\w.-]*\/[\w.-]+:free)['"`]/g;
		const missing = [];
		for (const file of walk(join(ROOT, 'api'))) {
			const rel = relative(ROOT, file);
			const text = readFileSync(file, 'utf8');
			for (const [, id] of text.matchAll(literal)) {
				// Forward-alias keys are retired on purpose; auditing them would page forever.
				if (RETIRED.includes(id)) continue;
				if (!audited.has(id)) missing.push(`${rel}: ${id}`);
			}
		}
		expect([...new Set(missing)]).toEqual([]);
	});
});
