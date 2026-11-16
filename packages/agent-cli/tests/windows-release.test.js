// The pure pieces of the standalone Windows build (scripts/build-windows.mjs):
// checksum parsing, the version inlining guard, PE signature stripping, machine
// detection, reproducible zips and the self-relative read guard on the bundle.

import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import {
	HTTP_VERSION_READ,
	assertShasum,
	deterministicZip,
	hasAuthenticode,
	hostNodeArchive,
	inlinePackageVersion,
	nodeDistUrl,
	parseShasums,
	peMachine,
	sha256,
	stripAuthenticode,
	windowsNodeExePath,
	zipName,
	zipReadme,
} from '../scripts/lib/windows-release.mjs';
import { selfRelativeReads } from '../scripts/lib/sea-bundle.mjs';

/** A minimal PE32+ image: MZ stub, PE header, optional header with 16 data directories, optional cert table at the tail. */
function fakePe({ machine = 0x8664, cert = null, magic = 0x20b } = {}) {
	const pe = 0x80;
	const opt = pe + 24;
	const dirBase = magic === 0x20b ? opt + 112 : opt + 96;
	const bodyEnd = dirBase + 16 * 8 + 64;
	const buf = Buffer.alloc(bodyEnd + (cert ? cert.length : 0));
	buf.write('MZ', 0, 'latin1');
	buf.writeUInt32LE(pe, 0x3c);
	buf.write('PE\0\0', pe, 'latin1');
	buf.writeUInt16LE(machine, pe + 4);
	buf.writeUInt16LE(magic, opt);
	buf.writeUInt32LE(0xdeadbeef, opt + 64);
	buf.writeUInt32LE(16, dirBase - 4);
	if (cert) {
		cert.copy(buf, bodyEnd);
		buf.writeUInt32LE(bodyEnd, dirBase + 32);
		buf.writeUInt32LE(cert.length, dirBase + 36);
	}
	return { buf, bodyEnd, dirBase, opt };
}

describe('Node.js release downloads', () => {
	it('builds nodejs.org URLs and archive names', () => {
		expect(nodeDistUrl('26.13.1', 'win-x64/node.exe')).toBe('https://nodejs.org/dist/v26.13.1/win-x64/node.exe');
		expect(windowsNodeExePath('arm64')).toBe('win-arm64/node.exe');
		expect(hostNodeArchive('26.13.1', 'linux', 'x64')).toBe('node-v26.13.1-linux-x64.tar.xz');
		expect(hostNodeArchive('26.13.1', 'darwin', 'arm64')).toBe('node-v26.13.1-darwin-arm64.tar.gz');
		expect(hostNodeArchive('26.13.1', 'win32', 'x64')).toBe('node-v26.13.1-win-x64.zip');
		expect(() => hostNodeArchive('26.13.1', 'aix', 'ppc64')).toThrow(/no official Node.js build/);
	});

	it('parses SHASUMS256.txt and rejects bytes that do not match', () => {
		const good = Buffer.from('node.exe bytes');
		const text = `${sha256(good)}  win-x64/node.exe\r\n${'a'.repeat(64)} *node-v26.13.1-linux-x64.tar.xz\n\nnot a line\n`;
		const sums = parseShasums(text);
		expect(sums.size).toBe(2);
		expect(sums.get('node-v26.13.1-linux-x64.tar.xz')).toBe('a'.repeat(64));
		expect(assertShasum(sums, 'win-x64/node.exe', good)).toBe(sha256(good));
		expect(() => assertShasum(sums, 'win-x64/node.exe', Buffer.from('tampered'))).toThrow(/does not match/);
		expect(() => assertShasum(sums, 'win-arm64/node.exe', good)).toThrow(/no entry/);
	});
});

describe('inlinePackageVersion', () => {
	it('replaces the single package.json read with a literal', () => {
		const src = `import { readFileSync } from 'node:fs';\nconst pkg = ${HTTP_VERSION_READ};\nexport const UA = pkg.version;\n`;
		const out = inlinePackageVersion(src, '0.2.0');
		expect(out).toContain('const pkg = {"version":"0.2.0"};');
		expect(out).not.toContain('import.meta.url');
	});

	it('fails loudly when src/http.js changes shape', () => {
		expect(() => inlinePackageVersion('const pkg = {};', '0.2.0')).toThrow(/found 0/);
		expect(() => inlinePackageVersion(`${HTTP_VERSION_READ};${HTTP_VERSION_READ}`, '0.2.0')).toThrow(/found 2/);
	});
});

describe('PE helpers', () => {
	it('reads the machine type', () => {
		expect(peMachine(fakePe({ machine: 0x8664 }).buf)).toBe('x64');
		expect(peMachine(fakePe({ machine: 0xaa64 }).buf)).toBe('arm64');
		expect(peMachine(fakePe({ machine: 0x1c4 }).buf)).toBe('0x1c4');
	});

	it('strips a tail certificate table and clears the security directory and checksum', () => {
		const { buf, bodyEnd, dirBase, opt } = fakePe({ cert: Buffer.alloc(256, 7) });
		expect(hasAuthenticode(buf)).toBe(true);
		const { bytes, stripped } = stripAuthenticode(buf);
		expect(stripped).toBe(true);
		expect(bytes.length).toBe(bodyEnd);
		expect(bytes.readUInt32LE(dirBase + 32)).toBe(0);
		expect(bytes.readUInt32LE(dirBase + 36)).toBe(0);
		expect(bytes.readUInt32LE(opt + 64)).toBe(0);
		expect(hasAuthenticode(bytes)).toBe(false);
		expect(hasAuthenticode(buf)).toBe(true);
	});

	it('leaves an unsigned image untouched', () => {
		const { buf } = fakePe();
		expect(hasAuthenticode(buf)).toBe(false);
		const res = stripAuthenticode(buf);
		expect(res.stripped).toBe(false);
		expect(res.bytes).toBe(buf);
	});

	it('handles PE32 images and rejects non-PE input', () => {
		const { buf, bodyEnd } = fakePe({ magic: 0x10b, machine: 0x14c, cert: Buffer.alloc(64, 1) });
		expect(peMachine(buf)).toBe('x86');
		expect(stripAuthenticode(buf).bytes.length).toBe(bodyEnd);
		expect(() => stripAuthenticode(Buffer.alloc(128))).toThrow(/no MZ header/);
		const broken = fakePe({ cert: Buffer.alloc(16) }).buf;
		broken.writeUInt32LE(broken.length * 2, fakePe().dirBase + 36);
		expect(() => stripAuthenticode(broken)).toThrow(/past the end/);
	});
});

describe('release archives', () => {
	it('names zips by version and arch', () => {
		expect(zipName('0.2.0', 'arm64')).toBe('three-ws-agent-0.2.0-win-arm64.zip');
	});

	it('produces byte-identical zips for identical inputs and keeps the entries intact', () => {
		const mtime = new Date('2026-11-16T00:00:00Z');
		const entries = () => [
			['three-ws-agent.exe', Buffer.alloc(4096, 0x41)],
			['LICENSE', Buffer.from('Apache License')],
			['README.txt', Buffer.from(zipReadme({ version: '0.2.0', arch: 'x64', nodeVersion: '26.13.1' }))],
		];
		const a = deterministicZip(entries(), mtime);
		const b = deterministicZip(entries(), mtime);
		expect(sha256(a)).toBe(sha256(b));
		expect(sha256(deterministicZip(entries(), new Date('2026-11-17T00:00:00Z')))).not.toBe(sha256(a));
		const files = unzipSync(a);
		expect(Object.keys(files)).toEqual(['three-ws-agent.exe', 'LICENSE', 'README.txt']);
		expect(Buffer.from(files['three-ws-agent.exe']).equals(Buffer.alloc(4096, 0x41))).toBe(true);
	});

	it('ships a CRLF README that names the winget package and the version', () => {
		const readme = zipReadme({ version: '0.2.0', arch: 'arm64', nodeVersion: '26.13.1' });
		expect(readme.startsWith('three-ws-agent 0.2.0 for Windows (arm64)\r\n')).toBe(true);
		expect(readme).toContain('winget install ThreeWs.Agent');
		expect(readme).toContain('Node.js 26.13.1');
		expect(readme.replace(/\r\n/g, '')).not.toContain('\n');
	});
});

describe('selfRelativeReads', () => {
	it('flags reads next to a module and allows the documented ink exception', () => {
		const bundle = [
			'// node_modules/ink/build/reconciler.js',
			'const p = new URL("../package.json", import.meta.url);',
			'// src/assets.js',
			'const w = readFileSync(new URL("./data.bin", import.meta.url));',
		].join('\n');
		expect(selfRelativeReads(bundle)).toEqual(['src/assets.js: new URL("./data.bin", import.meta.url)']);
	});

	it('does not let the ink exception cover another file in the same module', () => {
		const bundle = ['// node_modules/ink/build/reconciler.js', 'new URL("./yoga.wasm", import.meta.url)'].join('\n');
		expect(selfRelativeReads(bundle)).toHaveLength(1);
	});
});
