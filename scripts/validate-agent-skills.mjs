#!/usr/bin/env node
// Validates every skill folder under .agents/skills/ against the Agent Skills
// specification (https://agentskills.io/specification): a SKILL.md whose YAML
// frontmatter carries a `name` that equals the folder name (1-64 chars, lowercase
// letters, digits and single hyphens) and a `description` (1-1024 chars), plus the
// optional `license`, `compatibility` (<=500 chars), `metadata` (string to string
// map) and `allowed-tools` fields. The Claude Code extension fields three.ws
// skills use (when_to_use, disable-model-invocation, user-invocable) are accepted;
// anything else is an error, so a typo'd field cannot ship silently. SKILL.md body
// size is checked against the spec's 500-line guidance.
//
// Usage: node scripts/validate-agent-skills.mjs [--dir <skills dir>] [--json]
// Exit 1 when any three.ws-authored skill fails.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const CLAUDE_EXTENSION_FIELDS = new Set(['when_to_use', 'disable-model-invocation', 'user-invocable']);
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BODY_LINES = 500;
// Vendored partner drops stay byte-identical to their publishers and never ship in
// the standalone skill repos, so their findings are reported but do not fail the run.
const VENDORED_RE = /^(okx|metamask)-/;

/** Returns the list of problems for one skill folder (empty when it conforms). */
export function validateSkillDir(dir) {
	const folder = path.basename(dir);
	const problems = [];
	const file = path.join(dir, 'SKILL.md');
	if (!fs.existsSync(file)) return ['missing SKILL.md'];

	const text = fs.readFileSync(file, 'utf8');
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
	if (!m) return ['SKILL.md has no YAML frontmatter block'];

	let fm;
	try {
		fm = YAML.parse(m[1]);
	} catch (err) {
		return [`frontmatter is not valid YAML: ${err.message.split('\n')[0]}`];
	}
	if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return ['frontmatter is not a mapping'];

	for (const key of Object.keys(fm)) {
		if (!SPEC_FIELDS.has(key) && !CLAUDE_EXTENSION_FIELDS.has(key)) {
			problems.push(`unknown frontmatter field "${key}"`);
		}
	}

	if (typeof fm.name !== 'string' || !fm.name) problems.push('name is required');
	else {
		if (fm.name.length > 64) problems.push(`name is ${fm.name.length} chars (max 64)`);
		if (!NAME_RE.test(fm.name)) problems.push(`name "${fm.name}" must be lowercase letters, digits and single hyphens`);
		if (fm.name !== folder) problems.push(`name "${fm.name}" does not match folder "${folder}"`);
	}

	if (typeof fm.description !== 'string' || !fm.description.trim()) problems.push('description is required');
	else if (fm.description.length > 1024) problems.push(`description is ${fm.description.length} chars (max 1024)`);

	if (fm.license !== undefined && (typeof fm.license !== 'string' || !fm.license.trim())) {
		problems.push('license must be a non-empty string');
	}
	if (fm.compatibility !== undefined) {
		if (typeof fm.compatibility !== 'string' || !fm.compatibility.trim()) problems.push('compatibility must be a non-empty string');
		else if (fm.compatibility.length > 500) problems.push(`compatibility is ${fm.compatibility.length} chars (max 500)`);
	}
	if (fm.metadata !== undefined) {
		if (!fm.metadata || typeof fm.metadata !== 'object' || Array.isArray(fm.metadata)) problems.push('metadata must be a map');
		else {
			for (const [k, v] of Object.entries(fm.metadata)) {
				if (typeof v !== 'string') problems.push(`metadata.${k} must be a string (got ${typeof v})`);
			}
		}
	}
	if (fm['allowed-tools'] !== undefined && typeof fm['allowed-tools'] !== 'string') {
		problems.push('allowed-tools must be a space-separated string');
	}

	const bodyLines = text.slice(m[0].length).split(/\r?\n/).length;
	if (bodyLines > MAX_BODY_LINES) problems.push(`SKILL.md body is ${bodyLines} lines (guidance: under ${MAX_BODY_LINES})`);
	return problems;
}

export function validateSkillsRoot(root) {
	const results = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		results.push({
			skill: entry.name,
			vendored: VENDORED_RE.test(entry.name),
			problems: validateSkillDir(path.join(root, entry.name)),
		});
	}
	return results.sort((a, b) => a.skill.localeCompare(b.skill));
}

const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const argv = process.argv.slice(2);
	const i = argv.indexOf('--dir');
	const root = path.resolve(ROOT, i >= 0 ? argv[i + 1] : path.join('.agents', 'skills'));
	const results = validateSkillsRoot(root);
	const failed = results.filter((r) => r.problems.length && !r.vendored);
	const warned = results.filter((r) => r.problems.length && r.vendored);
	if (argv.includes('--json')) console.log(JSON.stringify(results, null, '\t'));
	else {
		for (const r of results) {
			console.log(`${!r.problems.length ? 'ok  ' : r.vendored ? 'warn' : 'FAIL'}  ${r.skill}`);
			for (const p of r.problems) console.log(`        ${p}`);
		}
		const own = results.filter((r) => !r.vendored);
		console.log(
			`\n${own.length - failed.length}/${own.length} three.ws skills conform to the Agent Skills spec. ${warned.length} vendored partner skills have findings and are left byte-identical.`,
		);
	}
	process.exit(failed.length ? 1 : 0);
}
