'use strict';

const { extensionOf } = require('./detect');

/**
 * Read pixel size and duration straight from a file's own header, so 360 detection
 * works for any clip the user picks, not only ones Premiere has imported.
 * `readRange(start, end)` resolves to an ArrayBuffer. Never throws: an unreadable
 * or unfamiliar file returns {}.
 */

const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_BOXES = 4096;

function view(buf) {
	return new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
}

function fourcc(dv, off) {
	return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
}

/** Iterate child boxes of an in-memory box payload. */
function* boxes(dv, start, end) {
	let off = start;
	let guard = 0;
	while (off + 8 <= end && guard++ < MAX_BOXES) {
		let size = dv.getUint32(off);
		const type = fourcc(dv, off + 4);
		let header = 8;
		if (size === 1) {
			if (off + 16 > end) return;
			size = Number(dv.getBigUint64(off + 8));
			header = 16;
		} else if (size === 0) {
			size = end - off;
		}
		if (size < header || off + size > end) return;
		yield { type, start: off + header, end: off + size };
		off += size;
	}
}

function parseMoov(dv, start, end) {
	let width = 0;
	let height = 0;
	let duration = 0;
	for (const box of boxes(dv, start, end)) {
		if (box.type === 'mvhd') {
			const version = dv.getUint8(box.start);
			const timescaleOff = box.start + (version === 1 ? 20 : 12);
			const timescale = dv.getUint32(timescaleOff);
			const dur = version === 1 ? Number(dv.getBigUint64(timescaleOff + 4)) : dv.getUint32(timescaleOff + 4);
			if (timescale > 0) duration = dur / timescale;
		} else if (box.type === 'trak') {
			for (const child of boxes(dv, box.start, box.end)) {
				if (child.type !== 'tkhd') continue;
				const version = dv.getUint8(child.start);
				const sizeOff = child.start + (version === 1 ? 88 : 76);
				if (sizeOff + 8 > child.end) continue;
				const w = dv.getUint32(sizeOff) / 65536;
				const h = dv.getUint32(sizeOff + 4) / 65536;
				if (w > width && h > 0) {
					width = w;
					height = h;
				}
			}
		}
	}
	return { width: Math.round(width), height: Math.round(height), durationSeconds: duration };
}

async function probeMp4(size, readRange) {
	let offset = 0;
	for (let i = 0; i < MAX_BOXES && offset + 8 <= size; i++) {
		const head = view(await readRange(offset, Math.min(size, offset + 16)));
		if (head.byteLength < 8) return {};
		let boxSize = head.getUint32(0);
		const type = fourcc(head, 4);
		let header = 8;
		if (boxSize === 1) {
			if (head.byteLength < 16) return {};
			boxSize = Number(head.getBigUint64(8));
			header = 16;
		} else if (boxSize === 0) {
			boxSize = size - offset;
		}
		if (boxSize < header) return {};
		if (type === 'moov') {
			if (boxSize > MAX_MOOV_BYTES) return {};
			const moov = view(await readRange(offset + header, offset + boxSize));
			return parseMoov(moov, 0, moov.byteLength);
		}
		offset += boxSize;
	}
	return {};
}

function parsePng(dv) {
	if (dv.byteLength < 24 || dv.getUint32(0) !== 0x89504e47) return {};
	return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function parseJpeg(dv) {
	if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return {};
	let off = 2;
	while (off + 9 < dv.byteLength) {
		if (dv.getUint8(off) !== 0xff) {
			off++;
			continue;
		}
		const marker = dv.getUint8(off + 1);
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			off += 2;
			continue;
		}
		const len = dv.getUint16(off + 2);
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
		off += 2 + len;
	}
	return {};
}

async function probeDimensions(name, size, readRange) {
	try {
		const ext = extensionOf(name);
		if (ext === '.mp4' || ext === '.m4v' || ext === '.mov') return await probeMp4(size, readRange);
		if (ext === '.png') return parsePng(view(await readRange(0, Math.min(size, 32))));
		if (ext === '.jpg' || ext === '.jpeg') return parseJpeg(view(await readRange(0, Math.min(size, 256 * 1024))));
	} catch {
		return {};
	}
	return {};
}

module.exports = { probeDimensions };
