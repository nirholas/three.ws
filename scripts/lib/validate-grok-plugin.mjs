// Validates a Grok Build plugin tree (xAI's grok CLI, plugin format
// `.grok-plugin/plugin.json`) before it is exported or listed in
// xai-org/plugin-marketplace.
//
// Checks, from the Grok Build loader and its docs (docs/user-guide/09-plugins.md):
//   - the manifest is found in the order Grok Build looks (plugin.json,
//     .grok-plugin/plugin.json, .claude-plugin/plugin.json) and parses;
//   - the name is 1-64 chars, lowercase alphanumeric and hyphens, with no leading
//     or trailing hyphen (the rule `grok plugin validate` enforces);
//   - the version, when present, is semver, and the description says something;
//   - .mcp.json parses, and every server is an https URL or a command;
//   - every command and agent is a Markdown file with a description in its
//     frontmatter, every agent has a name, and no agent declares MCP servers,
//     hooks or bypassPermissions (plugin agents may not), and maxTurns > 0;
//   - every skill directory has a SKILL.md with a name and a description;
//   - nothing executable ships unless it sits under hooks/ or bin/.
// With `grokBin` (or GROK_BIN), also runs the real `grok plugin validate <dir>`
// and fails on a nonzero exit.
//
//   node scripts/lib/validate-grok-plugin.mjs integrations/grok/three-ws

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATHS = ['plugin.json', '.grok-plugin/plugin.json', '.claude-plugin/plugin.json'];
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const REPO_FILES = new Set(['README.md', 'LICENSE', 'CHANGELOG.md', '.gitignore', '.git']);
const COMPONENTS = new Set(['.grok-plugin', '.claude-plugin', 'plugin.json', '.mcp.json', '.lsp.json', 'skills', 'commands', 'agents', 'hooks', 'bin', 'templates', 'assets']);

/** First manifest Grok Build would load, or null. */
export function findGrokManifest(dir) {
	for (const p of MANIFEST_PATHS) {
		const full = path.join(dir, p);
		if (fs.existsSync(full)) return { file: p, manifest: JSON.parse(fs.readFileSync(full, 'utf8')) };
	}
	return null;
}

function frontmatter(text) {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!m) return null;
	const fields = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (kv) fields[kv[1]] = kv[2];
	}
	return fields;
}

function walk(dir, rel = '') {
	return fs
		.readdirSync(path.join(dir, rel), { withFileTypes: true })
		.filter((e) => e.name !== '.git')
		.flatMap((e) => (e.isDirectory() ? walk(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));
}

/** @returns {{ ok: boolean, errors: string[], warnings: string[], grok: string | null }} */
export function validateGrokPlugin(dir, { grokBin = process.env.GROK_BIN || null } = {}) {
	const errors = [];
	const warnings = [];
	let found;
	try {
		found = findGrokManifest(dir);
	} catch (err) {
		return { ok: false, errors: [`manifest does not parse: ${err.message}`], warnings, grok: null };
	}
	if (!found) return { ok: false, errors: [`no manifest (looked for ${MANIFEST_PATHS.join(', ')})`], warnings, grok: null };
	const { file, manifest } = found;

	if (typeof manifest.name !== 'string' || manifest.name.length < 1 || manifest.name.length > 64 || !NAME.test(manifest.name)) {
		errors.push(`${file}: name ${JSON.stringify(manifest.name)} must be 1-64 chars, lowercase alphanumeric and hyphens, no leading or trailing hyphen`);
	}
	if (manifest.version !== undefined && !SEMVER.test(String(manifest.version))) errors.push(`${file}: version "${manifest.version}" is not semver`);
	if (!manifest.description || String(manifest.description).length < 20) errors.push(`${file}: description is missing or under 20 characters`);
	if (!manifest.license) warnings.push(`${file}: no license field`);

	for (const f of fs.readdirSync(dir)) {
		if (!COMPONENTS.has(f) && !REPO_FILES.has(f)) warnings.push(`${f}: not a Grok Build component; the loader ignores it`);
	}

	const mcp = path.join(dir, '.mcp.json');
	if (fs.existsSync(mcp)) {
		try {
			const servers = JSON.parse(fs.readFileSync(mcp, 'utf8')).mcpServers;
			if (!servers || !Object.keys(servers).length) errors.push('.mcp.json: no mcpServers');
			for (const [name, s] of Object.entries(servers || {})) {
				if (s.url) {
					if (!/^https:\/\//.test(s.url)) errors.push(`.mcp.json: server "${name}" url must be https`);
				} else if (!s.command) errors.push(`.mcp.json: server "${name}" has neither url nor command`);
			}
		} catch (err) {
			errors.push(`.mcp.json: invalid JSON (${err.message})`);
		}
	}

	for (const kind of ['commands', 'agents']) {
		const d = path.join(dir, kind);
		if (!fs.existsSync(d)) continue;
		for (const f of fs.readdirSync(d).sort()) {
			if (!f.endsWith('.md')) {
				errors.push(`${kind}/${f}: only .md files load as ${kind}`);
				continue;
			}
			const fm = frontmatter(fs.readFileSync(path.join(d, f), 'utf8'));
			if (!fm?.description) errors.push(`${kind}/${f}: frontmatter needs a description`);
			if (kind !== 'agents') continue;
			if (!fm?.name) errors.push(`agents/${f}: frontmatter needs a name`);
			for (const banned of ['mcpServers', 'hooks']) if (fm && banned in fm) errors.push(`agents/${f}: plugin agents may not declare ${banned}`);
			if (fm?.permissionMode === 'bypassPermissions') errors.push(`agents/${f}: plugin agents may not use bypassPermissions`);
			if (fm?.maxTurns !== undefined && !(Number(fm.maxTurns) > 0)) errors.push(`agents/${f}: maxTurns must be greater than 0`);
		}
	}

	const skills = path.join(dir, 'skills');
	if (fs.existsSync(skills)) {
		for (const s of fs.readdirSync(skills).sort()) {
			const p = path.join(skills, s, 'SKILL.md');
			if (!fs.existsSync(p)) {
				errors.push(`skills/${s}: missing SKILL.md`);
				continue;
			}
			const fm = frontmatter(fs.readFileSync(p, 'utf8'));
			if (!fm?.name || !fm?.description) errors.push(`skills/${s}/SKILL.md: frontmatter needs a name and a description`);
		}
	}

	for (const rel of walk(dir)) {
		if (/^(hooks|bin)\//.test(rel)) continue;
		if (fs.statSync(path.join(dir, rel)).mode & 0o111) errors.push(`${rel}: is executable outside hooks/ or bin/`);
	}

	let grok = null;
	if (grokBin && !errors.length) {
		try {
			grok = execFileSync(grokBin, ['plugin', 'validate', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
		} catch (err) {
			errors.push(`grok plugin validate failed: ${(err.stderr || err.stdout || err.message).toString().trim()}`);
		}
	}
	return { ok: errors.length === 0, errors, warnings, grok };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const dir = path.resolve(process.argv[2] || '.');
	const res = validateGrokPlugin(dir);
	for (const e of res.errors) console.error(`  ERROR ${e}`);
	for (const w of res.warnings) console.log(`  WARN  ${w}`);
	if (res.grok) console.log(res.grok);
	console.log(res.ok ? `${path.relative(process.cwd(), dir) || '.'}: valid Grok Build plugin` : `${res.errors.length} error(s)`);
	process.exitCode = res.ok ? 0 : 1;
}
