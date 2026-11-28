#!/usr/bin/env node
// Validates a Gemini CLI extension directory against the rules Gemini CLI
// itself enforces and the rules the extension gallery (geminicli.com/extensions)
// lists by.
//
//   node scripts/validate-gemini-extension.mjs integrations/gemini/three-ws
//
// The checks mirror @google/gemini-cli 0.71.1 (read from its bundle on
// 2026-11-28): ExtensionManager.loadExtensionConfig (gemini-extension.json must
// parse and carry `name` and `version`; the name may hold only letters, digits
// and dashes), `gemini extensions validate` (context files must exist inside
// the extension, every MCP server needs a transport and a parseable URL,
// `httpUrl` is deprecated in favour of `url` plus `type: "http"`, a version
// that is not semver is flagged), the skill loader (skills/<dir>/SKILL.md with
// YAML frontmatter holding a string `name` and `description`) and the custom
// command loader (commands/**/*.toml with a string `prompt`). On top of those it
// adds the gallery and listing rules from geminicli.com/docs/extensions:
// a lowercase name, a description for the listing card, no `trust` on an
// extension's MCP server, https only, no `.env` file shipped in the package,
// and a semver version (the gallery and `gemini extensions update` compare
// release tags, so the version has to be one).
//
// Exit code 0 when valid, 1 with the problems printed otherwise.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

export const MANIFEST = 'gemini-extension.json';
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
// What a Gemini CLI extension directory may hold (geminicli.com/docs/extensions/reference),
// plus the repository files a published extension carries.
const KNOWN_TOP = new Set([MANIFEST, 'commands', 'skills', 'hooks', 'agents', 'policies', 'assets', 'README.md', 'LICENSE', 'CHANGELOG.md', '.gitignore']);

function walk(dir) {
	return readdirSync(dir)
		.sort()
		.flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? walk(p) : [p];
		});
}

function inside(root, p) {
	const rel = relative(root, resolve(root, p));
	return rel && !rel.startsWith('..') && !rel.startsWith(sep) && !rel.includes(`..${sep}`);
}

/**
 * @param {string} dir extension directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[], manifest: object|null, components: { commands: string[], skills: string[], servers: string[], context: string[] } }}
 */
export function validateGeminiExtension(dir) {
	const root = resolve(dir);
	const errors = [];
	const warnings = [];
	const components = { commands: [], skills: [], servers: [], context: [] };
	const done = (manifest = null) => ({ ok: errors.length === 0, errors, warnings, manifest, components });

	const manifestPath = join(root, MANIFEST);
	if (!existsSync(manifestPath)) {
		errors.push(`${MANIFEST}: missing at the extension root (the gallery and \`gemini extensions install\` read it from there)`);
		return done();
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (err) {
		errors.push(`${MANIFEST}: invalid JSON (${err.message})`);
		return done();
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		errors.push(`${MANIFEST}: must be a JSON object`);
		return done();
	}

	if (!manifest.name) errors.push(`${MANIFEST}: missing "name"`);
	else if (typeof manifest.name !== 'string' || !NAME.test(manifest.name)) {
		errors.push(`${MANIFEST}: name "${manifest.name}" must be lowercase letters, digits and single dashes`);
	}
	if (!manifest.version) errors.push(`${MANIFEST}: missing "version"`);
	else if (!SEMVER.test(String(manifest.version))) errors.push(`${MANIFEST}: version "${manifest.version}" is not semver`);
	if (typeof manifest.description !== 'string' || manifest.description.trim().length < 20) {
		errors.push(`${MANIFEST}: "description" is missing or shorter than 20 characters (it is the gallery listing text)`);
	}

	// Context files: Gemini CLI loads GEMINI.md by default, or what contextFileName names.
	const contextNames = manifest.contextFileName === undefined ? ['GEMINI.md'] : [].concat(manifest.contextFileName);
	for (const name of contextNames) {
		if (typeof name !== 'string' || !name) {
			errors.push(`${MANIFEST}: contextFileName entries must be non-empty strings`);
			continue;
		}
		if (!inside(root, name)) {
			errors.push(`${MANIFEST}: context file "${name}" resolves outside the extension`);
			continue;
		}
		if (existsSync(join(root, name))) {
			components.context.push(name);
			KNOWN_TOP.add(name.split(/[\\/]/)[0]);
		} else if (manifest.contextFileName !== undefined) {
			errors.push(`${MANIFEST}: context file "${name}" is missing`);
		}
	}

	const servers = manifest.mcpServers;
	if (servers !== undefined) {
		if (!servers || typeof servers !== 'object' || Array.isArray(servers)) errors.push(`${MANIFEST}: "mcpServers" must be an object`);
		else {
			for (const [name, s] of Object.entries(servers)) {
				const at = `${MANIFEST}: MCP server "${name}"`;
				if (!s || typeof s !== 'object' || Array.isArray(s)) {
					errors.push(`${at} must be an object`);
					continue;
				}
				components.servers.push(name);
				const has = (k) => typeof s[k] === 'string' && s[k].trim().length > 0;
				if (!has('command') && !has('url') && !has('httpUrl') && !has('tcp') && typeof s.tcp !== 'number') {
					errors.push(`${at} needs a transport ("url" with "type", or "command")`);
				}
				if (has('httpUrl')) errors.push(`${at} uses deprecated "httpUrl"; use "url" with "type": "http"`);
				if ('trust' in s) errors.push(`${at} sets "trust", which extensions may not set`);
				if (has('url')) {
					if (!s.url.includes('$')) {
						try {
							const u = new URL(s.url);
							if (u.protocol !== 'https:') errors.push(`${at} url must be https`);
						} catch {
							errors.push(`${at} has an invalid url "${s.url}"`);
						}
					}
					if (s.type !== undefined && !['http', 'sse'].includes(s.type)) errors.push(`${at} type "${s.type}" must be "http" or "sse"`);
					if (s.type === undefined) warnings.push(`${at} has no "type"; Gemini CLI then treats "url" as SSE`);
				}
				if (s.headers && Object.values(s.headers).some((v) => /\$\{?\w+\}?/.test(String(v)) && !/\$\{\w+:-/.test(String(v)))) {
					errors.push(`${at} header references an environment variable with no default; an unset variable is sent literally`);
				}
			}
		}
	}

	for (const f of readdirSync(root)) {
		if (f === '.git') continue;
		if (f === '.env') errors.push('.env: settings values must not ship in the package');
		else if (!KNOWN_TOP.has(f)) errors.push(`${f}: not an extension component or repository file`);
	}

	const commandsDir = join(root, 'commands');
	if (existsSync(commandsDir)) {
		for (const file of walk(commandsDir)) {
			const rel = relative(root, file).split(sep).join('/');
			if (!file.endsWith('.toml')) {
				errors.push(`${rel}: only .toml files load as commands`);
				continue;
			}
			let doc;
			try {
				doc = parseToml(readFileSync(file, 'utf8'));
			} catch (err) {
				errors.push(`${rel}: invalid TOML (${err.message.split('\n')[0]})`);
				continue;
			}
			if (typeof doc.prompt !== 'string' || !doc.prompt.trim()) errors.push(`${rel}: needs a string "prompt"`);
			if (typeof doc.description !== 'string' || !doc.description.trim()) errors.push(`${rel}: needs a string "description" (shown in /help)`);
			for (const k of Object.keys(doc)) if (!['prompt', 'description'].includes(k)) warnings.push(`${rel}: unknown key "${k}" is ignored`);
			const name = relative(commandsDir, file).replace(/\.toml$/, '').split(sep).join(':');
			components.commands.push(`/${name}`);
		}
	}

	const skillsDir = join(root, 'skills');
	if (existsSync(skillsDir)) {
		for (const s of readdirSync(skillsDir).sort()) {
			const p = join(skillsDir, s, 'SKILL.md');
			if (!existsSync(p)) {
				errors.push(`skills/${s}: missing SKILL.md`);
				continue;
			}
			const m = readFileSync(p, 'utf8').match(FRONTMATTER);
			let fm = null;
			try {
				fm = m ? parseYaml(m[1]) : null;
			} catch (err) {
				errors.push(`skills/${s}/SKILL.md: frontmatter is not valid YAML (${err.message.split('\n')[0]})`);
				continue;
			}
			if (!fm || typeof fm.name !== 'string' || typeof fm.description !== 'string') {
				errors.push(`skills/${s}/SKILL.md: frontmatter needs a string name and description`);
				continue;
			}
			if (fm.name !== s) errors.push(`skills/${s}/SKILL.md: name "${fm.name}" does not match its directory`);
			components.skills.push(fm.name);
		}
	}

	const hooksFile = join(root, 'hooks', 'hooks.json');
	if (existsSync(hooksFile)) {
		try {
			const h = JSON.parse(readFileSync(hooksFile, 'utf8'));
			if (!h || typeof h.hooks !== 'object' || h.hooks === null || Array.isArray(h.hooks)) errors.push('hooks/hooks.json: "hooks" must be an object');
		} catch (err) {
			errors.push(`hooks/hooks.json: invalid JSON (${err.message})`);
		}
	}

	if (!existsSync(join(root, 'README.md'))) warnings.push('README.md: missing; the repository page is what gallery visitors open');
	if (!existsSync(join(root, 'LICENSE'))) warnings.push('LICENSE: missing');
	return done(manifest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const dir = process.argv[2];
	if (!dir || dir === '--help' || dir === '-h') {
		console.log('usage: node scripts/validate-gemini-extension.mjs <extension dir>');
		process.exit(dir ? 0 : 2);
	}
	const res = validateGeminiExtension(dir);
	for (const w of res.warnings) console.warn(`warning: ${w}`);
	if (!res.ok) {
		for (const e of res.errors) console.error(`error: ${e}`);
		process.exit(1);
	}
	const c = res.components;
	console.log(`${res.manifest.name} ${res.manifest.version}: valid (servers: ${c.servers.join(', ') || 'none'}; commands: ${c.commands.join(' ') || 'none'}; skills: ${c.skills.join(', ') || 'none'}; context: ${c.context.join(', ') || 'none'})`);
}
