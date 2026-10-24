// Publish-time supply-chain scanner for marketplace skill bundles.
//
// A skill bundle is four files: manifest.json, SKILL.md, tools.json and an
// optional handlers.js. Handlers run in the agent runtime next to wallet
// tools, so a skill registry that accepts third-party code needs static
// analysis before any of it is installable. This module is the analysis.
//
// It never executes anything. handlers.js is parsed to an AST (acorn) and
// walked; SKILL.md and the tool descriptions are read as prose the model will
// obey; tools.json and the manifest are checked against what the handlers
// actually do.
//
// Verdicts:
//   blocked  at least one `block` finding. Cannot be published or installed.
//   review   `review` findings only. Held for a moderator, findings attached.
//   clean    nothing beyond `info`.
//
// Every finding carries a file, a line and fix guidance, so the publish UI can
// tell the author exactly what to change.

import { parse as parseJs } from 'acorn';
import { staticFindings as proseFindings, classifyTool } from './skill-import-scan.js';

export const SUPPLY_SCANNER_VERSION = '1.0.0';

export const SEVERITIES = Object.freeze(['block', 'review', 'info']);
export const VERDICTS = Object.freeze(['clean', 'review', 'blocked']);

const MAX_HANDLERS_BYTES = 256 * 1024;

// ── Fix guidance, one line per rule ─────────────────────────────────────────

const FIX = {
	unparseable: 'Fix the syntax error. handlers.js must be a plain ES module that parses without a build step.',
	oversized: 'Split the skill or remove bundled data. handlers.js must stay under 256 KB of readable source.',
	env_access: 'Remove the environment read. Handlers receive everything they need through ctx; secrets are never theirs to read.',
	secret_material: 'Do not touch key material. Wallet actions go through the platform wallet tools, which ask the owner to confirm.',
	credential_store: 'Remove the storage or cookie read. A skill must keep state with ctx.memory only.',
	forbidden_import: 'Remove the import. Handlers cannot load Node built-ins or remote code; use ctx.fetch for network and ctx.* for the rest.',
	unverified_import: 'Remove the import and inline what you need. Only ctx.* is available inside the sandbox.',
	undeclared_host: 'Add this host to requires.network in manifest.json, or remove the call. Calls to hosts the manifest does not name are held.',
	dynamic_network_target: 'Build the URL from a literal host so the scanner can check it, and list that host in requires.network.',
	exfil_sink: 'Remove this destination. Webhook catchers, tunnels, paste sites, raw IP hosts and metadata endpoints are never legitimate skill backends.',
	secret_to_network: 'Remove the secret from the request. A skill must never send keys, tokens, cookies or environment values anywhere.',
	secret_with_network: 'Handlers that read secrets must not make network calls. Remove one of the two.',
	dynamic_code: 'Remove eval, Function and string timers. Write the logic as ordinary code so it can be reviewed.',
	dynamic_import: 'Import only fixed, relative paths, or drop the import entirely.',
	obfuscated_string: 'Write the string out in plain text. Strings assembled at runtime to hide a name or host are blocked.',
	obfuscated_identifiers: 'Publish readable source. Machine-mangled identifiers cannot be reviewed.',
	encoded_blob: 'Remove the encoded data, or ship it as a documented asset next to the skill. Opaque blobs inside handlers are held.',
	hidden_payload: 'Remove the encoded payload. Decoding it reveals a host, a secret or executable code.',
	escaped_strings: 'Write strings as readable text rather than long runs of escape sequences.',
	minified: 'Publish the unminified source. Reviewers and installing owners must be able to read the code.',
	worker_spawn: 'Remove the Worker or WebAssembly use. A skill runs inside one sandbox worker and cannot start its own.',
	excess_permission: 'Declare this tool in requires.tools (or its capability in requires.capabilities) in manifest.json and say why in the description, or remove the call.',
	purpose_mismatch: 'Describe in manifest.json and SKILL.md why a skill with this purpose needs that capability, or remove the capability.',
	secret_param: 'Remove the parameter. A tool must never ask the model or the person for a private key, seed phrase, password or token.',
	tool_text_injection: 'Rewrite the tool text as a plain description of what the tool does.',
	prose: 'Rewrite the instruction so it does not ask the agent to hide actions, skip confirmation, reveal secrets or ignore its other rules.',
	skip_confirmation: 'Remove the line. Every spend, signature and outbound message needs the owner to confirm; a skill cannot waive that.',
	hidden_text: 'Remove the invisible characters and hidden comments. Every instruction must be visible to the owner who installs the skill.',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function finding(file, rule, severity, message, loc, extra = {}) {
	return {
		rule,
		severity,
		file,
		line: loc?.line ?? null,
		column: loc?.column != null ? loc.column + 1 : null,
		message,
		fix: FIX[rule] || FIX.prose,
		...extra,
	};
}

const locOf = (node) => node?.loc?.start || null;

function snippetAt(lines, loc) {
	if (!loc || !lines[loc.line - 1]) return undefined;
	const s = lines[loc.line - 1].trim();
	return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

// Names whose presence in a runtime-built string means the author is hiding it.
const SENSITIVE_RUNTIME =
	/(^|[^a-z])(process|env|eval|function|constructor|fetch|xmlhttprequest|websocket|sendbeacon|require|child_process|localstorage|sessionstorage|cookie|privatekey|private_key|secretkey|secret_key|mnemonic|seed ?phrase|keypair|authorization|https?:\/\/|wss?:\/\/)/i;

const SECRET_PROP = /^(private_?key|secret_?key|secretkey|privatekey|mnemonic|seed|seed_?phrase|keypair|export_?key|get_?private_?key|decrypt_?key)$/i;

const NODE_BUILTINS = new Set([
	'fs',
	'child_process',
	'net',
	'http',
	'https',
	'http2',
	'dgram',
	'tls',
	'dns',
	'os',
	'vm',
	'worker_threads',
	'cluster',
	'crypto',
	'module',
	'process',
	'v8',
	'repl',
	'inspector',
	'zlib',
	'stream',
	'path',
]);

const EXFIL_HOST =
	/(^|\.)(webhook\.site|requestbin\.(com|net)|pipedream\.net|ngrok(-free)?\.(io|app|dev)|trycloudflare\.com|loca\.lt|localtunnel\.me|serveo\.net|pastebin\.com|paste\.ee|hastebin\.com|transfer\.sh|oast\.(pro|live|site|online|fun|me)|interact\.sh|burpcollaborator\.net|requestcatcher\.com|beeceptor\.com|mockbin\.io|discord(app)?\.com|api\.telegram\.org|hooks\.slack\.com|ifconfig\.me|ipinfo\.io|pipedream\.com)$/i;
const METADATA_HOST = /^(169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254)$/i;

function hostMatches(host, patterns) {
	const h = host.toLowerCase();
	return patterns.some((p) => {
		const pat = String(p).toLowerCase().trim();
		if (pat === '*') return true;
		if (pat.startsWith('*.')) return h === pat.slice(2) || h.endsWith(pat.slice(1));
		return h === pat;
	});
}

function hostOf(url) {
	try {
		const u = new URL(url);
		if (!/^(https?|wss?):$/.test(u.protocol)) return null;
		return u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	} catch {
		return null;
	}
}

function isIpHost(host) {
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function entropy(str) {
	const counts = new Map();
	for (const ch of str) counts.set(ch, (counts.get(ch) || 0) + 1);
	let h = 0;
	for (const n of counts.values()) {
		const p = n / str.length;
		h -= p * Math.log2(p);
	}
	return h;
}

// ── Constant folding: resolve strings the author assembled at runtime ───────

function makeFolder(constants) {
	const fold = (node, depth = 0) => {
		if (!node || depth > 12) return undefined;
		switch (node.type) {
			case 'Literal':
				return typeof node.value === 'string' ? node.value : typeof node.value === 'number' ? String(node.value) : undefined;
			case 'TemplateLiteral': {
				let out = '';
				for (let i = 0; i < node.quasis.length; i++) {
					out += node.quasis[i].value.cooked ?? '';
					if (i < node.expressions.length) {
						const v = fold(node.expressions[i], depth + 1);
						if (v === undefined) return undefined;
						out += v;
					}
				}
				return out;
			}
			case 'BinaryExpression': {
				if (node.operator !== '+') return undefined;
				const a = fold(node.left, depth + 1);
				const b = fold(node.right, depth + 1);
				return a === undefined || b === undefined ? undefined : a + b;
			}
			case 'Identifier':
				return constants.has(node.name) ? constants.get(node.name) : undefined;
			case 'CallExpression': {
				const c = node.callee;
				if (c.type === 'Identifier' && c.name === 'atob' && node.arguments.length === 1) {
					const v = fold(node.arguments[0], depth + 1);
					if (v === undefined) return undefined;
					try {
						return Buffer.from(v, 'base64').toString('latin1');
					} catch {
						return undefined;
					}
				}
				if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
					const objName = c.object.type === 'Identifier' ? c.object.name : null;
					if (objName === 'String' && c.property.name === 'fromCharCode') {
						const codes = node.arguments.map((a) => (a.type === 'Literal' && typeof a.value === 'number' ? a.value : NaN));
						return codes.every(Number.isFinite) ? String.fromCharCode(...codes) : undefined;
					}
					if (objName === 'Buffer' && c.property.name === 'from') {
						const v = fold(node.arguments[0], depth + 1);
						const enc = fold(node.arguments[1], depth + 1);
						if (v !== undefined && (enc === 'base64' || enc === 'hex')) return Buffer.from(v, enc).toString('latin1');
						return undefined;
					}
					if (c.property.name === 'join' && c.object.type === 'ArrayExpression') {
						const sep = node.arguments.length ? fold(node.arguments[0], depth + 1) : ',';
						const parts = c.object.elements.map((e) => fold(e, depth + 1));
						return sep === undefined || parts.some((p) => p === undefined) ? undefined : parts.join(sep);
					}
					if (c.property.name === 'toString' || c.property.name === 'toLowerCase' || c.property.name === 'trim') {
						return fold(c.object, depth + 1);
					}
					if (c.property.name === 'concat') {
						let acc = fold(c.object, depth + 1);
						for (const a of node.arguments) {
							const v = fold(a, depth + 1);
							if (acc === undefined || v === undefined) return undefined;
							acc += v;
						}
						return acc;
					}
					if (c.property.name === 'reverse' || c.property.name === 'split') return undefined;
				}
				// "abc".split("").reverse().join("")
				if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'join' && c.object.type === 'CallExpression') {
					const rev = c.object;
					if (rev.callee.type === 'MemberExpression' && rev.callee.property.name === 'reverse' && rev.callee.object.type === 'CallExpression') {
						const sp = rev.callee.object;
						if (sp.callee.type === 'MemberExpression' && sp.callee.property.name === 'split') {
							const base = fold(sp.callee.object, depth + 1);
							if (base !== undefined) return [...base].reverse().join('');
						}
					}
				}
				return undefined;
			}
			default:
				return undefined;
		}
	};
	return fold;
}

/**
 * The leading, statically known part of a string expression. A URL built as
 * 'https://api.example.com/v1?q=' + encodeURIComponent(x) has a known host
 * even though the whole string is not constant.
 */
function makePrefixer(fold, inits) {
	const prefixOf = (node, depth = 0) => {
		const whole = fold(node);
		if (whole !== undefined) return { value: whole, complete: true };
		if (!node || depth > 12) return { value: '', complete: false };
		if (node.type === 'Identifier' && inits.has(node.name)) return prefixOf(inits.get(node.name), depth + 1);
		if (node.type === 'BinaryExpression' && node.operator === '+') {
			const l = prefixOf(node.left, depth + 1);
			if (!l.complete) return l;
			const r = prefixOf(node.right, depth + 1);
			return { value: l.value + r.value, complete: r.complete };
		}
		if (node.type === 'TemplateLiteral') {
			let value = '';
			for (let i = 0; i < node.quasis.length; i++) {
				value += node.quasis[i].value.cooked ?? '';
				if (i < node.expressions.length) {
					const e = prefixOf(node.expressions[i], depth + 1);
					value += e.value;
					if (!e.complete) return { value, complete: false };
				}
			}
			return { value, complete: true };
		}
		return { value: '', complete: false };
	};
	return prefixOf;
}

function isPlainLiteral(node) {
	return node.type === 'Literal' || (node.type === 'TemplateLiteral' && node.expressions.length === 0);
}

// ── AST walking ─────────────────────────────────────────────────────────────

function walk(node, visit, parent = null) {
	if (!node || typeof node.type !== 'string') return;
	visit(node, parent);
	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
		const v = node[key];
		if (Array.isArray(v)) for (const c of v) walk(c, visit, node);
		else if (v && typeof v.type === 'string') walk(v, visit, node);
	}
}

function memberName(node, fold) {
	if (node.type !== 'MemberExpression') return null;
	if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : null;
	return fold(node.property) ?? null;
}

function rootIdentifier(node) {
	let n = node;
	while (n && (n.type === 'MemberExpression' || n.type === 'ChainExpression' || n.type === 'CallExpression')) {
		n = n.type === 'MemberExpression' ? n.object : n.type === 'ChainExpression' ? n.expression : n.callee;
	}
	return n && n.type === 'Identifier' ? n.name : null;
}

const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global', 'top', 'parent']);

/**
 * Scan handlers.js source. Returns findings plus the facts the permission
 * checks need (tool-name literals, whether secrets or network were seen).
 */
function scanHandlers(src, { declaredHosts, file = 'handlers.js' }) {
	const out = [];
	const lines = src.split('\n');
	const push = (rule, severity, message, node, extra) => {
		const loc = locOf(node);
		out.push({ ...finding(file, rule, severity, message, loc, extra), snippet: snippetAt(lines, loc) });
	};

	if (Buffer.byteLength(src) > MAX_HANDLERS_BYTES) {
		out.push(finding(file, 'oversized', 'block', `handlers.js is ${Math.round(Buffer.byteLength(src) / 1024)} KB; the limit is ${MAX_HANDLERS_BYTES / 1024} KB`, { line: 1, column: 0 }));
		return { findings: out, literals: [], secrets: 0, networkCalls: 0 };
	}

	let ast;
	try {
		ast = parseJs(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true, allowAwaitOutsideFunction: true });
	} catch (err) {
		out.push(
			finding(file, 'unparseable', 'block', `handlers.js does not parse: ${String(err.message).replace(/\s*\(\d+:\d+\)$/, '')}`, err.loc ? { line: err.loc.line, column: err.loc.column } : { line: 1, column: 0 }),
		);
		return { findings: out, literals: [], secrets: 0, networkCalls: 0 };
	}

	// Pass 1: record const/let bindings with foldable string initialisers.
	const constants = new Map();
	const fold = makeFolder(constants);
	for (let pass = 0; pass < 3; pass++) {
		walk(ast, (n) => {
			if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && !constants.has(n.id.name)) {
				const v = fold(n.init);
				if (v !== undefined) constants.set(n.id.name, v);
			}
		});
	}

	const inits = new Map();
	walk(ast, (n) => {
		if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && !inits.has(n.id.name)) inits.set(n.id.name, n.init);
	});
	const prefixOf = makePrefixer(fold, inits);
	const hostFromPrefix = (node) => {
		const p = prefixOf(node);
		if (!p.value) return undefined;
		if (p.complete) return p.value;
		return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+[/?#]/i.test(p.value) ? p.value : undefined;
	};

	const localNames = new Set();
	walk(ast, (n) => {
		if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') localNames.add(n.id.name);
		if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
			for (const p of n.params) if (p.type === 'Identifier') localNames.add(p.name);
		}
	});

	let secrets = 0;
	let networkCalls = 0;
	let networkUnverified = 0;
	const seen = new Set();
	const once = (key) => (seen.has(key) ? false : (seen.add(key), true));
	const hostsSeen = new Map();
	const literals = [];
	const secretNodes = [];
	const networkNodes = [];

	const noteHost = (url, node, via) => {
		const host = hostOf(url);
		if (!host || !once(`host:${host}`)) return;
		hostsSeen.set(host, node);
		if (METADATA_HOST.test(host) || EXFIL_HOST.test(host) || isIpHost(host)) {
			push('exfil_sink', 'block', `${via} ${host}, a destination skills may not use`, node);
		} else if (!hostMatches(host, declaredHosts)) {
			push('undeclared_host', 'review', `${via} ${host}, which manifest.json (requires.network) does not declare`, node);
		}
	};

	const markSecret = (rule, message, node) => {
		secrets += 1;
		secretNodes.push(node);
		if (once(`${rule}:${node.loc?.start.line}`)) push(rule, 'review', message, node);
	};

	// Pass 2: the checks.
	walk(ast, (n, parent) => {
		switch (n.type) {
			case 'ImportDeclaration':
			case 'ImportExpression': {
				const srcNode = n.source;
				const spec = fold(srcNode);
				if (spec === undefined) {
					push('dynamic_import', 'block', 'imports a module whose path is computed at runtime', n);
					break;
				}
				if (/^(https?:|data:|blob:|ipfs:|ftp:)/i.test(spec)) {
					push('forbidden_import', 'block', `loads remote code from ${spec.slice(0, 80)}`, n);
					if (/^https?:/i.test(spec)) noteHost(spec, n, 'imports code from');
				} else if (/^node:/.test(spec) || NODE_BUILTINS.has(spec.split('/')[0])) {
					push('forbidden_import', 'block', `imports the Node built-in "${spec}"`, n);
				} else {
					push('unverified_import', 'review', `imports "${spec}"; the sandbox provides only ctx.*`, n);
				}
				break;
			}
			case 'MetaProperty':
				break;
			case 'Identifier': {
				if (
					n.name === 'process' &&
					!localNames.has('process') &&
					parent &&
					!(parent.type === 'MemberExpression' && parent.property === n && !parent.computed) &&
					!(parent.type === 'Property' && parent.key === n && !parent.computed)
				) {
					markSecret('env_access', 'reads the process object, which exposes environment variables and key material', n);
				}
				if (/^_0x[0-9a-f]{3,}$/i.test(n.name) && once(`obf:${n.name}`)) {
					seen.add('obf-count');
					out.push({ ...finding(file, 'obfuscated_identifiers', 'block', `machine-mangled identifier ${n.name}`, locOf(n)), snippet: snippetAt(lines, locOf(n)), _count: true });
				}
				if ((n.name === 'localStorage' || n.name === 'sessionStorage' || n.name === 'indexedDB' || n.name === 'cookieStore') && !localNames.has(n.name)) {
					markSecret('credential_store', `reads ${n.name}, where wallet adapters and sessions keep credentials`, n);
				}
				if ((n.name === 'Deno' || n.name === 'Bun') && !localNames.has(n.name)) {
					markSecret('env_access', `reads ${n.name}, which exposes environment variables`, n);
				}
				if (n.name === 'importScripts') {
					push('forbidden_import', 'block', 'importScripts loads and runs remote code', n);
				}
				break;
			}
			case 'MemberExpression': {
				const name = memberName(n, fold);
				const objName = n.object.type === 'Identifier' ? n.object.name : null;
				if (n.computed && name !== null && !isPlainLiteral(n.property)) {
					if (SENSITIVE_RUNTIME.test(name) || SECRET_PROP.test(name)) {
						push('obfuscated_string', 'block', `builds the property name "${name.slice(0, 40)}" at runtime to hide it`, n);
					}
				}
				if (name === 'env' && (objName === 'process' || n.object.type === 'MetaProperty' || (n.object.type === 'MemberExpression' && memberName(n.object, fold) === 'process'))) {
					markSecret('env_access', 'reads environment variables', n);
				}
				if (name === 'process' && objName && GLOBAL_OBJECTS.has(objName)) markSecret('env_access', `reads ${objName}.process, which exposes environment variables`, n);
				if (name === 'cookie' && (objName === 'document' || objName === 'cookieStore')) markSecret('credential_store', 'reads document.cookie', n);
				if (name && SECRET_PROP.test(name)) markSecret('secret_material', `touches key material (.${name})`, n);
				if (name === 'credentials' && objName === 'navigator') markSecret('credential_store', 'reads navigator.credentials', n);
				if (name === 'constructor' && parent && parent.type === 'CallExpression' && parent.callee === n && parent.arguments.length) {
					push('dynamic_code', 'block', 'calls .constructor(...) with code, which is eval by another name', n);
				}
				if (name === 'src' && parent && parent.type === 'AssignmentExpression' && parent.left === n) {
					networkCalls += 1;
					networkNodes.push(n);
					const v = fold(parent.right);
					if (v !== undefined) noteHost(v, n, 'loads a resource from');
					else {
						networkUnverified += 1;
						if (once(`dyn:${n.loc.start.line}`)) push('dynamic_network_target', 'review', 'sets a .src to a URL the scanner cannot resolve', n);
					}
				}
				break;
			}
			case 'NewExpression':
			case 'CallExpression': {
				const c = n.callee;
				const calleeName = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? memberName(c, fold) : null;
				const calleeObj = c.type === 'MemberExpression' ? rootIdentifier(c.object) : null;
				const isNew = n.type === 'NewExpression';

				if (c.type === 'Identifier' && (c.name === 'eval' || c.name === 'Function') && !localNames.has(c.name)) {
					push('dynamic_code', 'block', isNew || c.name === 'Function' ? 'constructs code from a string with Function' : 'runs a string as code with eval', n);
				} else if (c.type === 'MemberExpression' && calleeName && /^(eval|Function)$/.test(calleeName) && calleeObj && GLOBAL_OBJECTS.has(calleeObj)) {
					push('dynamic_code', 'block', `runs a string as code with ${calleeObj}.${calleeName}`, n);
				} else if (c.type === 'MemberExpression' && c.computed && calleeName && /^(eval|Function)$/.test(calleeName)) {
					push('dynamic_code', 'block', 'reaches eval through a computed property', n);
				}
				if ((calleeName === 'setTimeout' || calleeName === 'setInterval') && n.arguments.length) {
					const a0 = n.arguments[0];
					if (a0.type === 'Literal' || a0.type === 'TemplateLiteral' || (a0.type === 'BinaryExpression' && fold(a0) !== undefined)) {
						push('dynamic_code', 'block', `${calleeName} with a string runs it as code`, n);
					}
				}
				if (calleeName === 'require' && c.type === 'Identifier' && !localNames.has('require')) {
					const spec = n.arguments.length ? fold(n.arguments[0]) : undefined;
					push('forbidden_import', 'block', spec ? `requires "${spec}"` : 'calls require with a computed module name', n);
				}
				if ((calleeName === 'Worker' || calleeName === 'SharedWorker' || calleeName === 'ServiceWorker') && isNew) {
					push('worker_spawn', 'review', `starts a ${calleeName}`, n);
				}
				if (calleeObj === 'WebAssembly' && (calleeName === 'instantiate' || calleeName === 'compile' || calleeName === 'instantiateStreaming' || isNew)) {
					push('worker_spawn', 'review', 'loads WebAssembly, which cannot be read by a reviewer', n);
				}

				// Network sinks
				const isFetch =
					(calleeName === 'fetch' && (c.type === 'Identifier' || c.type === 'MemberExpression')) ||
					calleeName === 'sendBeacon' ||
					((calleeName === 'loadJSON' || calleeName === 'loadGLB' || calleeName === 'loadClip') && c.type === 'MemberExpression');
				const isSocket = isNew && c.type === 'Identifier' && /^(WebSocket|EventSource|XMLHttpRequest|RTCPeerConnection|WebTransport|Image|Audio)$/.test(c.name);
				if (isFetch || isSocket || (calleeName === 'open' && calleeObj && /xhr|request/i.test(calleeObj))) {
					networkCalls += 1;
					networkNodes.push(n);
					const arg = calleeName === 'open' ? n.arguments[1] : n.arguments[0];
					const v = arg ? hostFromPrefix(arg) : undefined;
					const isRelative = v !== undefined && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('//');
					const baseOk =
						arg &&
						arg.type === 'NewExpression' &&
						arg.callee.type === 'Identifier' &&
						arg.callee.name === 'URL' &&
						arg.arguments[1] &&
						/skillBaseURI/.test(src.slice(arg.arguments[1].start, arg.arguments[1].end));
					const skillRelative =
						arg &&
						/skillBaseURI/.test(src.slice(arg.start, arg.end)) &&
						(arg.type === 'NewExpression' || arg.type === 'MemberExpression' || arg.type === 'BinaryExpression' || arg.type === 'TemplateLiteral') &&
						!/(https?:)/.test(src.slice(arg.start, arg.end));
					if (isSocket && /^(Image|Audio)$/.test(c.name) && !n.arguments.length) {
						// a bare constructor; the .src assignment is the sink
						networkCalls -= 1;
						networkNodes.pop();
					} else if (v !== undefined && !isRelative) {
						noteHost(v, n, `calls`);
					} else if (v === undefined && !baseOk && !skillRelative) {
						networkUnverified += 1;
						if (once(`dyn:${n.loc.start.line}`)) push('dynamic_network_target', 'review', `${calleeName || c.name} is called with a URL the scanner cannot resolve`, n);
					}
				}
				break;
			}
			case 'Literal': {
				if (typeof n.value !== 'string') break;
				const v = n.value;
				literals.push(v);
				if (/^https?:\/\//i.test(v) || /^wss?:\/\//i.test(v)) noteHost(v, n, 'contains a URL for');
				const raw = n.raw || '';
				const escapes = (raw.match(/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/g) || []).length;
				if (escapes >= 12 && once(`esc:${n.loc.start.line}`)) push('escaped_strings', 'review', `a string is written as ${escapes} escape sequences`, n);
				if (v.length >= 40 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) && entropy(v) > 4.2 && once(`blob:${n.loc.start.line}`)) {
					let decoded = '';
					try {
						decoded = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
					} catch {
						decoded = '';
					}
					if (decoded && (SENSITIVE_RUNTIME.test(decoded) || /[A-Za-z0-9.-]+\.(com|net|io|xyz|ru|top|app|dev)\b/i.test(decoded))) {
						push('hidden_payload', 'block', 'an encoded string decodes to a host, a secret reference or code', n);
					} else {
						push('encoded_blob', 'review', `a ${v.length}-character encoded string the reviewer cannot read`, n);
					}
				} else if (v.length >= 64 && /^[0-9a-fA-F]+$/.test(v) && once(`hex:${n.loc.start.line}`)) {
					push('encoded_blob', 'review', `a ${v.length}-character hex string the reviewer cannot read`, n);
				} else if (v.length >= 120 && entropy(v) > 4.7 && once(`ent:${n.loc.start.line}`)) {
					push('encoded_blob', 'review', 'a long high-entropy string the reviewer cannot read', n);
				}
				break;
			}
			default:
				break;
		}

		// Runtime-assembled strings: anything folded from parts that hides a sensitive name.
		if (!isPlainLiteral(n) && (n.type === 'BinaryExpression' || n.type === 'CallExpression' || n.type === 'TemplateLiteral') && !(parent && parent.type === 'BinaryExpression' && parent.operator === '+')) {
			const folded = fold(n);
			if (folded && folded.length >= 3 && n.type !== 'TemplateLiteral' && SENSITIVE_RUNTIME.test(folded) && once(`fold:${n.loc.start.line}:${folded.slice(0, 20)}`)) {
				const host = hostOf(folded);
				push('obfuscated_string', 'block', `assembles "${folded.slice(0, 60)}" from parts at runtime to hide it`, n);
				if (host) noteHost(folded, n, 'builds a URL for');
			}
		}
	});

	// Dense obfuscation signals
	const mangled = out.filter((f) => f._count).length;
	for (const f of out) delete f._count;
	if (mangled > 1) {
		const keep = out.findIndex((f) => f.rule === 'obfuscated_identifiers');
		for (let i = out.length - 1; i >= 0; i--) if (out[i].rule === 'obfuscated_identifiers' && i !== keep) out.splice(i, 1);
		out[out.findIndex((f) => f.rule === 'obfuscated_identifiers')].message = `${mangled} machine-mangled identifiers (_0x...)`;
	}
	const avgLine = src.length / Math.max(1, lines.length);
	if (src.length > 2000 && avgLine > 400) {
		out.push(finding(file, 'minified', 'review', `handlers.js looks minified (${Math.round(avgLine)} characters per line on average)`, { line: 1, column: 0 }));
	}

	// Data flow: a secret read that shares a request with the network.
	if (secrets > 0 && networkCalls > 0) {
		const netRanges = networkNodes.map((nn) => [nn.start, nn.end]);
		const flows = secretNodes.filter((s) => netRanges.some(([a, b]) => s.start >= a && s.end <= b));
		if (flows.length) {
			for (const s of flows) {
				if (once(`flow:${s.loc.start.line}`)) push('secret_to_network', 'block', 'a secret value is placed inside a network request', s);
			}
		} else {
			const hasUnsafeTarget = networkUnverified > 0 || [...hostsSeen.keys()].some((h) => !hostMatches(h, declaredHosts));
			push(
				'secret_with_network',
				hasUnsafeTarget ? 'block' : 'review',
				hasUnsafeTarget ? 'reads secrets and calls hosts the manifest does not declare, the pattern of credential theft' : 'reads secrets and also makes network calls',
				secretNodes[0],
			);
		}
	}

	// Tool-name literals feed the permission check.
	const toolLiterals = [...new Set(literals.filter((l) => /^[a-z][a-z0-9_]{2,60}$/.test(l)))];
	return { findings: out, literals: toolLiterals, secrets, networkCalls };
}

// ── tools.json, SKILL.md, manifest ──────────────────────────────────────────

function normalizeTools(tools) {
	if (!tools) return [];
	const list = Array.isArray(tools) ? tools : Array.isArray(tools.tools) ? tools.tools : [];
	return list
		.map((t, i) => {
			if (!t || typeof t !== 'object') return null;
			const fn = t.function && typeof t.function === 'object' ? t.function : t;
			return { index: i, name: String(fn.name || ''), description: String(fn.description || ''), schema: fn.input_schema || fn.parameters || {} };
		})
		.filter(Boolean);
}

function schemaProps(schema, prefix = '', depth = 0, acc = []) {
	if (!schema || typeof schema !== 'object' || depth > 5) return acc;
	for (const [k, v] of Object.entries(schema.properties || {})) {
		acc.push({ path: prefix ? `${prefix}.${k}` : k, key: k, description: String(v?.description || '') });
		schemaProps(v, prefix ? `${prefix}.${k}` : k, depth + 1, acc);
	}
	if (schema.items) schemaProps(schema.items, prefix, depth + 1, acc);
	return acc;
}

const SECRET_PARAM = /^(private[_-]?key|secret[_-]?key|seed|seed[_-]?phrase|mnemonic|passphrase|password|keypair|api[_-]?key|access[_-]?token|auth[_-]?token|session[_-]?cookie|bearer|wallet[_-]?secret)$/i;
const SECRET_PARAM_DESC = /\b(private keys?|secret keys?|seed phrases?|mnemonic|recovery phrases?|passwords?)\b/i;

function scanTools(tools) {
	const out = [];
	const list = normalizeTools(tools);
	for (const t of list) {
		const at = `tools[${t.index}]`;
		for (const p of schemaProps(t.schema)) {
			if (SECRET_PARAM.test(p.key) || SECRET_PARAM_DESC.test(p.description)) {
				out.push(finding('tools.json', 'secret_param', 'block', `${t.name || at} asks for "${p.path}", which is credential material`, null, { path: `${at}.${p.path}` }));
			}
		}
		for (const f of proseFindings(`${t.description}`)) {
			if (f.severity === 'block') out.push(finding('tools.json', 'tool_text_injection', 'block', `the description of ${t.name || at} ${f.message}`, null, { path: `${at}.description`, snippet: f.excerpt }));
		}
		for (const p of schemaProps(t.schema)) {
			if (!p.description) continue;
			for (const f of proseFindings(p.description)) {
				if (f.severity === 'block')
					out.push(finding('tools.json', 'tool_text_injection', 'block', `the description of parameter ${p.path} of ${t.name || at} ${f.message}`, null, { path: `${at}.${p.path}`, snippet: f.excerpt }));
			}
		}
	}
	return out;
}

const WHO = String.raw`(?:for\s+)?(?:the\s+|their\s+|any\s+)?(?:(?:user|owner|human|operator)(?:'s)?\s*)?`;
const CONFIRM_WORD = String.raw`(?:confirm\w*|approv\w*|permission|consent|sign[- ]?off)`;
const AUTO_APPROVE = /\bauto[- ]?(?:approve|confirm|sign)\w*/i;
// "execute X without asking the owner", "skip confirmation"
const WITHOUT_ASKING = new RegExp(String.raw`\b(?:without|skip(?:ping)?|no need (?:to|for))\s+(?:(?:asking|requesting|waiting for|getting|requiring)\s+${WHO}${CONFIRM_WORD}?|${CONFIRM_WORD})`, 'i');
// "do not ask the user", "never wait for approval"
const DO_NOT_ASK = new RegExp(String.raw`\b(?:do not|don't|never)\s+(?:ask|wait for|request|require)\s+${WHO}(?:${CONFIRM_WORD}|(?:user|owner|human|operator)\b)`, 'i');

// A line that forbids the unsafe act ("never send funds without asking the owner to confirm").
const PROTECTIVE = /\b(never|do not|don't|must not|mustn't|always)\b[^.\n]{0,80}\b(without\s+(?:asking|telling|notifying|informing)|silently)\b|\bwithout\s+(?:asking|telling)\b[^.\n]{0,40}\bto\s+confirm/i;
// A bare "without confirmation" only matters on a line that moves value; "read-only queries may execute without confirmation" is a policy table row.
const ASKS_OWNER = /\b(asking|requesting|waiting for|getting|requiring)\b/i;
const MOVES_VALUE = /\b(send|sends|transfer\w*|pay|pays|payments?|swap\w*|trade|trades|sign|signs|withdraw\w*|buy|sell|spend\w*|purchase\w*|tip|tips)\b/i;
const BENIGN_GATE = /\b(read[- ]only|queries|balances?|lookups?)\b|\bmay\s+(?:be\s+)?(?:execute|run|call)/i;
const NEGATED_BEFORE = /\b(never|do not|don't|must not|mustn't|not|cannot|can't)\b[^.\n]{0,60}$/i;

function proseScan(text, file, { toolLike = false } = {}) {
	const out = [];
	const lines = String(text).split('\n');
	for (const f of proseFindings(text)) {
		if (f.rule === 'concealment' && PROTECTIVE.test(lines[f.line - 1] || '')) continue;
		const severity = f.severity === 'block' ? 'block' : f.severity === 'warn' ? 'review' : 'info';
		if (severity === 'info') continue;
		const rule = f.rule === 'hidden_directive' || f.rule === 'hidden_unicode' || f.rule === 'zero_width' ? 'hidden_text' : f.rule === 'gate_bypass' ? 'skip_confirmation' : f.rule === 'encoded_blob' ? 'encoded_blob' : 'prose';
		out.push(finding(file, rule, severity, `${toolLike ? 'tool text ' : 'instructions '}${f.message}`, { line: f.line, column: 0 }, { snippet: f.excerpt, detail: f.rule }));
	}
	lines.forEach((line, i) => {
		let hit = AUTO_APPROVE.test(line) || DO_NOT_ASK.test(line);
		if (!hit) {
			const m = line.match(WITHOUT_ASKING);
			hit = !!m && !NEGATED_BEFORE.test(line.slice(0, m.index)) && (ASKS_OWNER.test(m[0]) || (MOVES_VALUE.test(line) && !BENIGN_GATE.test(line)));
		}
		if (hit && !out.some((f) => f.rule === 'skip_confirmation' && f.line === i + 1)) {
			out.push(finding(file, 'skip_confirmation', 'block', 'tells the agent to act without asking the owner to confirm', { line: i + 1, column: 0 }, { snippet: line.trim().slice(0, 140) }));
		}
	});
	return out;
}

/** Highest-risk capabilities a handler can reach by calling platform tools. */
function permissionFindings({ manifest, literals, handlersSrc, skillMd, purposeText }) {
	const out = [];
	const requires = manifest?.requires || {};
	const declaredTools = new Set((requires.tools || []).map(String));
	const declaredCaps = new Set((requires.capabilities || []).map((c) => String(c).toLowerCase()));
	const used = new Map();
	for (const lit of literals) {
		const c = classifyTool(lit);
		if (!c.known || !c.capabilities.length) continue;
		used.set(lit, c);
	}
	const purposeWallet = /\b(wallet|trade|trading|swap|pay|payment|send|transfer|sign|launch|mint|bridge|stake|buy|sell|tip|deposit|withdraw)\b/i.test(purposeText);
	let reportedPurpose = false;
	for (const [name, c] of used) {
		const declared = declaredTools.has(name) || c.capabilities.some((cap) => declaredCaps.has(cap)) || declaredCaps.has('wallet');
		if (!declared) {
			out.push(
				finding('handlers.js', 'excess_permission', 'review', `calls ${name} (${c.capabilities.join(', ')}) but manifest.json declares neither the tool nor the capability`, locateLiteral(handlersSrc, name)),
			);
		} else if (!purposeWallet && !reportedPurpose) {
			reportedPurpose = true;
			out.push(
				finding(
					'manifest.json',
					'purpose_mismatch',
					'review',
					`declares ${c.capabilities.join('/')} access through ${name}, but the name, description and instructions never mention moving value or signing`,
					null,
				),
			);
		}
	}
	const sensitiveCount = [...used.values()].length;
	if (sensitiveCount > 6) out.push(finding('handlers.js', 'excess_permission', 'review', `reaches ${sensitiveCount} spend, signing or messaging tools; a focused skill rarely needs that many`, null));
	void skillMd;
	return out;
}

function locateLiteral(src, literal) {
	if (!src) return null;
	const idx = src.indexOf(literal);
	if (idx < 0) return null;
	const before = src.slice(0, idx);
	const line = before.split('\n').length;
	return { line, column: idx - before.lastIndexOf('\n') - 1 };
}

// ── Public API ──────────────────────────────────────────────────────────────

function toRecord(f) {
	const r = { rule: f.rule, severity: f.severity, file: f.file, line: f.line, column: f.column, message: f.message, fix: f.fix };
	if (f.snippet) r.snippet = f.snippet;
	if (f.path) r.path = f.path;
	return r;
}

/**
 * Scan a skill bundle. All parts are optional; absent parts are skipped.
 * @param {{manifest?:object, skillMd?:string, tools?:object|Array, handlersSrc?:string, name?:string, description?:string}} bundle
 */
export function scanSkillBundle({ manifest = null, skillMd = '', tools = null, handlersSrc = '', name = '', description = '' } = {}) {
	const findings = [];
	const requiresNetwork = Array.isArray(manifest?.requires?.network) ? manifest.requires.network.map(String) : [];
	const purposeText = [name, description, manifest?.name, manifest?.description, ...(manifest?.tags || []), skillMd].filter(Boolean).join('\n');

	let literals = [];
	if (handlersSrc && String(handlersSrc).trim()) {
		const h = scanHandlers(String(handlersSrc), { declaredHosts: requiresNetwork });
		findings.push(...h.findings);
		literals = h.literals;
		findings.push(...permissionFindings({ manifest, literals, handlersSrc: String(handlersSrc), skillMd, purposeText }));
	}
	if (skillMd && String(skillMd).trim()) findings.push(...proseScan(skillMd, 'SKILL.md'));
	if (tools) findings.push(...scanTools(tools));
	if (manifest && typeof manifest === 'object') {
		const meta = [manifest.name, manifest.description].filter(Boolean).join('\n');
		for (const f of proseScan(meta, 'manifest.json')) if (f.severity === 'block') findings.push(f);
	}

	const rank = { block: 0, review: 1, info: 2 };
	findings.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0));
	const records = findings.map(toRecord);
	const counts = { block: 0, review: 0, info: 0 };
	for (const f of records) counts[f.severity] += 1;
	const verdict = counts.block ? 'blocked' : counts.review ? 'review' : 'clean';
	return { scanner_version: SUPPLY_SCANNER_VERSION, verdict, counts, findings: records, scanned_at: new Date().toISOString() };
}

/**
 * Build the scanner input from a marketplace_skills row. The catalog stores
 * SKILL.md prose in `content` and the tool list in `schema_json`; rows
 * published with code also carry `manifest` and `handlers_src`.
 */
export function bundleFromRow(row) {
	return {
		name: row.name || '',
		description: row.description || '',
		manifest: row.manifest || null,
		skillMd: row.content || '',
		tools: row.schema_json || null,
		handlersSrc: row.handlers_src || '',
	};
}

export function scanSkillRow(row) {
	return scanSkillBundle(bundleFromRow(row));
}

/** Whether a verdict lets the skill go live without a moderator. */
export function isPublishable(verdict) {
	return verdict === 'clean';
}

/** Compact summary the API and UI show. */
export function summarize(report) {
	return { verdict: report.verdict, counts: report.counts, scanner_version: report.scanner_version, findings: report.findings };
}
