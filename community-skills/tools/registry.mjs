// Community skills registry: validate every skill directory and build registry.json.
//
// One implementation, two homes. The three.ws monorepo imports this from
// scripts/build-community-registry.mjs (wired into `npm run build:pages`), and the
// public mirror (nirholas/three-ws-skills) runs it as
// `node tools/validate.mjs` so a contributor sees exactly the verdict the build
// will reach before they open a pull request. It is deliberately dependency-free:
// a fresh clone of the mirror has no node_modules.
//
// A skill is a directory under skills/ holding:
//   SKILL.md        frontmatter `name` (== the directory slug) and `description`,
//                   then the instructions an agent follows
//   metadata.json   name, description, author, tags, version (+ optional license)
//   references/     optional supporting documents (.md, .txt, .json)
//   scripts/        optional helpers (.mjs, .js, .py, .sh); JS is syntax-checked
//
// Everything is deterministic: the same tree always produces byte-identical
// registry.json, so `--check` can fail a build whose committed index is stale.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Canonical source lives in the three.ws monorepo; the mirror is the small
// public repository contributors fork. scripts/sync-community-skills.mjs keeps
// the two in step in both directions.
export const REGISTRY_SOURCE = 'https://github.com/nirholas/three.ws/tree/main/community-skills';
export const REGISTRY_MIRROR = 'https://github.com/nirholas/three-ws-skills';
export const REGISTRY_PAGE = 'https://three.ws/skills/community';

// Bounds. The body cap keeps any one community skill well inside the per-agent
// injection budget (api/_lib/agent-custom-skills.js), so at least two full
// community skills always fit on one agent side by side.
export const LIMITS = Object.freeze({
	slugMin: 3,
	slugMax: 64,
	nameMin: 2,
	nameMax: 80,
	descriptionMin: 20,
	descriptionMax: 400,
	authorMax: 80,
	tagsMin: 1,
	tagsMax: 8,
	tagMax: 32,
	bodyMinChars: 200,
	bodyMaxChars: 12000,
	fileMaxBytes: 64 * 1024,
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REQUIRED_META = ['name', 'description', 'author', 'tags', 'version'];
const OPTIONAL_META = ['license'];
const ALLOWED_DIRS = { references: /\.(md|txt|json)$/i, scripts: /\.(mjs|js|py|sh)$/i };

// The platform promotes exactly one coin. Committed skills may talk about the
// chain's own rails (SOL for fees, USDC for payments) but never name or pin a
// third-party token. Two mechanical checks enforce that without this file
// having to list anyone else's project:
//   1. a cashtag in prose other than the ones allowed below, and
//   2. a Solana address that is not the promoted coin or core infrastructure.
// Naming a project in plain words cannot be caught mechanically; that is part
// of human review (see CONTRIBUTING.md).
export const PROMOTED_COIN = Object.freeze({
	symbol: 'THREE',
	mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
});
const ALLOWED_CASHTAGS = new Set(['THREE', 'SOL', 'USDC']);
const ALLOWED_ADDRESSES = new Set([
	PROMOTED_COIN.mint,
	'11111111111111111111111111111111', // System Program
	'So11111111111111111111111111111111111111112', // wrapped SOL mint
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint (payment rail)
	'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token program
	'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 program
	'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account program
	'MemoSq4gqABAXKb96qnH8TuPGmKL6kCVfKQDiWT5NR', // SPL Memo program
	'ComputeBudget111111111111111111111111111111', // Compute Budget program
]);
const CASHTAG_RE = /(^|[^\w$])\$([A-Za-z][A-Za-z0-9]{1,11})\b/g;
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** Split `---` frontmatter from a SKILL.md. Returns { data, body } or null. */
export function parseSkillMarkdown(text) {
	const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return null;
	const data = {};
	const lines = m[1].split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!kv) continue;
		let value = kv[2].trim();
		if (value === '|' || value === '>' || value === '|-' || value === '>-') {
			const block = [];
			while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
				block.push(lines[++i].trim());
			}
			value = block.join(value.startsWith('|') ? '\n' : ' ').trim();
		} else if (/^(['"]).*\1$/.test(value)) {
			value = value.slice(1, -1);
		}
		data[kv[1]] = value;
	}
	return { data, body: String(text).slice(m[0].length).trim() };
}

/** Rough token estimate shared with the runtime budget (4 chars per token). */
export function estimateTokens(text) {
	return Math.ceil(String(text || '').length / 4);
}

// Prose only: fenced blocks and inline code are shell and JSON, where `$HOME`
// is a variable, not a cashtag.
function stripCode(markdown) {
	return String(markdown)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`\n]*`/g, ' ');
}

/** Third-party token references in one text. Returns human-readable findings. */
export function findTokenReferences(text, { prose = true } = {}) {
	const findings = [];
	if (prose) {
		for (const m of stripCode(text).matchAll(CASHTAG_RE)) {
			const tag = m[2].toUpperCase();
			if (!ALLOWED_CASHTAGS.has(tag)) findings.push(`cashtag $${m[2]}`);
		}
	}
	for (const m of String(text).matchAll(BASE58_RE)) {
		const addr = m[0];
		// A real address mixes digits and letters; a long all-letter word is prose.
		if (!/\d/.test(addr) || !/[A-Za-z]/.test(addr)) continue;
		if (!ALLOWED_ADDRESSES.has(addr)) findings.push(`address ${addr}`);
	}
	return [...new Set(findings)];
}

function listFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(full));
		else out.push(full);
	}
	return out;
}

function toPosix(p) {
	return p.split(sep).join('/');
}

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

function validateMetadata(meta, errors) {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
		errors.push('metadata.json must be a JSON object');
		return;
	}
	for (const key of REQUIRED_META) {
		if (meta[key] === undefined || meta[key] === null || meta[key] === '') {
			errors.push(`metadata.json is missing "${key}"`);
		}
	}
	for (const key of Object.keys(meta)) {
		if (!REQUIRED_META.includes(key) && !OPTIONAL_META.includes(key)) {
			errors.push(`metadata.json has unknown field "${key}" (allowed: ${[...REQUIRED_META, ...OPTIONAL_META].join(', ')})`);
		}
	}
	const str = (key, min, max) => {
		const v = meta[key];
		if (v === undefined) return;
		if (typeof v !== 'string') return errors.push(`metadata.json "${key}" must be a string`);
		const len = v.trim().length;
		if (len < min || len > max) errors.push(`metadata.json "${key}" must be ${min}-${max} characters (got ${len})`);
	};
	str('name', LIMITS.nameMin, LIMITS.nameMax);
	str('description', LIMITS.descriptionMin, LIMITS.descriptionMax);
	str('author', 1, LIMITS.authorMax);
	if (meta.version !== undefined && (typeof meta.version !== 'string' || !SEMVER_RE.test(meta.version))) {
		errors.push('metadata.json "version" must be semver, e.g. "1.0.0"');
	}
	if (meta.license !== undefined && (typeof meta.license !== 'string' || !/^[A-Za-z0-9.+-]{2,40}$/.test(meta.license))) {
		errors.push('metadata.json "license" must be an SPDX identifier, e.g. "MIT"');
	}
	if (meta.tags !== undefined) {
		if (!Array.isArray(meta.tags)) {
			errors.push('metadata.json "tags" must be an array of strings');
		} else {
			if (meta.tags.length < LIMITS.tagsMin || meta.tags.length > LIMITS.tagsMax) {
				errors.push(`metadata.json "tags" must hold ${LIMITS.tagsMin}-${LIMITS.tagsMax} tags`);
			}
			const seen = new Set();
			for (const tag of meta.tags) {
				if (typeof tag !== 'string' || !TAG_RE.test(tag) || tag.length > LIMITS.tagMax) {
					errors.push(`tag ${JSON.stringify(tag)} must be lowercase kebab-case, at most ${LIMITS.tagMax} characters`);
				} else if (seen.has(tag)) {
					errors.push(`tag "${tag}" is listed twice`);
				}
				seen.add(tag);
			}
		}
	}
	for (const key of ['name', 'description', 'author']) {
		if (typeof meta[key] === 'string') {
			for (const f of findTokenReferences(meta[key])) errors.push(`metadata.json "${key}": third-party token reference (${f})`);
		}
	}
}

function checkScriptSyntax(file, errors, rel) {
	if (!/\.(mjs|js)$/i.test(file)) return;
	const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
	if (r.status !== 0) {
		const first = (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'syntax error';
		errors.push(`${rel} does not parse: ${first.trim()}`);
	}
}

/**
 * Validate one skill directory. Returns { slug, errors, entry } where `entry`
 * is the registry row (null when there are errors).
 */
export function validateSkill(skillsDir, slug, { syntaxCheck = true } = {}) {
	const dir = join(skillsDir, slug);
	const errors = [];
	if (!SLUG_RE.test(slug) || slug.length < LIMITS.slugMin || slug.length > LIMITS.slugMax) {
		errors.push(`directory name "${slug}" must be a URL-safe slug: lowercase letters, digits and single hyphens, ${LIMITS.slugMin}-${LIMITS.slugMax} characters`);
	}

	const skillPath = join(dir, 'SKILL.md');
	const metaPath = join(dir, 'metadata.json');
	let parsed = null;
	let meta = null;

	if (!existsSync(skillPath)) {
		errors.push('SKILL.md is missing');
	} else {
		const text = readFileSync(skillPath, 'utf8');
		parsed = parseSkillMarkdown(text);
		if (!parsed) {
			errors.push('SKILL.md must open with a --- frontmatter block holding name and description');
		} else {
			if (!parsed.data.name) errors.push('SKILL.md frontmatter is missing "name"');
			else if (parsed.data.name !== slug) errors.push(`SKILL.md frontmatter name "${parsed.data.name}" must equal the directory name "${slug}"`);
			if (!parsed.data.description) errors.push('SKILL.md frontmatter is missing "description"');
			else if (parsed.data.description.length < LIMITS.descriptionMin) errors.push('SKILL.md frontmatter "description" is too short to act as a trigger');
			const len = parsed.body.length;
			if (len < LIMITS.bodyMinChars) errors.push(`SKILL.md body is ${len} characters; a useful skill needs at least ${LIMITS.bodyMinChars}`);
			if (len > LIMITS.bodyMaxChars) errors.push(`SKILL.md body is ${len} characters; the limit is ${LIMITS.bodyMaxChars} so it fits an agent's skill budget`);
			for (const f of findTokenReferences(text)) errors.push(`SKILL.md: third-party token reference (${f})`);
		}
	}

	if (!existsSync(metaPath)) {
		errors.push('metadata.json is missing');
	} else {
		try {
			meta = JSON.parse(readFileSync(metaPath, 'utf8'));
			validateMetadata(meta, errors);
		} catch (err) {
			errors.push(`metadata.json is not valid JSON: ${err.message}`);
		}
	}

	const files = [];
	if (existsSync(dir) && statSync(dir).isDirectory()) {
		for (const file of listFiles(dir).sort()) {
			const rel = toPosix(relative(dir, file));
			files.push(rel);
			if (rel === 'SKILL.md' || rel === 'metadata.json') continue;
			const top = rel.split('/')[0];
			const pattern = ALLOWED_DIRS[top];
			if (!pattern || !rel.includes('/')) {
				errors.push(`${rel} is not allowed; a skill holds SKILL.md, metadata.json, references/ and scripts/ only`);
				continue;
			}
			if (!pattern.test(rel)) {
				errors.push(`${rel} has an extension ${top}/ does not accept`);
				continue;
			}
			const size = statSync(file).size;
			if (size > LIMITS.fileMaxBytes) errors.push(`${rel} is ${size} bytes; the per-file limit is ${LIMITS.fileMaxBytes}`);
			const body = readFileSync(file, 'utf8');
			for (const f of findTokenReferences(body, { prose: /\.md$/i.test(rel) })) errors.push(`${rel}: third-party token reference (${f})`);
			if (syntaxCheck && top === 'scripts') checkScriptSyntax(file, errors, rel);
		}
	}

	if (errors.length || !parsed || !meta) return { slug, errors, entry: null };

	const skillBytes = readFileSync(skillPath);
	return {
		slug,
		errors,
		entry: {
			slug,
			name: meta.name.trim(),
			description: meta.description.trim(),
			author: meta.author.trim(),
			tags: [...meta.tags],
			version: meta.version,
			license: meta.license || 'MIT',
			path: `skills/${slug}`,
			files,
			bytes: skillBytes.length,
			tokens: estimateTokens(parsed.body),
			sha256: sha256(skillBytes),
		},
	};
}

/**
 * Validate every skill under `root/skills` and assemble the registry.
 * Returns { ok, errors: [{ slug, message }], registry }.
 */
export function buildRegistry(root, opts = {}) {
	const skillsDir = join(root, 'skills');
	const errors = [];
	const entries = [];
	if (!existsSync(skillsDir)) {
		return { ok: false, errors: [{ slug: '(root)', message: 'skills/ directory is missing' }], registry: null };
	}
	const slugs = readdirSync(skillsDir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	for (const stray of readdirSync(skillsDir, { withFileTypes: true }).filter((d) => !d.isDirectory())) {
		errors.push({ slug: '(root)', message: `skills/${stray.name} is a file; every skill is a directory` });
	}

	const lower = new Map();
	for (const slug of slugs) {
		const key = slug.toLowerCase();
		if (lower.has(key)) errors.push({ slug, message: `slug collides with "${lower.get(key)}"` });
		lower.set(key, slug);
		const result = validateSkill(skillsDir, slug, opts);
		for (const message of result.errors) errors.push({ slug, message });
		if (result.entry) entries.push(result.entry);
	}

	const names = new Map();
	for (const e of entries) {
		const key = e.name.toLowerCase();
		if (names.has(key)) errors.push({ slug: e.slug, message: `name "${e.name}" is already used by ${names.get(key)}` });
		names.set(key, e.slug);
	}

	const tagCounts = new Map();
	for (const e of entries) for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
	const tags = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([tag, count]) => ({ tag, count }));
	const authors = [...new Set(entries.map((e) => e.author))].sort((a, b) => a.localeCompare(b));

	const registry = {
		schema: 'three.ws/community-skills-registry@1',
		source: REGISTRY_SOURCE,
		mirror: REGISTRY_MIRROR,
		page: REGISTRY_PAGE,
		count: entries.length,
		tags,
		authors,
		skills: entries,
	};
	return { ok: errors.length === 0, errors, registry };
}

/** Serialize the registry exactly the way it is committed. */
export function serializeRegistry(registry) {
	return `${JSON.stringify(registry, null, '\t')}\n`;
}
