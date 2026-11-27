// Structural check of a USDZ package against the rules Apple Quick Look and
// the USD runtime enforce (USDZ spec, openusd.org/release/spec_usdz.html):
//   - it is a zip archive
//   - every entry is stored uncompressed (method 0), because USD memory-maps
//     the files straight out of the archive
//   - every entry's data starts on a 64-byte boundary
//   - the first entry is the root layer (.usda, .usdc or .usd)
//   - no entry is encrypted
//
// Pure (Uint8Array in, report out) so the browser, tests
// (tests/forge-ar-links.test.js) and scripts/validate-usdz.mjs share it.

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;

/**
 * @param {Uint8Array} bytes
 * @returns {{ ok: boolean, errors: string[], entries: Array<{ name: string, method: number, size: number, dataOffset: number }> }}
 */
export function validateUsdz(bytes) {
	const errors = [];
	const entries = [];
	if (!(bytes instanceof Uint8Array) || bytes.length < 30) {
		return { ok: false, errors: ['Not a USDZ package: too short to be a zip archive.'], entries };
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== LOCAL_HEADER) {
		return { ok: false, errors: ['Not a USDZ package: missing the zip local file header.'], entries };
	}
	const decoder = new TextDecoder();
	let p = 0;
	while (p + 30 <= bytes.length && view.getUint32(p, true) === LOCAL_HEADER) {
		const flags = view.getUint16(p + 6, true);
		const method = view.getUint16(p + 8, true);
		const compSize = view.getUint32(p + 18, true);
		const size = view.getUint32(p + 22, true);
		const nameLen = view.getUint16(p + 26, true);
		const extraLen = view.getUint16(p + 28, true);
		const name = decoder.decode(bytes.subarray(p + 30, p + 30 + nameLen));
		const dataOffset = p + 30 + nameLen + extraLen;
		entries.push({ name, method, size, dataOffset });
		if (flags & 0x1) errors.push(`${name} is encrypted; USDZ entries must be plain.`);
		if (flags & 0x8) errors.push(`${name} uses a trailing data descriptor; sizes must be in the local header.`);
		if (method !== 0) errors.push(`${name} is compressed (zip method ${method}); USDZ entries must be stored uncompressed.`);
		if (dataOffset % 64 !== 0) errors.push(`${name} data starts at byte ${dataOffset}, not on a 64-byte boundary.`);
		if (dataOffset + compSize > bytes.length) {
			errors.push(`${name} runs past the end of the file; the package is truncated.`);
			break;
		}
		p = dataOffset + compSize;
	}
	if (!entries.length) errors.push('The zip archive has no entries.');
	else if (!/\.usd[ac]?$/i.test(entries[0].name)) {
		errors.push(`The first entry is ${entries[0].name}; it must be the root .usda, .usdc or .usd layer.`);
	}
	if (p + 4 <= bytes.length && view.getUint32(p, true) !== CENTRAL_HEADER && entries.length) {
		errors.push('Unexpected bytes after the last entry; the central directory is missing.');
	}
	return { ok: errors.length === 0, errors, entries };
}
