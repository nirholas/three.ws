#!/usr/bin/env node
// Package the cross-platform-safe 3D skills as a zip for the OpenAI Plugin
// Directory's Skills tab, and refuse to ship one that tells the model to call a
// tool our connector does not expose.
//
//   node scripts/build-openai-skills-bundle.mjs            # build + verify
//   node scripts/build-openai-skills-bundle.mjs --check     # verify only, write nothing
//   node scripts/build-openai-skills-bundle.mjs --offline   # skip the live tools/list check
//
// Why a dedicated builder rather than zipping .agents/skills wholesale:
//
// 1. Only part of the pack belongs in a 3D plugin. The pack carries 43 skills,
//    most of them wallet, payments and partner-exchange work. OpenAI's own
//    packaging guidance asks for scoped instructions that fit the plugin's
//    purpose, so the bundle is derived from frontmatter (category 3d/*, and
//    cross-platform-safe) instead of a hand-kept list that would rot.
//
// 2. A skill is only true if its tools exist. find-3d-assets documents
//    search_catalog / get_catalog_item / get_item_source, which live on the
//    paid /api/mcp endpoint and not on the mcp-studio connector this plugin
//    submits. Inside ChatGPT there is no shell, so the skill's HTTP fallback is
//    unreachable too: the model would simply fail. This script reads the live
//    tool list and drops any skill that references a tool the connector does
//    not have, naming it in the report. When catalog tools land on mcp-studio,
//    that skill rejoins the bundle with no edit here.
//
// 3. The listing is public copy, so the packaged text goes through the same
//    dash rule the rest of the submission copy did. Canonical files under
//    .agents/skills are left untouched; only the bundled copy is normalized.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, '.agents', 'skills');
const OUT_DIR = join(ROOT, 'dist-skills');
const STAGE = join(OUT_DIR, 'openai-plugin-skills');
const ZIP = join(OUT_DIR, 'openai-plugin-skills.zip');
const CONNECTOR = process.env.OPENAI_CONNECTOR_URL || 'https://three.ws/api/mcp-studio';

// OpenAI's documented upload limits for a skills bundle.
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const argv = new Set(process.argv.slice(2));
const checkOnly = argv.has('--check');
const offline = argv.has('--offline');

/** Minimal frontmatter reader: the same subset build-skills-pack.mjs relies on. */
function frontmatter(text) {
	const m = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!m) return null;
	const out = {};
	let section = null;
	for (const line of m[1].split('\n')) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		const nested = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(.*)$/);
		if (nested && section) {
			out[section][nested[1]] = nested[2].trim();
			continue;
		}
		const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!top) continue;
		if (top[2].trim() === '') {
			section = top[1];
			out[section] = {};
		} else {
			section = null;
			out[top[1]] = top[2].trim();
		}
	}
	return out;
}

/**
 * Tool names a skill instructs the model to CALL, as opposed to snake_case
 * words in prose. Three call-site shapes appear across the pack.
 *
 * Markdown tables are the subtle one: a pack file may list tools in a table
 * whose tool column is not the first (`| Lane | Tool | Cost |`), while another
 * table in the same file lists ERROR CODES in its first column
 * (`| lane_degraded | ... |`). Reading whichever column the header actually
 * names "Tool" is what separates a real dead path from an error-code string.
 */
function referencedTools(text) {
	const found = new Set();
	const add = (n) => n && found.add(n);
	for (const m of text.matchAll(/\*\*Tools?:\*\*\s*`([a-z][a-z0-9_]*)`/g)) add(m[1]);
	for (const m of text.matchAll(/^([a-z][a-z0-9_]*_[a-z0-9_]+)\s*\{/gm)) add(m[1]);
	for (const m of text.matchAll(/"tool"\s*:\s*"([a-z][a-z0-9_]*)"/g)) add(m[1]);

	const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
	const lines = text.split('\n');
	let toolColumns = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trimStart().startsWith('|')) {
			toolColumns = [];
			continue;
		}
		const next = lines[i + 1] || '';
		if (/^\s*\|[\s:|-]+\|\s*$/.test(next)) {
			toolColumns = cells(line).flatMap((h, idx) => (/^tools?$/i.test(h) ? [idx] : []));
			i++;
			continue;
		}
		for (const idx of toolColumns) {
			const cell = cells(line)[idx];
			if (!cell) continue;
			const m = cell.match(/^`([a-z][a-z0-9_]*)`$/);
			if (m) add(m[1]);
		}
	}
	return found;
}

async function liveToolNames() {
	const res = await fetch(CONNECTOR, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': '2025-06-18',
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`${CONNECTOR} answered ${res.status}`);
	const raw = await res.text();
	const line = raw.trim().split('\n').filter(Boolean).pop().replace(/^data:\s*/, '');
	const tools = JSON.parse(line).result?.tools || [];
	if (!tools.length) throw new Error(`${CONNECTOR} returned no tools`);
	return new Set(tools.map((t) => t.name));
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

/** The submission copy is public, so it follows the repo's dash rule. */
function normalizeDashes(text) {
	// Escapes rather than the literal glyphs, so this file passes the same rule it enforces.
	return text.replace(/\s*\u2014\s*/g, ', ').replace(/\s*\u2013\s*/g, ' to ');
}

const candidates = readdirSync(SKILLS_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort()
	.map((name) => {
		const skillFile = join(SKILLS_DIR, name, 'SKILL.md');
		if (!existsSync(skillFile)) return null;
		const text = readFileSync(skillFile, 'utf8');
		const fm = frontmatter(text);
		if (!fm) return null;
		const meta = fm.metadata || {};
		if (!String(meta.category || '').startsWith('3d/')) return null;
		if (String(meta['cross-platform-safe']) !== 'true') return null;
		return { name, dir: join(SKILLS_DIR, name), fm, text };
	})
	.filter(Boolean);

if (!candidates.length) {
	console.error('no skill declares metadata.category 3d/* with cross-platform-safe: true');
	process.exit(1);
}

const live = offline ? null : await liveToolNames();
if (live) console.log(`connector ${CONNECTOR} exposes ${live.size} tool(s)\n`);

const included = [];
const excluded = [];

for (const skill of candidates) {
	const problems = [];
	if (skill.fm.name !== skill.name) problems.push(`frontmatter name "${skill.fm.name}" does not match its directory`);
	if (!skill.fm.description) problems.push('no description in frontmatter, so nothing tells the model when to trigger it');

	const files = walk(skill.dir);
	if (files.filter((f) => /(^|\/)SKILL\.md$/i.test(f)).length !== 1) {
		problems.push('a skill must carry exactly one SKILL.md');
	}
	for (const f of files) {
		if (statSync(f).size > MAX_FILE_BYTES) problems.push(`${relative(ROOT, f)} exceeds the 25MB per-file limit`);
	}

	if (live) {
		const wanted = new Set();
		for (const f of files) {
			if (!f.endsWith('.md')) continue;
			for (const t of referencedTools(readFileSync(f, 'utf8'))) wanted.add(t);
		}
		const missing = [...wanted].filter((t) => !live.has(t)).sort();
		if (missing.length) {
			problems.push(`calls ${missing.map((t) => `\`${t}\``).join(', ')}, which the connector does not expose`);
		}
	}

	if (problems.length) excluded.push({ ...skill, problems, files });
	else included.push({ ...skill, files });
}

for (const s of included) console.log(`  include  ${s.name}  (${s.files.length} file(s))`);
for (const s of excluded) {
	console.log(`  EXCLUDE  ${s.name}`);
	for (const p of s.problems) console.log(`             ${p}`);
}

if (!included.length) {
	console.error('\nevery candidate skill was excluded, so there is no bundle to build');
	process.exit(1);
}

const totalFiles = included.reduce((n, s) => n + s.files.length, 0);
if (totalFiles > MAX_FILES) {
	console.error(`\n${totalFiles} files exceeds the ${MAX_FILES}-file limit`);
	process.exit(1);
}

if (checkOnly) {
	console.log(`\n${included.length} skill(s) would ship, ${excluded.length} excluded. Nothing written (--check).`);
	process.exit(0);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

for (const skill of included) {
	for (const file of skill.files) {
		const dest = join(STAGE, skill.name, relative(skill.dir, file));
		mkdirSync(dirname(dest), { recursive: true });
		const raw = readFileSync(file);
		writeFileSync(dest, file.endsWith('.md') ? normalizeDashes(raw.toString('utf8')) : raw);
	}
}

rmSync(ZIP, { force: true });
execFileSync('zip', ['-q', '-r', ZIP, '.'], { cwd: STAGE });

const zipBytes = statSync(ZIP).size;
if (zipBytes > MAX_ZIP_BYTES) {
	console.error(`\nbundle is ${(zipBytes / 1024 / 1024).toFixed(1)}MB, over the 50MB upload limit`);
	process.exit(1);
}

console.log(`\nwrote ${relative(ROOT, ZIP)}  (${(zipBytes / 1024).toFixed(1)} KB, ${totalFiles} file(s), ${included.length} skill(s))`);
console.log('upload it on the Skills tab of the plugin submission.');
