#!/usr/bin/env node
// Publish the cross-platform-safe 3D skills as a public, downloadable bundle,
// and refuse to ship one that tells a model to call a tool we do not serve.
//
//   npm run build:openai-skills            # regenerate the published bundle
//   npm run check:openai-skills            # fail if the published copy drifted
//
// Output, all tracked and served from three.ws:
//
//   public/skills/3d-studio/<skill>/SKILL.md   readable at /skills/3d-studio/...
//   public/skills/3d-studio/three-ws-3d-skills.zip
//   public/skills/3d-studio/README.md
//
// The zip is the artifact an OpenAI Plugin Directory submission uploads on its
// Skills tab, and the unpacked tree is what anyone else can read or curl
// without cloning the repo.
//
// Three things this does that a `zip -r` of .agents/skills would not:
//
// 1. Scope. The pack carries 43 skills, most of them wallet, payments and
//    partner-exchange work. A 3D plugin shipping those reads as unfocused
//    against OpenAI's guidance to keep instructions scoped to the plugin's
//    purpose, so the set is derived from frontmatter (category 3d/*, and
//    cross-platform-safe) rather than a hand-kept list that would rot.
//
// 2. No dead paths. A skill is only true if its tools exist. This reads the
//    tool names the studio endpoint actually declares and drops any skill
//    referencing one that is missing, naming it in the report. find-3d-assets
//    is excluded today for exactly that reason: its catalog tools live on the
//    full MCP server, not on mcp-studio, and inside ChatGPT there is no shell,
//    so the skill's documented curl fallback cannot rescue it either. Ship
//    those tools on mcp-studio and the skill rejoins with no edit here.
//
// 3. Determinism. Published output is tracked, so a rebuild that changes bytes
//    for no reason would show up as a diff in everyone else's worktree. Staged
//    files get a fixed timestamp and the zip is built from a sorted file list,
//    which is what lets --check be a real drift gate.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, '.agents', 'skills');
const STUDIO_DIR = join(ROOT, 'api', '_mcp-studio');
const PUBLISH_DIR = join(ROOT, 'public', 'skills', '3d-studio');
const ZIP_NAME = 'three-ws-3d-skills.zip';
const CONNECTOR = process.env.OPENAI_CONNECTOR_URL || 'https://three.ws/api/mcp-studio';

// Fixed so a rebuild with unchanged inputs produces a byte-identical zip.
const STAMP = '202001010000';

// OpenAI's documented limits for a skills bundle upload.
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const argv = new Set(process.argv.slice(2));
const checkOnly = argv.has('--check');
const offline = argv.has('--offline') || checkOnly;

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
		if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
			toolColumns = cells(line).flatMap((h, idx) => (/^tools?$/i.test(h) ? [idx] : []));
			i++;
			continue;
		}
		for (const idx of toolColumns) {
			const m = (cells(line)[idx] || '').match(/^`([a-z][a-z0-9_]*)`$/);
			if (m) add(m[1]);
		}
	}
	return found;
}

/**
 * The tool names the studio endpoint declares in source. This is the offline
 * source of truth precisely because it IS the code that serves them, so it
 * cannot drift from production the way a checked-in snapshot would.
 */
function sourceToolNames() {
	const names = new Set();
	for (const file of readdirSync(STUDIO_DIR).filter((f) => f.endsWith('.js'))) {
		const text = readFileSync(join(STUDIO_DIR, file), 'utf8');
		for (const m of text.matchAll(/^\t*name: '([a-z][a-z0-9_]*)',$/gm)) names.add(m[1]);
	}
	return names;
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
	const line = (await res.text()).trim().split('\n').filter(Boolean).pop().replace(/^data:\s*/, '');
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
	return out.sort();
}

/** Published copy is public-facing, so it follows the repo's dash rule. */
function normalizeDashes(text) {
	// Escapes rather than the literal glyphs, so this file passes the rule it enforces.
	return text.replace(/\s*\u2014\s*/g, ', ').replace(/\s*\u2013\s*/g, ' to ');
}

const candidates = readdirSync(SKILLS_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort()
	.map((name) => {
		const skillFile = join(SKILLS_DIR, name, 'SKILL.md');
		if (!existsSync(skillFile)) return null;
		const fm = frontmatter(readFileSync(skillFile, 'utf8'));
		if (!fm) return null;
		const meta = fm.metadata || {};
		if (!String(meta.category || '').startsWith('3d/')) return null;
		if (String(meta['cross-platform-safe']) !== 'true') return null;
		return { name, dir: join(SKILLS_DIR, name), fm };
	})
	.filter(Boolean);

if (!candidates.length) {
	console.error('no skill declares metadata.category 3d/* with cross-platform-safe: true');
	process.exit(1);
}

const declared = sourceToolNames();
if (!declared.size) {
	console.error(`no tool names found in ${relative(ROOT, STUDIO_DIR)}; the declaration shape changed`);
	process.exit(1);
}

// Online, the served list is the authority and a disagreement with source is a
// deploy-drift finding worth failing on, not a detail to smooth over.
if (!offline) {
	const live = await liveToolNames();
	const onlyLive = [...live].filter((t) => !declared.has(t)).sort();
	const onlySource = [...declared].filter((t) => !live.has(t)).sort();
	if (onlyLive.length || onlySource.length) {
		console.error(`${CONNECTOR} and ${relative(ROOT, STUDIO_DIR)} disagree about the tool surface:`);
		if (onlyLive.length) console.error(`  served but not in source: ${onlyLive.join(', ')}`);
		if (onlySource.length) console.error(`  in source but not served: ${onlySource.join(', ')}`);
		console.error('production is running different code than this checkout. Resolve that before publishing.');
		process.exit(1);
	}
	console.log(`${CONNECTOR} serves the same ${live.size} tool(s) this checkout declares\n`);
}

const included = [];
const excluded = [];

for (const skill of candidates) {
	const problems = [];
	if (skill.fm.name !== skill.name) problems.push(`frontmatter name "${skill.fm.name}" does not match its directory`);
	if (!skill.fm.description) problems.push('no description in frontmatter, so nothing tells the model when to trigger it');

	const files = walk(skill.dir);
	if (files.filter((f) => /(^|\/)SKILL\.md$/i.test(f)).length !== 1) problems.push('a skill must carry exactly one SKILL.md');
	for (const f of files) {
		if (statSync(f).size > MAX_FILE_BYTES) problems.push(`${relative(ROOT, f)} exceeds the 25MB per-file limit`);
	}

	const wanted = new Set();
	for (const f of files.filter((f) => f.endsWith('.md'))) {
		for (const t of referencedTools(readFileSync(f, 'utf8'))) wanted.add(t);
	}
	const missing = [...wanted].filter((t) => !declared.has(t)).sort();
	if (missing.length) problems.push(`calls ${missing.map((t) => `\`${t}\``).join(', ')}, which the studio endpoint does not expose`);

	if (problems.length) excluded.push({ ...skill, problems });
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

function readme() {
	// A description is free text: a raw < or > would render as an HTML tag and
	// vanish (the <agent-3d> element does exactly that), and a pipe would split
	// the row into the wrong number of cells.
	const cell = (text) =>
		normalizeDashes(text)
			.split('. ')[0]
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\|/g, '\\|');
	const rows = included
		.map((s) => `| [\`${s.name}\`](${s.name}/SKILL.md) | ${cell(s.fm.description)}. |`)
		.join('\n');
	return `# three.ws 3D Agent Skills

The platform's 3D creation skills, packaged so any agent runtime can load them.
Each folder is a self-contained skill: a \`SKILL.md\` whose frontmatter says when
to trigger it, and instructions for driving the free, keyless 3D tools on
${CONNECTOR}.

| Skill | What it does |
| --- | --- |
${rows}

## Use them

Download the whole set:

\`\`\`bash
curl -O https://three.ws/skills/3d-studio/${ZIP_NAME}
\`\`\`

Or read one directly, no clone required:

\`\`\`bash
curl https://three.ws/skills/3d-studio/${included[0].name}/SKILL.md
\`\`\`

Drop a folder into \`.claude/skills/\` for Claude Code or the Claude apps, upload
the zip on the Skills tab of an OpenAI plugin submission, or point any other
agent runtime at the same files. Nothing here needs an account, an API key, or a
payment: the platform covers provider cost on the free lanes.

## Generated, not hand-maintained

This directory is produced by
[\`scripts/build-openai-skills-bundle.mjs\`](../../../scripts/build-openai-skills-bundle.mjs)
from the canonical pack in [\`.agents/skills/\`](../../../.agents/skills).
Edit the skill there, then run \`npm run build:openai-skills\`.
\`npm run check:openai-skills\` fails if this copy has drifted.

Only skills tagged \`3d/creative\` and \`cross-platform-safe\` are published here,
and any skill referencing a tool the studio endpoint does not expose is dropped:
a skill that tells a model to call a tool that is not there is a dead path, not a
feature.
`;
}

/** Build the published tree into `dest`. Returns the staged file list. */
function publish(dest) {
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });

	const staged = [];
	for (const skill of included) {
		for (const file of skill.files) {
			const rel = join(skill.name, relative(skill.dir, file));
			const out = join(dest, rel);
			mkdirSync(dirname(out), { recursive: true });
			const raw = readFileSync(file);
			writeFileSync(out, file.endsWith('.md') ? normalizeDashes(raw.toString('utf8')) : raw);
			staged.push(rel);
		}
	}
	staged.sort();

	// A fixed timestamp and a sorted file list are what make the archive
	// reproducible; without both, every rebuild rewrites a tracked binary.
	execFileSync('touch', ['-t', STAMP, ...staged], { cwd: dest });
	execFileSync('zip', ['-qX', ZIP_NAME, ...staged], { cwd: dest });
	writeFileSync(join(dest, 'README.md'), readme());
	return staged;
}

if (checkOnly) {
	const tmp = join(ROOT, 'node_modules', '.cache', 'openai-skills-check');
	publish(tmp);
	const expected = walk(tmp).map((f) => relative(tmp, f));
	const actual = existsSync(PUBLISH_DIR) ? walk(PUBLISH_DIR).map((f) => relative(PUBLISH_DIR, f)) : [];
	const drift = [];
	for (const rel of new Set([...expected, ...actual])) {
		const a = existsSync(join(tmp, rel)) ? readFileSync(join(tmp, rel)) : null;
		const b = existsSync(join(PUBLISH_DIR, rel)) ? readFileSync(join(PUBLISH_DIR, rel)) : null;
		if (!a) drift.push(`${rel}: published but no longer generated`);
		else if (!b) drift.push(`${rel}: generated but missing from the published copy`);
		else if (!a.equals(b)) drift.push(`${rel}: content differs`);
	}
	rmSync(tmp, { recursive: true, force: true });
	if (drift.length) {
		console.error(`\n${relative(ROOT, PUBLISH_DIR)} has drifted from .agents/skills:`);
		for (const d of drift) console.error(`  ${d}`);
		console.error('\nRun: npm run build:openai-skills');
		process.exit(1);
	}
	console.log(`\n${relative(ROOT, PUBLISH_DIR)} matches .agents/skills.`);
	process.exit(0);
}

publish(PUBLISH_DIR);

const zipBytes = statSync(join(PUBLISH_DIR, ZIP_NAME)).size;
if (zipBytes > MAX_ZIP_BYTES) {
	console.error(`\nbundle is ${(zipBytes / 1024 / 1024).toFixed(1)}MB, over the 50MB upload limit`);
	process.exit(1);
}

console.log(`\npublished ${relative(ROOT, PUBLISH_DIR)}`);
console.log(`  ${included.length} skill(s), ${totalFiles} file(s), ${ZIP_NAME} is ${(zipBytes / 1024).toFixed(1)} KB`);
console.log(`  live at https://three.ws/skills/3d-studio/ after the next deploy`);
