#!/usr/bin/env node
// Compare our Grok model catalog (GROK_MODELS in api/_lib/chat-models.js)
// with what xAI actually serves, and exit non-zero on drift.
//
// xAI ships new model ids often and retires old ones in batches. A retired id
// in our catalog turns the Grok rung of every failover chain into a guaranteed
// error; a new id we have not catalogued is a better or cheaper model nobody on
// the platform can pick. Prices drift too, and llm-pricing.js meters Grok spend
// from the catalog, so a stale price is a wrong spend ledger.
//
// Two sources, tried in this order:
//   api   GET https://api.x.ai/v1/models (ids, context, prices, reasoning
//         efforts, aliases) plus GET /v1/language-models (which of those are
//         chat models, and which take image input). Needs GROK_API_KEY or
//         XAI_API_KEY in the environment, .env or .env.local.
//   docs  xAI's public model docs: https://docs.x.ai/developers/models.md for
//         the id, context and price table, then one page per model under
//         https://docs.x.ai/developers/models/<id>.md for modalities, function
//         calling, reasoning efforts and aliases. Used when no key is set.
//
// Usage:
//   node scripts/check-xai-models.mjs                 # api with a key, else docs
//   node scripts/check-xai-models.mjs --source=docs   # force the public docs
//   node scripts/check-xai-models.mjs --source=api    # require the API
//   node scripts/check-xai-models.mjs --json          # machine-readable report
//
// Exit codes: 0 in sync, 1 drift found, 2 the source could not be read.
// The key is only ever sent to api.x.ai; it is never printed.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROK_MODELS, GROK_RETIRED_ALIASES, XAI_API_BASE } from '../api/_lib/chat-models.js';

const DOCS_BASE = 'https://docs.x.ai/developers';
const DOCS_MODELS = `${DOCS_BASE}/models.md`;
const TIMEOUT_MS = 20_000;
// xAI prices are integers in USD cents per 100M tokens; ours are USD per 1M.
const CENTS_PER_100M_TO_USD_PER_1M = 1 / 10_000;
// Media models share /v1/models with the chat models but are not ours to route.
const NON_CHAT_PREFIXES = ['grok-imagine', 'grok-voice', 'grok-tts', 'grok-stt'];

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const SOURCE = (argv.find((a) => a.startsWith('--source=')) || '--source=auto').split('=')[1];

if (argv.includes('--help') || argv.includes('-h')) {
	const header = readFileSync(new URL(import.meta.url), 'utf8').split('\n\n')[0].split('\n').slice(1);
	process.stdout.write(header.map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
	process.exit(0);
}
if (!['auto', 'api', 'docs'].includes(SOURCE)) {
	console.error(`unknown --source=${SOURCE} (use api, docs or auto)`);
	process.exit(2);
}

// A value already in the environment wins over the files, same as the other
// scripts that read .env and .env.local.
function loadEnvFiles() {
	for (const name of ['.env', '.env.local']) {
		const file = resolve(process.cwd(), name);
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/i);
			if (!m) continue;
			const value = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
			if (process.env[m[1]] == null || process.env[m[1]] === '') process.env[m[1]] = value;
		}
	}
}

async function fetchText(url, headers = {}) {
	const res = await fetch(url, { headers: { 'user-agent': 'three.ws check-xai-models', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	return res.text();
}

const isChatId = (id) => id.startsWith('grok-') && !NON_CHAT_PREFIXES.some((p) => id.startsWith(p));

// ── Source: the xAI API ─────────────────────────────────────────────────────

export function normalizeApiModels(modelsBody, languageBody) {
	const language = new Map((languageBody?.models || []).map((m) => [m.id, m]));
	const out = new Map();
	for (const m of modelsBody?.data || []) {
		if (!isChatId(m.id)) continue;
		const lang = language.get(m.id);
		if (language.size && !lang) continue; // not a chat or image-understanding model
		if (lang?.output_modalities && !lang.output_modalities.includes('text')) continue;
		const inP = m.prompt_text_token_price;
		const outP = m.completion_text_token_price;
		out.set(m.id, {
			id: m.id,
			contextWindow: m.context_length ?? null,
			price: inP != null && outP != null ? [inP * CENTS_PER_100M_TO_USD_PER_1M, outP * CENTS_PER_100M_TO_USD_PER_1M] : null,
			vision: lang?.input_modalities ? lang.input_modalities.includes('image') : null,
			tools: null, // the API does not report function calling
			reasoningEfforts: m.capabilities?.reasoning_effort ?? lang?.capabilities?.reasoning_effort ?? null,
			aliases: m.aliases || lang?.aliases || [],
		});
	}
	return out;
}

async function readApi(key) {
	const auth = { authorization: `Bearer ${key}` };
	const models = JSON.parse(await fetchText(`${XAI_API_BASE}/models`, auth));
	// The chat subset; a failure here only costs the vision comparison.
	const language = await fetchText(`${XAI_API_BASE}/language-models`, auth).then(JSON.parse).catch(() => null);
	return { label: `${XAI_API_BASE}/models + /language-models`, models: normalizeApiModels(models, language) };
}

// ── Source: xAI's public docs ───────────────────────────────────────────────

function parseTokens(text) {
	const m = String(text).trim().match(/^([\d.,]+)\s*([kKmM]?)/);
	if (!m) return null;
	const n = Number(m[1].replace(/,/g, ''));
	const unit = m[2].toLowerCase();
	return Math.round(unit === 'm' ? n * 1_000_000 : unit === 'k' ? n * 1000 : n);
}

const dollars = (cell) => Number(String(cell).replace(/[$,\s]/g, ''));

/** Rows of the "Text API Pricing" table: id, context, base [input, output]. */
export function parseDocsPricingTable(markdown) {
	const section = markdown.split(/^### /m).find((s) => s.startsWith('Text API Pricing'));
	if (!section) throw new Error('docs: no "Text API Pricing" table on the models page');
	const rows = new Map();
	for (const line of section.split('\n')) {
		const cells = line.split('|').map((c) => c.trim());
		if (cells.length < 6 || !cells[1].startsWith('grok-')) continue;
		const id = cells[1].split(/\s+/)[0];
		// A model with long-context pricing has two rows; the first is the base price.
		if (rows.has(id)) continue;
		rows.set(id, { id, contextWindow: parseTokens(cells[2]), price: [dollars(cells[3]), dollars(cells[5])] });
	}
	return rows;
}

/** Capability lines from one per-model docs page. */
export function parseDocsModelPage(markdown) {
	const field = (name) => markdown.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`))?.[1]?.trim() ?? null;
	const codes = (s) => (s ? [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]) : []);
	const modalities = field('Modalities');
	const context = field('Context window');
	const calling = field('Function calling');
	const efforts = field('Reasoning efforts \\(supported\\)');
	return {
		// "text, image → text": vision is image on the input side of the arrow.
		vision: modalities ? modalities.split('→')[0].includes('image') : null,
		contextWindow: context ? parseTokens(context) : null,
		tools: calling ? /^yes/i.test(calling) : null,
		reasoningEfforts: efforts ? codes(efforts) : [],
		aliases: codes(field('Aliases')),
	};
}

async function readDocs() {
	const table = parseDocsPricingTable(await fetchText(DOCS_MODELS));
	const models = new Map();
	await Promise.all(
		[...table.values()].map(async (row) => {
			const page = await fetchText(`${DOCS_BASE}/models/${row.id}.md`).then(parseDocsModelPage).catch(() => null);
			models.set(row.id, {
				id: row.id,
				contextWindow: page?.contextWindow ?? row.contextWindow,
				price: row.price,
				vision: page?.vision ?? null,
				tools: page?.tools ?? null,
				reasoningEfforts: page ? page.reasoningEfforts : null,
				aliases: page?.aliases ?? [],
			});
		}),
	);
	return { label: `${DOCS_MODELS} + ${DOCS_BASE}/models/<id>.md`, models };
}

// ── Compare ─────────────────────────────────────────────────────────────────

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function compareCatalog(ours, upstream) {
	const drift = [];
	const notes = [];
	const aliasOwner = new Map();
	for (const m of upstream.values()) for (const a of m.aliases || []) aliasOwner.set(a, m.id);

	for (const m of ours) {
		const up = upstream.get(m.id);
		if (!up) {
			const owner = aliasOwner.get(m.id);
			drift.push({
				id: m.id,
				kind: owner ? 'now-alias' : 'missing',
				detail: owner
					? `xAI now serves it as an alias of ${owner}: move it to GROK_RETIRED_ALIASES -> ${owner}`
					: 'xAI no longer lists it: retire it into GROK_RETIRED_ALIASES with its successor',
			});
			continue;
		}
		if (up.contextWindow != null && up.contextWindow !== m.contextWindow) {
			drift.push({ id: m.id, kind: 'context', detail: `contextWindow ours ${m.contextWindow}, xAI ${up.contextWindow}` });
		}
		if (up.price && (Math.abs(up.price[0] - m.price[0]) > 1e-9 || Math.abs(up.price[1] - m.price[1]) > 1e-9)) {
			drift.push({ id: m.id, kind: 'price', detail: `price ours [${m.price}], xAI [${up.price}] USD per 1M tokens` });
		}
		if (up.vision != null && up.vision !== m.vision) {
			drift.push({ id: m.id, kind: 'vision', detail: `vision ours ${m.vision}, xAI ${up.vision}` });
		}
		if (up.tools != null && up.tools !== m.tools) {
			drift.push({ id: m.id, kind: 'tools', detail: `tools ours ${m.tools}, xAI ${up.tools}` });
		}
		if (up.reasoningEfforts && !sameSet(up.reasoningEfforts, [...m.reasoningEfforts])) {
			drift.push({
				id: m.id,
				kind: 'reasoning-efforts',
				detail: `reasoningEfforts ours [${m.reasoningEfforts}], xAI [${up.reasoningEfforts}]`,
			});
		}
	}

	const ourIds = new Set(ours.map((m) => m.id));
	for (const up of upstream.values()) {
		if (ourIds.has(up.id)) continue;
		if (GROK_RETIRED_ALIASES[up.id]) {
			notes.push({ id: up.id, detail: `still listed by xAI, mapped by us to ${GROK_RETIRED_ALIASES[up.id]}` });
			continue;
		}
		drift.push({ id: up.id, kind: 'new', detail: `new xAI model (context ${up.contextWindow ?? '?'}, price [${up.price ?? '?'}]): add it to GROK_MODELS` });
	}
	return { drift, notes };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
	loadEnvFiles();
	const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
	if (SOURCE === 'api' && !key) {
		console.error('--source=api needs GROK_API_KEY or XAI_API_KEY (environment, .env or .env.local)');
		return 2;
	}
	const useApi = SOURCE === 'api' || (SOURCE === 'auto' && key);

	let source;
	try {
		source = useApi ? await readApi(key) : await readDocs();
	} catch (err) {
		console.error(`could not read the xAI model list: ${err.message}`);
		return 2;
	}
	if (!source.models.size) {
		console.error(`the xAI model list at ${source.label} parsed to zero chat models; the page or response format changed`);
		return 2;
	}

	const { drift, notes } = compareCatalog(GROK_MODELS, source.models);
	const report = {
		source: useApi ? 'api' : 'docs',
		compared_against: source.label,
		catalog: GROK_MODELS.map((m) => m.id),
		upstream: [...source.models.keys()].sort(),
		drift,
		notes,
		ok: drift.length === 0,
	};

	if (AS_JSON) {
		process.stdout.write(JSON.stringify(report, null, 2) + '\n');
	} else {
		console.log(`xAI model drift check (source: ${report.source}${useApi ? '' : ', no xAI key set'})`);
		console.log(`  compared against: ${source.label}`);
		console.log(`  ours (${report.catalog.length}):  ${report.catalog.join(', ')}`);
		console.log(`  xAI  (${report.upstream.length}):  ${report.upstream.join(', ')}`);
		for (const n of notes) console.log(`  note   ${n.id}: ${n.detail}`);
		for (const d of drift) console.log(`  DRIFT  ${d.id} [${d.kind}]: ${d.detail}`);
		console.log(drift.length ? `\n${drift.length} drift item(s). Fix GROK_MODELS in api/_lib/chat-models.js.` : '\nIn sync.');
	}
	return drift.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().then((code) => process.exit(code));
}
