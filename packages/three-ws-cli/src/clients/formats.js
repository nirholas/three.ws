// Read and write one named server entry in a client config file, preserving
// everything else in the file: other servers, unrelated settings, comments and
// formatting. Three on-disk formats cover every supported client.
//
//   json  JSON or JSONC (VS Code allows comments). Edited with jsonc-parser's
//         modify/applyEdits, the same engine VS Code uses on its own settings,
//         so a hand-formatted file keeps its layout and its comments.
//   toml  Codex. The server's [mcp_servers.<name>] table family is cut out of
//         the text and a fresh one appended, so comments elsewhere survive; the
//         result is re-parsed before it is written.
//   yaml  Hermes. yaml's Document API keeps comments and key order.
//
// Before any change the current bytes are copied to `<file>.three-ws.bak`.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseJsonc, modify, applyEdits, printParseErrorCode } from 'jsonc-parser';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import YAML from 'yaml';

function readText(file) {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw err;
	}
}

function writeText(file, text, previous) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (previous != null) fs.writeFileSync(`${file}.three-ws.bak`, previous, { mode: 0o600 });
	let mode = 0o600;
	try { mode = fs.statSync(file).mode & 0o777; } catch { /* new file: owner-only, it may hold a key */ }
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, text, { mode });
	fs.renameSync(tmp, file);
}

// ── json / jsonc ─────────────────────────────────────────────────────────────

function parseJsonText(text, file) {
	if (text == null || !text.trim()) return {};
	const errors = [];
	const data = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
	if (errors.length) {
		const first = errors[0];
		throw new Error(`${file} is not valid JSON (${printParseErrorCode(first.error)} at offset ${first.offset}); fix it by hand, then run setup again`);
	}
	return data && typeof data === 'object' ? data : {};
}

function formattingFor(text) {
	const indented = /\n([ \t]+)\S/.exec(text || '');
	if (indented && indented[1].startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol: '\n' };
	const size = indented ? indented[1].length : 2;
	return { insertSpaces: true, tabSize: Math.min(Math.max(size, 2), 8), eol: '\n' };
}

const json = {
	read(file, rootKey) {
		const data = parseJsonText(readText(file), file);
		const root = data?.[rootKey];
		return root && typeof root === 'object' ? root : {};
	},
	set(file, rootKey, name, value) {
		const before = readText(file);
		parseJsonText(before, file);
		const text = before && before.trim() ? before : '{}\n';
		const edits = modify(text, [rootKey, name], value, { formattingOptions: formattingFor(text) });
		let next = applyEdits(text, edits);
		if (!next.endsWith('\n')) next += '\n';
		parseJsonText(next, file);
		writeText(file, next, before);
	},
	remove(file, rootKey, name) {
		const before = readText(file);
		if (before == null) return false;
		const data = parseJsonText(before, file);
		if (!data?.[rootKey] || !(name in data[rootKey])) return false;
		const next = applyEdits(before, modify(before, [rootKey, name], undefined, { formattingOptions: formattingFor(before) }));
		writeText(file, next, before);
		return true;
	},
};

// ── toml (Codex) ─────────────────────────────────────────────────────────────

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lines of `text` with every table belonging to [<root>.<name>] removed.
export function stripTomlTable(text, root, name) {
	const namePattern = `(?:${escapeRe(name)}|"${escapeRe(name)}"|'${escapeRe(name)}')`;
	const own = new RegExp(`^\\s*\\[\\s*${escapeRe(root)}\\s*\\.\\s*${namePattern}\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`);
	const anyHeader = /^\s*\[/;
	const out = [];
	let skipping = false;
	for (const line of String(text).split('\n')) {
		if (own.test(line)) { skipping = true; continue; }
		if (skipping && anyHeader.test(line)) skipping = false;
		if (!skipping) out.push(line);
	}
	return out.join('\n').replace(/\n{3,}$/g, '\n\n');
}

const toml = {
	read(file, rootKey) {
		const text = readText(file);
		if (!text || !text.trim()) return {};
		const data = parseToml(text);
		return data?.[rootKey] && typeof data[rootKey] === 'object' ? data[rootKey] : {};
	},
	set(file, rootKey, name, value) {
		const before = readText(file);
		if (before && before.trim()) parseToml(before);
		const kept = stripTomlTable(before || '', rootKey, name).replace(/\s+$/, '');
		const block = stringifyToml({ [rootKey]: { [name]: value } });
		const next = `${kept ? `${kept}\n\n` : ''}${block.trim()}\n`;
		parseToml(next);
		writeText(file, next, before);
	},
	remove(file, rootKey, name) {
		const before = readText(file);
		if (!before) return false;
		const data = parseToml(before);
		if (!data?.[rootKey]?.[name]) return false;
		const next = `${stripTomlTable(before, rootKey, name).replace(/\s+$/, '')}\n`;
		parseToml(next);
		writeText(file, next, before);
		return true;
	},
};

// ── yaml (Hermes) ────────────────────────────────────────────────────────────

const yaml = {
	read(file, rootKey) {
		const text = readText(file);
		if (!text || !text.trim()) return {};
		const doc = YAML.parseDocument(text);
		if (doc.errors.length) throw new Error(`${file} is not valid YAML: ${doc.errors[0].message}`);
		const root = doc.toJS()?.[rootKey];
		return root && typeof root === 'object' ? root : {};
	},
	set(file, rootKey, name, value) {
		const before = readText(file);
		const doc = YAML.parseDocument(before || '');
		if (doc.errors.length) throw new Error(`${file} is not valid YAML: ${doc.errors[0].message}`);
		if (!doc.contents) doc.contents = doc.createNode({});
		doc.setIn([rootKey, name], doc.createNode(value));
		writeText(file, doc.toString(), before);
	},
	remove(file, rootKey, name) {
		const before = readText(file);
		if (!before) return false;
		const doc = YAML.parseDocument(before);
		if (!doc.hasIn([rootKey, name])) return false;
		doc.deleteIn([rootKey, name]);
		writeText(file, doc.toString(), before);
		return true;
	},
};

export const FORMATS = { json, toml, yaml };
