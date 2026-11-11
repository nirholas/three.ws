// Little-endian NBT writer (Minecraft: Bedrock Edition's on-disk flavour).
//
// Bedrock stores .mcstructure files as uncompressed NBT with every multi-byte
// number little-endian, unlike Java Edition's big-endian, gzipped NBT. Strings
// are an unsigned 16-bit little-endian byte length followed by UTF-8.
//
// Values are built with the tag constructors below so every number carries its
// exact NBT type; a bare JS number is ambiguous (byte? int? double?) and a
// wrong width corrupts every tag after it. The writer grows a single buffer
// geometrically, so a 64x128x64 structure (a ~2 MB int list) is written in
// one pass without per-tag allocations.

export const TAG = Object.freeze({
	End: 0,
	Byte: 1,
	Short: 2,
	Int: 3,
	Long: 4,
	Float: 5,
	Double: 6,
	ByteArray: 7,
	String: 8,
	List: 9,
	Compound: 10,
	IntArray: 11,
	LongArray: 12,
});

export class NbtError extends Error {
	constructor(message) {
		super(message);
		this.name = 'NbtError';
	}
}

export const nbt = {
	byte: (value) => ({ type: TAG.Byte, value }),
	short: (value) => ({ type: TAG.Short, value }),
	int: (value) => ({ type: TAG.Int, value }),
	long: (value) => ({ type: TAG.Long, value: BigInt(value) }),
	float: (value) => ({ type: TAG.Float, value }),
	double: (value) => ({ type: TAG.Double, value }),
	string: (value) => ({ type: TAG.String, value: String(value) }),
	/** A list of one element type. `items` are raw values for scalar types, or tags for List/Compound. */
	list: (elementType, items) => ({ type: TAG.List, elementType, value: items }),
	/** `fields` maps names to tags. Insertion order is preserved in the output. */
	compound: (fields) => ({ type: TAG.Compound, value: fields }),
	intArray: (value) => ({ type: TAG.IntArray, value }),
	byteArray: (value) => ({ type: TAG.ByteArray, value }),
};

class Writer {
	constructor(initial = 1 << 16) {
		this.buf = new Uint8Array(initial);
		this.view = new DataView(this.buf.buffer);
		this.pos = 0;
	}

	ensure(n) {
		if (this.pos + n <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.pos + n) size *= 2;
		const next = new Uint8Array(size);
		next.set(this.buf.subarray(0, this.pos));
		this.buf = next;
		this.view = new DataView(next.buffer);
	}

	u8(v) {
		this.ensure(1);
		this.view.setInt8(this.pos, v);
		this.pos += 1;
	}

	i16(v) {
		this.ensure(2);
		this.view.setInt16(this.pos, v, true);
		this.pos += 2;
	}

	u16(v) {
		this.ensure(2);
		this.view.setUint16(this.pos, v, true);
		this.pos += 2;
	}

	i32(v) {
		this.ensure(4);
		this.view.setInt32(this.pos, v, true);
		this.pos += 4;
	}

	i64(v) {
		this.ensure(8);
		this.view.setBigInt64(this.pos, BigInt(v), true);
		this.pos += 8;
	}

	f32(v) {
		this.ensure(4);
		this.view.setFloat32(this.pos, v, true);
		this.pos += 4;
	}

	f64(v) {
		this.ensure(8);
		this.view.setFloat64(this.pos, v, true);
		this.pos += 8;
	}

	str(s) {
		const bytes = new TextEncoder().encode(s);
		if (bytes.length > 0xffff) throw new NbtError(`string longer than 65535 bytes: ${s.slice(0, 40)}...`);
		this.u16(bytes.length);
		this.ensure(bytes.length);
		this.buf.set(bytes, this.pos);
		this.pos += bytes.length;
	}

	payload(type, value, elementType) {
		switch (type) {
			case TAG.Byte:
				return this.u8(value);
			case TAG.Short:
				return this.i16(value);
			case TAG.Int:
				return this.i32(value);
			case TAG.Long:
				return this.i64(value);
			case TAG.Float:
				return this.f32(value);
			case TAG.Double:
				return this.f64(value);
			case TAG.String:
				return this.str(value);
			case TAG.ByteArray:
				this.i32(value.length);
				for (let i = 0; i < value.length; i += 1) this.u8(value[i]);
				return undefined;
			case TAG.IntArray:
				this.i32(value.length);
				this.ensure(value.length * 4);
				for (let i = 0; i < value.length; i += 1) {
					this.view.setInt32(this.pos, value[i], true);
					this.pos += 4;
				}
				return undefined;
			case TAG.List:
				return this.list(elementType, value);
			case TAG.Compound:
				return this.compound(value);
			default:
				throw new NbtError(`unsupported tag type ${type}`);
		}
	}

	list(elementType, items) {
		const len = items.length;
		// An empty list is conventionally typed End; Bedrock reads either.
		this.u8(len === 0 ? TAG.End : elementType);
		this.i32(len);
		if (elementType === TAG.Int) {
			// Fast path: block_indices is an int list of every cell in the structure.
			this.ensure(len * 4);
			for (let i = 0; i < len; i += 1) {
				this.view.setInt32(this.pos, items[i], true);
				this.pos += 4;
			}
			return;
		}
		const nested = elementType === TAG.List || elementType === TAG.Compound;
		for (let i = 0; i < len; i += 1) {
			const item = items[i];
			if (nested) {
				if (!item || item.type !== elementType) throw new NbtError(`list element ${i} is not of type ${elementType}`);
				this.payload(item.type, item.value, item.elementType);
			} else {
				this.payload(elementType, item);
			}
		}
	}

	compound(fields) {
		for (const [name, tag] of Object.entries(fields)) {
			if (!tag || typeof tag.type !== 'number') throw new NbtError(`compound field "${name}" is not an NBT tag`);
			this.u8(tag.type);
			this.str(name);
			this.payload(tag.type, tag.value, tag.elementType);
		}
		this.u8(TAG.End);
	}
}

/**
 * Serialize a root tag (normally a compound) to little-endian NBT bytes.
 * @param {{type:number,value:any}} root
 * @param {string} [name] root tag name; Bedrock structures use ""
 */
export function writeNbtLE(root, name = '') {
	if (!root || typeof root.type !== 'number') throw new NbtError('root is not an NBT tag');
	const w = new Writer();
	w.u8(root.type);
	w.str(name);
	w.payload(root.type, root.value, root.elementType);
	return w.buf.slice(0, w.pos);
}
