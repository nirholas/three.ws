// Just enough H.264 Annex B parsing to feed WebCodecs: find the NAL units in
// an access unit, tell a keyframe from a delta frame, and read the codec
// string (avc1.PPCCLL) out of the sequence parameter set. The dongle sends
// raw Annex B with in-band SPS/PPS, which VideoDecoder accepts as-is when it
// is configured without a `description`.

const NAL_IDR = 5;
const NAL_SPS = 7;

/**
 * @param {Uint8Array} bytes
 * @returns {{type: number, data: Uint8Array}[]}
 */
export function nalUnits(bytes) {
	const starts = [];
	for (let i = 0; i + 2 < bytes.length; i += 1) {
		if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
			starts.push(i + 3);
			i += 2;
		}
	}
	return starts.map((start, n) => {
		let end = n + 1 < starts.length ? starts[n + 1] - 3 : bytes.length;
		// A four-byte start code leaves one extra zero on the previous unit.
		while (end > start && bytes[end - 1] === 0 && n + 1 < starts.length) end -= 1;
		return { type: bytes[start] & 0x1f, data: bytes.subarray(start, end) };
	});
}

const hex = (n) => n.toString(16).padStart(2, '0');

/** `avc1.` + profile_idc, constraint flags, level_idc from an SPS NAL unit. */
export function codecFromSps(sps) {
	if (!sps || sps.length < 4) return null;
	return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

/**
 * @param {Uint8Array} bytes one access unit
 * @returns {{key: boolean, codec: string|null}}
 */
export function inspectAccessUnit(bytes) {
	let key = false;
	let codec = null;
	for (const unit of nalUnits(bytes)) {
		if (unit.type === NAL_IDR) key = true;
		if (unit.type === NAL_SPS) {
			key = true;
			codec = codecFromSps(unit.data);
		}
	}
	return { key, codec };
}
