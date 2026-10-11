// Client-side GLB header validation.
//
// Reads only the 12-byte file header so this is fast on large files —
// no need to buffer the full blob before rejecting a misnamed JPEG.
// Mirrors the server-side isValidGlbHeader() in api/_lib/glb-inspect.js.

/**
 * Returns true iff the file has a valid binary glTF 2.0 header.
 * Checks: magic bytes ('glTF'), version (must be 2), and that the declared
 * file length (uint32 at offset 8) is at least the 20-byte minimum GLB size
 * and no larger than the file itself, so a truncated upload is rejected here.
 *
 * @param {File} file
 * @returns {Promise<boolean>}
 */
export async function isValidGlbMagic(file) {
	if (!file || file.size < 12) return false;
	const buf = await file.slice(0, 12).arrayBuffer();
	const bytes = new Uint8Array(buf);
	// Magic: 'glTF' = 0x67 0x6C 0x54 0x46
	if (bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) return false;
	// Version: must be 2 (little-endian uint32 at offset 4)
	const version = new DataView(buf).getUint32(4, true);
	if (version !== 2) return false;
	// Declared length: same bounds as the server (api/_lib/glb-inspect.js).
	const declaredLen = new DataView(buf).getUint32(8, true);
	if (declaredLen < 20 || declaredLen > file.size) return false;
	return true;
}
