#!/usr/bin/env node
// Publishes three.ws's own Agent Skills for discovery by third-party
// agent-skills registries (Hermes and others), per the Cloudflare-led
// agent-skills-discovery RFC draft v0.2.0 (agentskills.io/discovery). That
// spec's canonical path is /.well-known/agent-skills/index.json; this project's
// own work order also names the shorter /.well-known/skills/index.json (the
// path Hermes's own docs use), so both are published with identical content,
// each entry's url pointing at the one canonical copy of the artifact.
//
// Source of truth is .agents/skills/ (the same skills build-skills-pack.mjs and
// build-standalone-skill-repos.mjs ship); this script only selects the subset
// that is three.ws-origin and public (not the ops/production skill, which is
// for maintainers of this repo, and not vendored partner drops, which belong
// to their publishers), copies each SKILL.md byte-identical into
// public/.well-known/agent-skills/<slug>/SKILL.md, and writes the index.
//
// Usage: node scripts/build-well-known-skills-index.mjs [--check]
//   --check  exit 1 if the generated output differs from what is on disk

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectSkills } from './build-skills-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, '.agents', 'skills');
const CANONICAL_DIR = path.join(ROOT, 'public', '.well-known', 'agent-skills');
const ALIAS_INDEX = path.join(ROOT, 'public', '.well-known', 'skills', 'index.json');
const SCHEMA_URL = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const SITE = 'https://three.ws';

function licenseOf(slug) {
	const text = fs.readFileSync(path.join(SKILLS_DIR, slug, 'SKILL.md'), 'utf8');
	const frontmatter = text.split(/^---\s*$/m)[1] || '';
	const match = frontmatter.match(/^license:\s*(.+)$/m);
	return match ? match[1].trim() : undefined;
}

function buildIndex() {
	const skills = collectSkills().filter((s) => s.origin === 'three.ws' && s.category !== 'ops/production');

	const entries = skills.map((s) => {
		const body = fs.readFileSync(path.join(ROOT, s.path, 'SKILL.md'));
		const digest = crypto.createHash('sha256').update(body).digest('hex');
		const license = licenseOf(s.name);
		return {
			name: s.name,
			type: 'skill-md',
			description: s.description,
			url: `${SITE}/.well-known/agent-skills/${s.name}/SKILL.md`,
			digest: `sha256:${digest}`,
			...(license ? { license } : {}),
			category: s.category,
			body,
		};
	});

	const index = {
		$schema: SCHEMA_URL,
		version: '0.2.0',
		publisher: {
			name: 'three.ws',
			url: SITE,
		},
		skills: entries.map(({ body, ...entry }) => entry),
	};

	return { index, entries };
}

function writeOutput({ index, entries }) {
	const expectedIndex = `${JSON.stringify(index, null, '\t')}\n`;
	fs.mkdirSync(CANONICAL_DIR, { recursive: true });
	for (const entry of entries) {
		const dir = path.join(CANONICAL_DIR, entry.name);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'SKILL.md'), entry.body);
	}
	fs.writeFileSync(path.join(CANONICAL_DIR, 'index.json'), expectedIndex);
	fs.mkdirSync(path.dirname(ALIAS_INDEX), { recursive: true });
	fs.writeFileSync(ALIAS_INDEX, expectedIndex);
}

function check({ index, entries }) {
	const expectedIndex = `${JSON.stringify(index, null, '\t')}\n`;
	let ok = true;
	for (const file of [path.join(CANONICAL_DIR, 'index.json'), ALIAS_INDEX]) {
		const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
		if (actual !== expectedIndex) {
			console.error(`[build-well-known-skills-index] ${path.relative(ROOT, file)} is out of date`);
			ok = false;
		}
	}
	for (const entry of entries) {
		const file = path.join(CANONICAL_DIR, entry.name, 'SKILL.md');
		const actual = fs.existsSync(file) ? fs.readFileSync(file) : null;
		if (!actual || !actual.equals(entry.body)) {
			console.error(`[build-well-known-skills-index] ${entry.name}/SKILL.md is out of date`);
			ok = false;
		}
	}
	return ok;
}

const result = buildIndex();
if (process.argv.includes('--check')) {
	process.exit(check(result) ? 0 : 1);
} else {
	writeOutput(result);
	console.log(`[build-well-known-skills-index] wrote ${result.entries.length} skills to ${path.relative(ROOT, CANONICAL_DIR)}`);
}
