/**
 * Reads a built .sppkg (an Open Packaging Conventions zip) without any
 * dependency: the central directory, then each stored or deflated entry.
 * Shared by validate-package.mjs and harness.mjs so both look at the exact
 * bytes an App Catalog receives.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Strips the // comments SPFx config files carry so JSON.parse accepts them. */
export function readJsonc(path) {
	const text = readFileSync(path, 'utf8');
	let out = '';
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			out += c;
			if (c === '\\') out += text[++i];
			else if (c === '"') inString = false;
		} else if (c === '"') {
			inString = true;
			out += c;
		} else if (c === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
		} else {
			out += c;
		}
	}
	return JSON.parse(out);
}

/** Entry name (no leading slash) to its uncompressed bytes. */
export function readZip(buffer) {
	let eocd = -1;
	for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
	const count = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	const files = new Map();
	for (let n = 0; n < count; n++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt central directory');
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
		const localName = buffer.readUInt16LE(localOffset + 26);
		const localExtra = buffer.readUInt16LE(localOffset + 28);
		const start = localOffset + 30 + localName + localExtra;
		const raw = buffer.subarray(start, start + compressedSize);
		if (method !== 0 && method !== 8) throw new Error(`unsupported compression method ${method} for ${name}`);
		files.set(name.replace(/^\//, ''), method === 0 ? raw : inflateRawSync(raw));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return files;
}

/** The configured package path under sharepoint/, as package-solution.json names it. */
export function defaultPackagePath() {
	const solutionConfig = readJsonc(join(PACKAGE_ROOT, 'config/package-solution.json'));
	return join(PACKAGE_ROOT, 'sharepoint', solutionConfig.paths.zippedPackage);
}
