#!/usr/bin/env node
// Exports a coding-agent plugin from this monorepo as a standalone git
// repository with the plugin at the tree root, the shape plugin marketplaces
// (xAI's xai-org/plugin-marketplace, Claude Code's, Cursor's) clone and pin.
//
//   node scripts/export-plugin-repo.mjs --src integrations/grok/three-ws --out dist/three-ws-grok
//   node scripts/export-plugin-repo.mjs --src <plugin dir> --out <dir> [--grok-bin <path to grok>]
//
// The exported tree holds:
//   - every file of the plugin directory, at the root (so .grok-plugin/ or
//     .claude-plugin/ sits at the top);
//   - LICENSE (the plugin's own, or this repository's when it has none);
//   - README.md, with links that pointed outside the plugin rewritten to the
//     repository URL from the manifest so they still resolve;
//   - .gitignore (the plugin's own, or one that ignores node_modules and
//     .DS_Store);
//   - CHANGELOG.md, built from this repository's git history of the plugin
//     directory and grouped by the manifest version each commit shipped.
// Then it validates the tree (the manifest rules Grok Build enforces, plus the
// component layout; a tree with .cursor-plugin/plugin.json must also pass
// scripts/validate-cursor-plugin.mjs, the Cursor Marketplace gate), runs `grok plugin validate` too when --grok-bin is given,
// and makes one git commit.
//
// Deterministic: the same plugin files and history give the same tree and the
// same commit SHA. The commit date is the date of the last three.ws commit that
// touched the plugin, and the identity is fixed, so the SHA a marketplace entry
// pins can be reproduced from this repository at any time.
//
// Creating the public repository and pushing this commit is the owner's step
// (CLAUDE.md gate 2); this script never touches a remote.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCursorPlugin } from './validate-cursor-plugin.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AUTHOR = Object.freeze({ name: 'three.ws', email: 'support@three.ws' });
const MANIFEST_PATHS = ['plugin.json', '.grok-plugin/plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json'];
const PLUGIN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const KNOWN_TOP = new Set(['.grok-plugin', '.claude-plugin', '.cursor-plugin', 'plugin.json', '.mcp.json', 'mcp.json', '.lsp.json', 'skills', 'commands', 'agents', 'hooks', 'rules', 'templates', 'assets', 'README.md', 'REVIEWING.md', 'LICENSE', 'CHANGELOG.md', '.gitignore']);
const GITIGNORE = 'node_modules/\n.DS_Store\n';

function git(args, opts = {}) {
	return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function walk(dir) {
	return readdirSync(dir)
		.sort()
		.flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? walk(p) : [p];
		});
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

/** Locate and parse the plugin manifest the way Grok Build does (first match wins). */
export function findManifest(dir) {
	for (const p of MANIFEST_PATHS) {
		const full = join(dir, p);
		if (existsSync(full)) return { path: p, manifest: JSON.parse(readFileSync(full, 'utf8')) };
	}
	return null;
}

/**
 * Validate a plugin tree. Returns a list of problems (empty when valid).
 * Rules: Grok Build's manifest check (name 1-64 chars, lowercase alphanumeric
 * and hyphens, no leading or trailing hyphen), a semver version, a parseable
 * MCP config whose servers are https URLs or commands, frontmatter with a
 * description on every command and agent, a name on every agent and skill, no
 * agent that declares MCP servers, hooks or a bypass permission mode (plugin
 * agents may not), and no top-level entry a plugin loader does not know.
 */
export function validatePluginTree(dir) {
	const problems = [];
	const found = findManifest(dir);
	if (!found) return [`no manifest (looked for ${MANIFEST_PATHS.join(', ')})`];
	const { manifest, path: manifestPath } = found;
	if (typeof manifest.name !== 'string' || manifest.name.length < 1 || manifest.name.length > MAX_NAME || !PLUGIN_NAME.test(manifest.name)) {
		problems.push(`${manifestPath}: name "${manifest.name}" must be 1-${MAX_NAME} chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens`);
	}
	if (manifest.version !== undefined && !SEMVER.test(String(manifest.version))) problems.push(`${manifestPath}: version "${manifest.version}" is not semver`);
	if (!manifest.description || String(manifest.description).length < 20) problems.push(`${manifestPath}: description is missing or shorter than 20 characters`);

	for (const f of readdirSync(dir)) {
		if (f === '.git') continue;
		if (!KNOWN_TOP.has(f)) problems.push(`${f}: not a plugin component or repository file`);
	}

	for (const mcpFile of ['.mcp.json', 'mcp.json']) {
		const p = join(dir, mcpFile);
		if (!existsSync(p)) continue;
		let doc;
		try {
			doc = JSON.parse(readFileSync(p, 'utf8'));
		} catch (err) {
			problems.push(`${mcpFile}: invalid JSON (${err.message})`);
			continue;
		}
		const servers = doc.mcpServers;
		if (!servers || typeof servers !== 'object' || !Object.keys(servers).length) problems.push(`${mcpFile}: no mcpServers`);
		for (const [name, s] of Object.entries(servers || {})) {
			if (s.url) {
				if (!/^https:\/\//.test(s.url)) problems.push(`${mcpFile}: server "${name}" url must be https`);
			} else if (!s.command) problems.push(`${mcpFile}: server "${name}" has neither url nor command`);
		}
	}

	for (const kind of ['commands', 'agents']) {
		const d = join(dir, kind);
		if (!existsSync(d)) continue;
		for (const f of readdirSync(d).sort()) {
			if (!f.endsWith('.md')) {
				problems.push(`${kind}/${f}: only .md files load as ${kind}`);
				continue;
			}
			const fm = frontmatter(readFileSync(join(d, f), 'utf8'));
			if (!fm?.description) problems.push(`${kind}/${f}: frontmatter needs a description`);
			if (kind === 'agents') {
				if (!fm?.name) problems.push(`agents/${f}: frontmatter needs a name`);
				for (const banned of ['mcpServers', 'hooks']) if (fm && banned in fm) problems.push(`agents/${f}: plugin agents may not declare ${banned}`);
				if (fm?.permissionMode === 'bypassPermissions') problems.push(`agents/${f}: plugin agents may not set permissionMode: bypassPermissions`);
				if (fm?.maxTurns !== undefined && !(Number(fm.maxTurns) > 0)) problems.push(`agents/${f}: maxTurns must be greater than 0`);
			}
		}
	}

	const skills = join(dir, 'skills');
	if (existsSync(skills)) {
		for (const s of readdirSync(skills).sort()) {
			const p = join(skills, s, 'SKILL.md');
			if (!existsSync(p)) {
				problems.push(`skills/${s}: missing SKILL.md`);
				continue;
			}
			const fm = frontmatter(readFileSync(p, 'utf8'));
			if (!fm?.name || !fm?.description) problems.push(`skills/${s}/SKILL.md: frontmatter needs name and description`);
		}
	}
	return problems;
}

/** The manifest version a commit shipped, or null when the manifest did not exist yet. */
function versionAt(sha, srcRel, manifestPath) {
	try {
		return JSON.parse(git(['show', `${sha}:${srcRel}/${manifestPath}`])).version || null;
	} catch {
		return null;
	}
}

/**
 * CHANGELOG.md from the git history of the plugin directory, newest first,
 * grouped by the manifest version each commit left in place.
 */
export function buildChangelog({ srcRel, manifest, manifestPath, repoUrl, dirty, headSha }) {
	const log = git(['log', '--format=%H%x09%ad%x09%s', '--date=short', '--', srcRel]);
	const commits = log ? log.split('\n').map((l) => {
		const [sha, date, ...subject] = l.split('\t');
		return { sha, date, subject: subject.join('\t'), version: versionAt(sha, srcRel, manifestPath) };
	}) : [];
	const lines = [
		'# Changelog',
		'',
		`Version history of the \`${manifest.name}\` plugin, newest first. Built from the git history of \`${srcRel}\` in ${repoUrl}, where the plugin is developed.`,
		'',
	];
	const current = manifest.version || 'unversioned';
	if (dirty || !commits.length || commits[0].version !== current) {
		lines.push(`## ${current}`, '', `- Exported from changes on top of ${repoUrl}/commit/${headSha} that are not yet in a three.ws commit.`, '');
	}
	let group = null;
	for (const c of commits) {
		const v = c.version || 'unversioned';
		if (v !== group) {
			lines.push(`## ${v}`, '');
			group = v;
		}
		lines.push(`- ${c.date}: ${c.subject} ([${c.sha.slice(0, 9)}](${repoUrl}/commit/${c.sha}))`);
		const next = commits[commits.indexOf(c) + 1];
		if (!next || (next.version || 'unversioned') !== v) lines.push('');
	}
	return lines.join('\n').replace(/\n+$/, '\n');
}

/**
 * Rewrite Markdown links that leave the plugin directory into absolute links on
 * the source repository, so the standalone README has no dead relative links.
 */
export function rewriteEscapingLinks(markdown, { srcRel, repoUrl, branch = 'main' }) {
	return markdown.replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (whole, target) => {
		const [pathPart, anchor] = target.split('#');
		const resolved = join(srcRel, pathPart).split(sep).join('/');
		if (!resolved.startsWith('..') && resolved.startsWith(`${srcRel}/`)) return whole;
		if (resolved === srcRel) return whole;
		const kind = pathPart.endsWith('/') ? 'tree' : 'blob';
		return `](${repoUrl}/${kind}/${branch}/${resolved.replace(/\/$/, '')}${anchor ? `#${anchor}` : ''})`;
	});
}

export function exportPluginRepo({ src, out, grokBin = null, log = console.log }) {
	const SRC = resolve(REPO, src);
	const OUT = resolve(REPO, out);
	if (!existsSync(SRC) || !statSync(SRC).isDirectory()) throw new Error(`--src ${src}: not a directory`);
	const srcRel = relative(REPO, SRC).split(sep).join('/');
	if (srcRel.startsWith('..')) throw new Error(`--src ${src}: must be inside ${REPO}`);
	if (OUT === REPO || REPO.startsWith(OUT + sep) || OUT === SRC || OUT.startsWith(SRC + sep)) {
		throw new Error(`--out ${out}: refusing to write over the repository or the plugin source`);
	}
	if (existsSync(OUT) && readdirSync(OUT).length && !existsSync(join(OUT, '.git'))) {
		throw new Error(`--out ${out}: exists, is not empty and is not a previous export; pick another directory`);
	}

	const srcProblems = validatePluginTree(SRC);
	if (srcProblems.length) throw new Error(`plugin source is invalid:\n  ${srcProblems.join('\n  ')}`);
	const { manifest, path: manifestPath } = findManifest(SRC);
	const repoUrl = String(manifest.repository || 'https://github.com/nirholas/three.ws').replace(/\.git$/, '').replace(/\/$/, '');

	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	cpSync(SRC, OUT, { recursive: true });

	if (!existsSync(join(OUT, 'LICENSE'))) cpSync(join(REPO, 'LICENSE'), join(OUT, 'LICENSE'));
	if (!existsSync(join(OUT, 'README.md'))) throw new Error(`${srcRel}: no README.md to ship`);
	if (!existsSync(join(OUT, '.gitignore'))) writeFileSync(join(OUT, '.gitignore'), GITIGNORE);
	writeFileSync(join(OUT, 'README.md'), rewriteEscapingLinks(readFileSync(join(OUT, 'README.md'), 'utf8'), { srcRel, repoUrl }));

	const headSha = git(['rev-parse', 'HEAD']);
	const dirty = git(['status', '--porcelain', '--', srcRel]).length > 0;
	writeFileSync(join(OUT, 'CHANGELOG.md'), buildChangelog({ srcRel, manifest, manifestPath, repoUrl, dirty, headSha }));

	const problems = validatePluginTree(OUT);
	if (problems.length) throw new Error(`exported tree is invalid:\n  ${problems.join('\n  ')}`);
	if (existsSync(join(OUT, '.cursor-plugin/plugin.json'))) {
		const cursor = validateCursorPlugin(OUT);
		if (!cursor.ok) throw new Error(`exported tree fails validate-cursor-plugin:\n  ${cursor.errors.join('\n  ')}`);
		log(`validate-cursor-plugin: PASS (${cursor.warnings.length} warning(s))`);
	}
	log(`validate: ${manifest.name} ${manifest.version || ''} OK (${walk(OUT).length} files, manifest ${manifestPath})`);
	if (grokBin) {
		const res = execFileSync(grokBin, ['plugin', 'validate', OUT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		log(`grok plugin validate:\n${res.trim()}`);
	}

	const date = git(['log', '-1', '--format=%cI', '--', srcRel]) || '2026-01-01T00:00:00Z';
	const env = {
		...process.env,
		GIT_AUTHOR_NAME: AUTHOR.name,
		GIT_AUTHOR_EMAIL: AUTHOR.email,
		GIT_COMMITTER_NAME: AUTHOR.name,
		GIT_COMMITTER_EMAIL: AUTHOR.email,
		GIT_AUTHOR_DATE: date,
		GIT_COMMITTER_DATE: date,
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
	};
	const run = (args) => execFileSync('git', args, { cwd: OUT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	run(['init', '--quiet', '--initial-branch=main']);
	run(['add', '--all']);
	const source = `${repoUrl}/tree/${headSha}/${srcRel}${dirty ? ' plus uncommitted changes' : ''}`;
	run(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', `${manifest.name} ${manifest.version || ''}`.trim(), '-m', `Exported from ${source}.`]);
	const sha = run(['rev-parse', 'HEAD']);
	log(`commit: ${sha} (${manifest.name} ${manifest.version || ''}, dated ${date})`);
	log(`exported to ${OUT}`);
	return { out: OUT, sha, manifest, dirty, files: walk(OUT).filter((f) => !f.includes(`${sep}.git${sep}`)).map((f) => relative(OUT, f)) };
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--src' || a === '--out' || a === '--grok-bin') {
			if (!argv[i + 1]) throw new Error(`${a} needs a value`);
			args[a.slice(2).replace('-b', 'B')] = argv[++i];
		} else if (a === '--help' || a === '-h') args.help = true;
		else throw new Error(`unknown argument ${a}`);
	}
	return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.help || !args.src || !args.out) {
			console.log('usage: node scripts/export-plugin-repo.mjs --src <plugin dir> --out <dir> [--grok-bin <path to grok>]');
			process.exit(args.help ? 0 : 2);
		}
		exportPluginRepo({ src: args.src, out: args.out, grokBin: args.grokBin || null });
	} catch (err) {
		console.error(`export-plugin-repo: ${err.message}`);
		process.exit(1);
	}
}
