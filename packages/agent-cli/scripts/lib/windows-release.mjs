// Shared, side-effect-free pieces of the standalone Windows build of
// three-ws-agent (scripts/build-windows.mjs) and its winget manifests
// (distributions/winget/scripts/generate-manifests.mjs). Everything here is a
// pure function over bytes or strings so it is unit tested without a network.

import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

/**
 * The Node.js release every standalone three-ws-agent.exe embeds. An Active
 * LTS line, at or above the CLI's own engines floor (22.13, for node:sqlite),
 * and new enough for `node --build-sea` with an ES module main.
 * Bump it deliberately: the SEA blob must be built by exactly this version.
 */
export const NODE_VERSION = '26.13.1';

/** Windows architectures shipped, as Node names them and as winget names them. */
export const ARCHES = [
	{ node: 'x64', winget: 'x64' },
	{ node: 'arm64', winget: 'arm64' },
];

export const NODE_DIST = 'https://nodejs.org/dist';

export const EXE_NAME = 'three-ws-agent.exe';
export const COMMAND_ALIAS = 'three-ws-agent';

export function nodeDistUrl(version, file) {
	return `${NODE_DIST}/v${version}/${file}`;
}

/** Path of the official Windows node.exe inside a Node release directory. */
export function windowsNodeExePath(arch) {
	return `win-${arch}/node.exe`;
}

/** Tarball for the build host, used to produce a blob of the pinned version. */
export function hostNodeArchive(version, platform = process.platform, arch = process.arch) {
	if (platform === 'linux') return `node-v${version}-linux-${arch}.tar.xz`;
	if (platform === 'darwin') return `node-v${version}-darwin-${arch}.tar.gz`;
	if (platform === 'win32') return `node-v${version}-win-${arch}.zip`;
	throw new Error(`no official Node.js build for ${platform}-${arch}`);
}

/** Parse a SHASUMS256.txt body into Map<relative path, lowercase hex>. */
export function parseShasums(text) {
	const out = new Map();
	for (const line of String(text).split(/\r?\n/)) {
		const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/i.exec(line.trim());
		if (m) out.set(m[2].trim(), m[1].toLowerCase());
	}
	return out;
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Throw unless `bytes` hashes to what SHASUMS256.txt lists for `file`. */
export function assertShasum(sums, file, bytes) {
	const want = sums.get(file);
	if (!want) throw new Error(`SHASUMS256.txt has no entry for ${file}`);
	const got = sha256(bytes);
	if (got !== want) throw new Error(`${file}: sha256 ${got} does not match SHASUMS256.txt (${want})`);
	return got;
}

/**
 * src/http.js reads ../package.json next to itself through import.meta.url. In
 * a single executable there is no such file (import.meta.url is the exe), so
 * the bundle carries the version as a literal instead. Exact-match on purpose:
 * if http.js changes shape the build fails loudly rather than shipping a CLI
 * that crashes on start.
 */
export const HTTP_VERSION_READ = "JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))";

export function inlinePackageVersion(source, version) {
	const count = source.split(HTTP_VERSION_READ).length - 1;
	if (count !== 1) {
		throw new Error(`expected exactly one package.json read in src/http.js, found ${count}; update HTTP_VERSION_READ`);
	}
	return source.replace(HTTP_VERSION_READ, JSON.stringify({ version }));
}

/**
 * Remove an Authenticode signature from a PE file. Injecting the SEA blob into
 * the official node.exe invalidates the OpenJS Foundation signature; leaving
 * the broken signature in place reads as tampering to Windows and to malware
 * scanners, whereas an unsigned binary is merely unsigned. Clears the
 * IMAGE_DIRECTORY_ENTRY_SECURITY data directory and drops the certificate
 * table, which the PE format places at the end of the file.
 *
 * @param {Buffer} buf
 * @returns {{ bytes: Buffer, stripped: boolean }}
 */
export function stripAuthenticode(buf) {
	if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a PE file (no MZ header)');
	const pe = buf.readUInt32LE(0x3c);
	if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file (no PE signature)');
	const opt = pe + 24;
	const magic = buf.readUInt16LE(opt);
	const dirBase = magic === 0x20b ? opt + 112 : magic === 0x10b ? opt + 96 : -1;
	if (dirBase < 0) throw new Error(`unknown PE optional header magic 0x${magic.toString(16)}`);
	const numDirs = buf.readUInt32LE(dirBase - 4);
	if (numDirs <= 4) return { bytes: buf, stripped: false };
	const secEntry = dirBase + 4 * 8;
	const certOffset = buf.readUInt32LE(secEntry);
	const certSize = buf.readUInt32LE(secEntry + 4);
	if (certOffset === 0 || certSize === 0) return { bytes: buf, stripped: false };
	if (certOffset + certSize > buf.length) throw new Error('certificate table points past the end of the file');
	const out = Buffer.from(buf);
	out.writeUInt32LE(0, secEntry);
	out.writeUInt32LE(0, secEntry + 4);
	// The checksum is only enforced for drivers, but keep it honest: zero means "not set".
	out.writeUInt32LE(0, opt + 64);
	const tailIsCert = certOffset + certSize >= buf.length - 8;
	return { bytes: tailIsCert ? out.subarray(0, certOffset) : out, stripped: true };
}

/** True when the PE file carries a certificate table. */
export function hasAuthenticode(buf) {
	const pe = buf.readUInt32LE(0x3c);
	const opt = pe + 24;
	const dirBase = buf.readUInt16LE(opt) === 0x20b ? opt + 112 : opt + 96;
	if (buf.readUInt32LE(dirBase - 4) <= 4) return false;
	return buf.readUInt32LE(dirBase + 32) !== 0 && buf.readUInt32LE(dirBase + 36) !== 0;
}

/** PE machine type: 'x64', 'arm64', 'x86' or the raw hex. */
export function peMachine(buf) {
	const pe = buf.readUInt32LE(0x3c);
	const m = buf.readUInt16LE(pe + 4);
	return { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'x86' }[m] || `0x${m.toString(16)}`;
}

export function zipName(version, arch) {
	return `three-ws-agent-${version}-win-${arch}.zip`;
}

/**
 * A byte-for-byte reproducible zip: entries in the given order, every
 * timestamp pinned to `mtime`, so rebuilding the same inputs gives the same
 * SHA256 and a published hash can be re-derived by anyone.
 *
 * @param {Array<[string, Uint8Array]>} entries
 * @param {Date} mtime
 */
export function deterministicZip(entries, mtime) {
	const tree = {};
	for (const [name, bytes] of entries) tree[name] = [bytes, { mtime, level: name.endsWith('.exe') ? 9 : 6 }];
	return Buffer.from(zipSync(tree));
}

/** The plain-text README shipped inside each zip. */
export function zipReadme({ version, arch, nodeVersion }) {
	return [
		`three-ws-agent ${version} for Windows (${arch})`,
		'',
		'Run a three.ws agent from your terminal: a terminal UI with slash commands,',
		'streaming tool output, local file and shell tools, the three.ws MCP tools',
		'and agent wallet, saved sessions with full-text search, parallel subagents,',
		'natural-language cron and a Telegram gateway.',
		'',
		`This is a self-contained executable with Node.js ${nodeVersion} built in.`,
		'Nothing else needs to be installed.',
		'',
		'Install with winget (puts three-ws-agent on PATH):',
		'  winget install ThreeWs.Agent',
		'',
		'Or run it from this folder:',
		'  .\\three-ws-agent.exe --version',
		'  .\\three-ws-agent.exe doctor',
		'  .\\three-ws-agent.exe login',
		'  .\\three-ws-agent.exe',
		'',
		'The executable is not code-signed yet, so Windows SmartScreen may ask for',
		'confirmation the first time it runs from a downloaded zip.',
		'',
		'Docs:    https://three.ws/docs/agent-cli',
		'Source:  https://github.com/nirholas/three.ws/tree/main/packages/agent-cli',
		'Issues:  https://github.com/nirholas/three.ws/issues',
		'License: Apache-2.0 (see LICENSE)',
		'',
	].join('\r\n');
}
