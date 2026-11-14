// Groq retired llama-3.3-70b-versatile and llama-3.1-8b-instant (gone from
// GET /openai/v1/models, 404 on call, found 2026-11-14). Every surface that sent
// one of them straight to Groq failed: the embed proxy's second fallback rung,
// the marketplace and widget Groq lanes' default model, the BYOK assistant's
// Groq default, and the model pickers in the editor, avatar page, nich agent,
// /start and the dashboard brain library. Stored agent configs still carry the
// ids, so the alias tables that map them forward are the only place they may
// appear. Anything else is a request that can never answer.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RETIRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

// Files allowed to name a retired id, and why.
const ALLOWED = new Set([
	'api/_lib/chat-models.js', // RETIRED_MODEL_ALIASES (the /api/chat forward map)
	'api/llm/anthropic.js', // RETIRED_MODEL_IDS (the embed proxy forward map)
	'api/_lib/llm.js', // a measurement note about groq/compound-mini, no request
	'src/dashboard-next/pages/agents.js', // BRAIN_LABELS for stored retired ids
	'src/dashboard-next/pages/library/brain.js', // RETIRED_MODELS display map
]);

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
	}
	return out;
}

describe('retired Groq model ids', () => {
	it('appear in api/ and src/ only inside the forward-alias tables', () => {
		const offenders = [];
		for (const file of [...walk(join(ROOT, 'api')), ...walk(join(ROOT, 'src'))]) {
			const rel = relative(ROOT, file);
			if (ALLOWED.has(rel)) continue;
			const text = readFileSync(file, 'utf8');
			for (const id of RETIRED) if (text.includes(id)) offenders.push(`${rel}: ${id}`);
		}
		expect(offenders).toEqual([]);
	});
});
