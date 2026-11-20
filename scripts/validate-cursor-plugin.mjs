#!/usr/bin/env node
// Validates a Cursor Plugin directory against what Cursor Marketplace review
// checks, so a submission is not bounced for something a script can catch.
//
// Sources (re-read them when Cursor changes the format):
//   - Manifest and component reference: https://cursor.com/docs/reference/plugins
//     (field tables, Variables, component discovery, Submission checklist)
//   - The name pattern and frontmatter rules of scripts/validate-template.mjs in
//     cursor/plugin-template, commit 46216072ac5750f782f95bb325b4d12b7c3ae9c9.
//   - Marketplace publisher terms: open source, permissive license only
// The manifest schema is vendored at tests/fixtures/cursor-plugin/plugin.schema.json.
//
// Checks: manifest schema, kebab-case name, every referenced file exists,
// component frontmatter, every ${VAR} in MCP and hooks config declared under
// `variables`, every MCP server a remote https URL on the host allowlist,
// manifest under 10 MB, no symlinks, README and permissive LICENSE present,
// no committed secrets.
//
// Usage:
//   node scripts/validate-cursor-plugin.mjs [plugin dir] [--allow-host <host>]... [--json]
// Default dir: integrations/cursor/three-ws. Default allowlist: three.ws and its
// subdomains. Exits 1 when any error is found.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'tests/fixtures/cursor-plugin/plugin.schema.json');

export const DEFAULT_ALLOWED_HOSTS = Object.freeze(['three.ws']);
export const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
// Cursor expands these itself; they are not plugin variables.
const BUILTIN_VARS = new Set(['CURSOR_PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT']);
const KEBAB = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const COMPONENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Cursor's publisher terms accept permissive licenses only.
const PERMISSIVE_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'MIT-0', 'Zlib']);
const MARKDOWN_EXT = new Set(['.md', '.mdc', '.markdown']);
const COMMAND_EXT = new Set([...MARKDOWN_EXT, '.txt']);
const PLACEHOLDER = /\$\{([^}]*)\}/g;
const SECRET_PATTERNS = [
	{ re: /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/, label: 'a three.ws API key (sk_live_/sk_test_)' },
	{ re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'a PEM private key' },
	{ re: /\bxai-[A-Za-z0-9]{20,}/, label: 'an xAI API key' },
	{ re: /\bsk-[A-Za-z0-9_-]{32,}/, label: 'an OpenAI-style API key' },
	{ re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, label: 'a GitHub token' },
];
const TEXT_EXT = new Set(['.md', '.mdc', '.markdown', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.sh', '.yml', '.yaml', '.toml', '.svg', '.html', '']);

let compiledSchema = null;
function schemaValidator() {
	if (!compiledSchema) {
		const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
		compiledSchema = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')));
	}
	return compiledSchema;
}

/**
 * Validate one Cursor Plugin directory.
 * @param {string} dir plugin root (the directory holding .cursor-plugin/)
 * @param {{ allowHosts?: readonly string[] }} [opts]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], manifest: object|null, components: Record<string, string[]>, mcpServers: Array<{ name: string, url: string }> }}
 */
export function validateCursorPlugin(dir, opts = {}) {
	const root = path.resolve(dir);
	const allowHosts = opts.allowHosts?.length ? opts.allowHosts : DEFAULT_ALLOWED_HOSTS;
	const errors = [];
	const warnings = [];
	const components = { rules: [], skills: [], agents: [], commands: [], hooks: [], mcp: [] };
	const mcpServers = [];
	const result = () => ({ ok: errors.length === 0, errors, warnings, manifest, components, mcpServers });
	let manifest = null;

	if (!isDir(root)) {
		errors.push(`${dir}: not a directory`);
		return result();
	}

	// Symlinks first: a reviewer's checkout and Cursor's local loader both treat
	// them differently from a plain file, and one pointing outside the plugin
	// ships content the manifest never names.
	const files = [];
	walk(root, (abs, entry) => {
		const rel = relOf(root, abs);
		if (entry.isSymbolicLink()) errors.push(`${rel}: is a symlink. Replace it with the real file; Cursor skips links that point outside the plugin and reviewers cannot see their target.`);
		else if (entry.isFile()) files.push(rel);
	});

	const manifestRel = '.cursor-plugin/plugin.json';
	const manifestAbs = path.join(root, manifestRel);
	if (!isFile(manifestAbs)) {
		errors.push(`${manifestRel}: missing. A Cursor Plugin needs its manifest at .cursor-plugin/plugin.json.`);
		return result();
	}
	const manifestBytes = fs.statSync(manifestAbs).size;
	if (manifestBytes > MAX_MANIFEST_BYTES) errors.push(`${manifestRel}: ${manifestBytes} bytes, over the 10 MB manifest limit.`);
	const marketplaceAbs = path.join(root, '.cursor-plugin/marketplace.json');
	if (isFile(marketplaceAbs) && fs.statSync(marketplaceAbs).size > MAX_MANIFEST_BYTES) {
		errors.push('.cursor-plugin/marketplace.json: over the 10 MB manifest limit.');
	}

	try {
		manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
	} catch (err) {
		errors.push(`${manifestRel}: invalid JSON (${err.message}).`);
		return result();
	}

	const validate = schemaValidator();
	if (!validate(manifest)) {
		for (const e of validate.errors) {
			// The name pattern gets its own message below, in the reviewer's words.
			if (e.instancePath === '/name' && e.keyword === 'pattern') continue;
			errors.push(formatSchemaError(manifestRel, e));
		}
	}
	if (typeof manifest.name === 'string' && !KEBAB.test(manifest.name)) {
		errors.push(`${manifestRel}: name "${manifest.name}" is not lowercase kebab-case (letters, digits, hyphens, periods; starts and ends alphanumeric).`);
	}

	// Logo.
	if (typeof manifest.logo === 'string' && !/^https?:\/\//.test(manifest.logo)) {
		const logoAbs = safeJoin(root, manifest.logo);
		if (!logoAbs) errors.push(`${manifestRel}: logo "${manifest.logo}" leaves the plugin directory.`);
		else if (!isFile(logoAbs)) errors.push(`${manifestRel}: logo "${manifest.logo}" does not exist. Commit the file and reference it by relative path.`);
		else if (logoAbs.endsWith('.svg') && !fs.readFileSync(logoAbs, 'utf8').includes('<svg')) errors.push(`${manifest.logo}: not an SVG document.`);
	}

	// README and license (submission checklist; publisher terms).
	if (!isFile(path.join(root, 'README.md'))) errors.push('README.md: missing. The submission checklist requires a README that documents usage and configuration.');
	if (!['LICENSE', 'LICENSE.md', 'LICENSE.txt'].some((f) => isFile(path.join(root, f)))) errors.push('LICENSE: missing. Marketplace plugins must be open source under a permissive license.');
	if (typeof manifest.license === 'string' && !PERMISSIVE_LICENSES.has(manifest.license)) {
		errors.push(`${manifestRel}: license "${manifest.license}" is not a permissive license Cursor accepts (${[...PERMISSIVE_LICENSES].join(', ')}).`);
	} else if (manifest.license === undefined) {
		warnings.push(`${manifestRel}: no license field; reviewers look for one.`);
	}

	// Components.
	checkMarkdownComponents('rules', manifest.rules, 'rules', MARKDOWN_EXT, ['description'], { root, errors, components });
	checkMarkdownComponents('agents', manifest.agents, 'agents', MARKDOWN_EXT, ['name', 'description'], { root, errors, components });
	checkMarkdownComponents('commands', manifest.commands, 'commands', COMMAND_EXT, ['name', 'description'], { root, errors, components });
	checkSkills(manifest.skills, { root, errors, components });

	const declared = new Set(Object.keys(manifest.variables?.properties || {}));
	const used = new Set();
	const scanVars = (value, where) => {
		for (const ref of placeholders(value)) {
			used.add(ref);
			if (BUILTIN_VARS.has(ref)) continue;
			if (ref.startsWith('env:')) {
				errors.push(`${where}: \${${ref}} reads the user's shell environment. Declare a plugin variable under "variables" in plugin.json and use \${NAME} instead.`);
			} else if (!declared.has(ref)) {
				errors.push(`${where}: \${${ref}} is not declared. Add "${ref}" under "variables.properties" in ${manifestRel}.`);
			}
		}
	};

	// Hooks.
	const hookSources = manifest.hooks === undefined ? (isFile(path.join(root, 'hooks/hooks.json')) ? ['hooks/hooks.json'] : []) : [manifest.hooks];
	for (const src of hookSources) {
		const loaded = loadConfig(root, src, 'hooks', manifestRel, errors);
		if (!loaded) continue;
		components.hooks.push(loaded.where);
		scanVars(loaded.value, loaded.where);
	}

	// MCP servers.
	const mcpSources = manifest.mcpServers === undefined ? (isFile(path.join(root, 'mcp.json')) ? ['mcp.json'] : []) : [].concat(manifest.mcpServers);
	for (const src of mcpSources) {
		const loaded = loadConfig(root, src, 'mcpServers', manifestRel, errors);
		if (!loaded) continue;
		components.mcp.push(loaded.where);
		scanVars(loaded.value, loaded.where);
		const servers = loaded.value && typeof loaded.value === 'object' && loaded.value.mcpServers && typeof loaded.value.mcpServers === 'object' ? loaded.value.mcpServers : loaded.value;
		if (!servers || typeof servers !== 'object' || Array.isArray(servers) || !Object.keys(servers).length) {
			errors.push(`${loaded.where}: declares no MCP servers. Expected { "mcpServers": { "<name>": { "url": "https://..." } } }.`);
			continue;
		}
		for (const [name, server] of Object.entries(servers)) {
			checkMcpServer(name, server, loaded.where, allowHosts, errors, mcpServers);
		}
	}
	for (const name of declared) {
		if (!used.has(name)) warnings.push(`${manifestRel}: variable "${name}" is declared but no config uses \${${name}}.`);
	}

	// Secrets: a key committed to a public plugin repo is a key published.
	for (const rel of files) {
		if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
		const abs = path.join(root, rel);
		if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
		const text = fs.readFileSync(abs, 'utf8');
		for (const { re, label } of SECRET_PATTERNS) {
			if (re.test(text)) errors.push(`${rel}: contains what looks like ${label}. Remove it; secrets belong in a declared plugin variable set in the Cursor dashboard.`);
		}
	}

	if (!components.mcp.length && !components.skills.length && !components.rules.length && !components.agents.length && !components.commands.length && !components.hooks.length) {
		errors.push(`${dir}: ships no components (no skills, rules, agents, commands, hooks or MCP servers).`);
	}

	return result();
}

function checkMcpServer(name, server, where, allowHosts, errors, out) {
	const label = `${where}: server "${name}"`;
	if (!server || typeof server !== 'object') {
		errors.push(`${label} is not an object.`);
		return;
	}
	if (server.command !== undefined) {
		errors.push(`${label} runs a local command ("${server.command}"). This plugin's policy is remote servers only, on ${allowHosts.join(', ')}.`);
		return;
	}
	if (typeof server.url !== 'string') {
		errors.push(`${label} has neither "url" nor "command".`);
		return;
	}
	let url;
	try {
		url = new URL(server.url.replace(PLACEHOLDER, 'x'));
	} catch {
		errors.push(`${label} url "${server.url}" is not a valid URL.`);
		return;
	}
	if (url.protocol !== 'https:') errors.push(`${label} url "${server.url}" is not https.`);
	const host = url.hostname.toLowerCase();
	const allowed = allowHosts.some((h) => host === h || host.endsWith(`.${h}`));
	if (!allowed) errors.push(`${label} url "${server.url}" points at ${host}, which is not on the allowlist (${allowHosts.join(', ')}).`);
	out.push({ name, url: server.url });
}

function checkSkills(field, { root, errors, components }) {
	const roots = field === undefined ? (isDir(path.join(root, 'skills')) ? ['skills'] : []) : [].concat(field);
	if (field === undefined && !roots.length && isFile(path.join(root, 'SKILL.md'))) {
		checkFrontmatter(root, 'SKILL.md', ['name', 'description'], errors, true);
		components.skills.push('SKILL.md');
		return;
	}
	for (const rel of roots) {
		const abs = safeJoin(root, rel);
		if (!abs || !fs.existsSync(abs)) {
			errors.push(`.cursor-plugin/plugin.json: skills path "${rel}" does not exist.`);
			continue;
		}
		const skillDirs = isFile(path.join(abs, 'SKILL.md')) ? [abs] : fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(abs, e.name));
		for (const skillDir of skillDirs.sort()) {
			const skillRel = relOf(root, path.join(skillDir, 'SKILL.md'));
			if (!isFile(path.join(skillDir, 'SKILL.md'))) {
				errors.push(`${relOf(root, skillDir)}: skill directory has no SKILL.md.`);
				continue;
			}
			const fm = checkFrontmatter(root, skillRel, ['name', 'description'], errors, true);
			if (fm && typeof fm.name === 'string' && fm.name !== path.basename(skillDir)) {
				errors.push(`${skillRel}: frontmatter name "${fm.name}" does not match its directory "${path.basename(skillDir)}".`);
			}
			components.skills.push(skillRel);
		}
	}
}

function checkMarkdownComponents(kind, field, defaultDir, exts, required, { root, errors, components }) {
	const roots = field === undefined ? (isDir(path.join(root, defaultDir)) ? [defaultDir] : []) : [].concat(field);
	for (const rel of roots) {
		const abs = safeJoin(root, rel);
		if (!abs || !fs.existsSync(abs)) {
			errors.push(`.cursor-plugin/plugin.json: ${kind} path "${rel}" does not exist.`);
			continue;
		}
		const entries = isFile(abs) ? [abs] : listFiles(abs).filter((f) => exts.has(path.extname(f).toLowerCase()));
		if (isDir(abs) && !entries.length) errors.push(`${relOf(root, abs)}: ${kind} directory holds no ${[...exts].join('/')} files.`);
		for (const file of entries) {
			const fileRel = relOf(root, file);
			if (path.extname(file).toLowerCase() === '.txt') {
				components[kind].push(fileRel);
				continue;
			}
			const fm = checkFrontmatter(root, fileRel, required, errors, kind !== 'rules');
			if (kind === 'rules' && fm) {
				if (fm.alwaysApply !== undefined && typeof fm.alwaysApply !== 'boolean') errors.push(`${fileRel}: alwaysApply must be true or false.`);
				if (fm.globs !== undefined && typeof fm.globs !== 'string' && !(Array.isArray(fm.globs) && fm.globs.every((g) => typeof g === 'string'))) {
					errors.push(`${fileRel}: globs must be a string or a list of strings.`);
				}
			}
			components[kind].push(fileRel);
		}
	}
}

function checkFrontmatter(root, rel, required, errors, nameIsComponentId) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
	const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
	if (!match) {
		errors.push(`${rel}: missing YAML frontmatter (expected a --- block with ${required.join(' and ')}).`);
		return null;
	}
	let fm;
	try {
		fm = parseYaml(match[1]) || {};
	} catch (err) {
		errors.push(`${rel}: frontmatter is not valid YAML (${err.message.split('\n')[0]}).`);
		return null;
	}
	for (const key of required) {
		if (typeof fm[key] !== 'string' || !fm[key].trim()) errors.push(`${rel}: frontmatter needs a non-empty "${key}".`);
	}
	if (nameIsComponentId && typeof fm.name === 'string' && !COMPONENT_NAME.test(fm.name)) {
		errors.push(`${rel}: name "${fm.name}" is not lowercase kebab-case.`);
	}
	return fm;
}

function loadConfig(root, src, field, manifestRel, errors) {
	if (src && typeof src === 'object') return { value: src, where: `${manifestRel} (inline ${field})` };
	if (typeof src !== 'string') return null;
	const abs = safeJoin(root, src);
	if (!abs) {
		errors.push(`${manifestRel}: ${field} path "${src}" leaves the plugin directory.`);
		return null;
	}
	if (!isFile(abs)) {
		errors.push(`${manifestRel}: ${field} file "${src}" does not exist.`);
		return null;
	}
	try {
		return { value: JSON.parse(fs.readFileSync(abs, 'utf8')), where: relOf(root, abs) };
	} catch (err) {
		errors.push(`${relOf(root, abs)}: invalid JSON (${err.message}).`);
		return null;
	}
}

function placeholders(value) {
	const out = [];
	const visit = (v) => {
		if (typeof v === 'string') for (const m of v.matchAll(PLACEHOLDER)) out.push(m[1]);
		else if (Array.isArray(v)) v.forEach(visit);
		else if (v && typeof v === 'object') Object.values(v).forEach(visit);
	};
	visit(value);
	return out;
}

function formatSchemaError(file, e) {
	const at = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(root)';
	if (e.keyword === 'additionalProperties') {
		const where = e.instancePath ? `${at}.` : '';
		return `${file}: field "${where}${e.params.additionalProperty}" is not defined by the Cursor manifest reference. Remove it (https://cursor.com/docs/reference/plugins).`;
	}
	if (e.keyword === 'required') return `${file}: ${at} is missing required field "${e.params.missingProperty}".`;
	if (e.keyword === 'pattern' && at === 'version') return `${file}: version "${e.data}" is not a semantic version (MAJOR.MINOR.PATCH).`;
	if (e.keyword === 'not' || (e.keyword === 'oneOf' && /^(rules|agents|skills|commands|hooks|mcpServers|logo)/.test(at))) {
		return `${file}: ${at} must be a relative path inside the plugin (no "..", no absolute path) or the documented object form.`;
	}
	return `${file}: ${at} ${e.message}.`;
}

function walk(dir, visit) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === '.git' || entry.name === 'node_modules') continue;
		const abs = path.join(dir, entry.name);
		visit(abs, entry);
		if (entry.isDirectory()) walk(abs, visit);
	}
}

function listFiles(dir) {
	const out = [];
	walk(dir, (abs, entry) => {
		if (entry.isFile()) out.push(abs);
	});
	return out.sort();
}

function safeJoin(root, rel) {
	if (typeof rel !== 'string' || path.isAbsolute(rel)) return null;
	const abs = path.resolve(root, rel);
	return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

function relOf(root, abs) {
	return path.relative(root, abs).split(path.sep).join('/');
}

function isDir(p) {
	try {
		return fs.lstatSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isFile(p) {
	try {
		return fs.lstatSync(p).isFile();
	} catch {
		return false;
	}
}

function main(argv) {
	const allowHosts = [];
	let json = false;
	let dir = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--allow-host') allowHosts.push(String(argv[++i] || '').toLowerCase());
		else if (argv[i] === '--json') json = true;
		else if (!dir) dir = argv[i];
	}
	dir ||= path.join(ROOT, 'integrations/cursor/three-ws');
	const res = validateCursorPlugin(dir, { allowHosts });
	if (json) {
		process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
	} else {
		const shown = path.relative(process.cwd(), path.resolve(dir)) || '.';
		console.log(`Cursor plugin: ${shown}`);
		if (res.manifest) console.log(`  manifest  ${res.manifest.name}@${res.manifest.version ?? '(no version)'}`);
		for (const [kind, list] of Object.entries(res.components)) {
			if (list.length) console.log(`  ${kind.padEnd(9)} ${list.length}  ${list.join(', ')}`);
		}
		for (const s of res.mcpServers) console.log(`  server    ${s.name} -> ${s.url}`);
		for (const w of res.warnings) console.log(`  WARN  ${w}`);
		for (const e of res.errors) console.log(`  FAIL  ${e}`);
		console.log(res.ok ? `PASS  0 errors, ${res.warnings.length} warning(s)` : `FAIL  ${res.errors.length} error(s), ${res.warnings.length} warning(s)`);
	}
	process.exit(res.ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
