/**
 * Read the axis system and unit scale a binary FBX declares in its
 * GlobalSettings block, without a full FBX parse.
 *
 * Unity and Unreal both read these values on import and convert the file into
 * their own conventions, so they are the facts a Game-Ready package has to
 * report truthfully. Only the binary FBX layout (the one Blender and the remesh
 * worker write) is understood; anything else returns null.
 *
 * Axis values follow the FBX SDK: an axis index (0 = X, 1 = Y, 2 = Z) plus a
 * sign (+1 / -1). UnitScaleFactor is centimetres per file unit (1 = cm,
 * 100 = m).
 */

const MAGIC = 'Kaydara FBX Binary  \0';
const AXIS_NAMES = ['X', 'Y', 'Z'];

function readProps(buf, offset, count) {
	const props = [];
	let o = offset;
	for (let i = 0; i < count; i++) {
		const type = String.fromCharCode(buf[o]);
		o += 1;
		switch (type) {
			case 'Y': props.push(buf.readInt16LE(o)); o += 2; break;
			case 'C': props.push(buf[o] !== 0); o += 1; break;
			case 'I': props.push(buf.readInt32LE(o)); o += 4; break;
			case 'F': props.push(buf.readFloatLE(o)); o += 4; break;
			case 'D': props.push(buf.readDoubleLE(o)); o += 8; break;
			case 'L': props.push(Number(buf.readBigInt64LE(o))); o += 8; break;
			case 'S':
			case 'R': {
				const len = buf.readUInt32LE(o);
				o += 4;
				props.push(type === 'S' ? buf.toString('utf8', o, o + len) : null);
				o += len;
				break;
			}
			case 'f': case 'd': case 'l': case 'i': case 'b': {
				// Arrays never carry the settings read here, so they are skipped.
				const compLen = buf.readUInt32LE(o + 8);
				o += 12 + compLen;
				props.push(null);
				break;
			}
			default:
				throw new Error(`unknown FBX property type ${type}`);
		}
	}
	return props;
}

function walk(buf, start, end, wide, visit, path) {
	let o = start;
	const headerLen = wide ? 25 : 13;
	while (o + headerLen <= end) {
		const endOffset = wide ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o);
		const numProps = wide ? Number(buf.readBigUInt64LE(o + 8)) : buf.readUInt32LE(o + 4);
		const propLen = wide ? Number(buf.readBigUInt64LE(o + 16)) : buf.readUInt32LE(o + 8);
		const nameLen = buf[o + (wide ? 24 : 12)];
		if (endOffset === 0) return; // null record terminates a node list
		if (endOffset > end || endOffset <= o) throw new Error('corrupt FBX record');
		const nameStart = o + headerLen;
		const name = buf.toString('latin1', nameStart, nameStart + nameLen);
		const propStart = nameStart + nameLen;
		const nextPath = [...path, name];
		visit(nextPath, () => readProps(buf, propStart, numProps));
		const childStart = propStart + propLen;
		if (childStart < endOffset) walk(buf, childStart, endOffset, wide, visit, nextPath);
		o = endOffset;
	}
}

/**
 * @param {Buffer|Uint8Array} input binary FBX bytes
 * @returns {{ version:number, upAxis:string, frontAxis:string, coordAxis:string,
 *   unitScaleFactor:number, metresPerUnit:number, raw:object } | null}
 */
export function readFbxGlobalSettings(input) {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (buf.length < 27 || buf.toString('latin1', 0, MAGIC.length) !== MAGIC) return null;
	const version = buf.readUInt32LE(23);
	const raw = {};
	try {
		walk(buf, 27, buf.length, version >= 7500, (path, props) => {
			if (path.length === 3 && path[0] === 'GlobalSettings' && path[1] === 'Properties70' && path[2] === 'P') {
				const p = props();
				if (typeof p[0] === 'string') raw[p[0]] = p[p.length - 1];
			}
		}, []);
	} catch {
		return null;
	}
	if (raw.UpAxis === undefined) return null;
	const axis = (idx, sign) => `${Number(sign) < 0 ? '-' : '+'}${AXIS_NAMES[Number(idx)] ?? '?'}`;
	const unitScaleFactor = Number(raw.UnitScaleFactor ?? 1);
	return {
		version,
		upAxis: axis(raw.UpAxis, raw.UpAxisSign ?? 1),
		frontAxis: axis(raw.FrontAxis, raw.FrontAxisSign ?? 1),
		coordAxis: axis(raw.CoordAxis, raw.CoordAxisSign ?? 1),
		unitScaleFactor,
		metresPerUnit: unitScaleFactor / 100,
		raw,
	};
}
