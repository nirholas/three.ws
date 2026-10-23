// Runtime half of a generated Anchor skill. This file is NOT imported: its
// text is appended verbatim to a generated handlers.js (see anchor-idl.js),
// which declares `IDL` and `RISK` constants above it. It must stay free of
// imports and of Node/browser globals beyond BigInt, TextEncoder/Decoder and
// atob/btoa so it runs inside the skill sandbox, where only `ctx.*` exists.
//
// Nothing here signs. Previews build an unsigned instruction; write tools
// return that instruction plus a confirmation table for the host's
// confirm-gated wallet flow and never hold or request a key.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RPC_URLS = {
	'mainnet-beta': 'https://api.mainnet-beta.solana.com',
	devnet: 'https://api.devnet.solana.com',
};

function b58encode(bytes) {
	let n = 0n;
	for (const b of bytes) n = (n << 8n) | BigInt(b);
	let out = '';
	while (n > 0n) {
		out = B58[Number(n % 58n)] + out;
		n /= 58n;
	}
	for (const b of bytes) {
		if (b !== 0) break;
		out = '1' + out;
	}
	return out;
}

function b58decode(str) {
	let n = 0n;
	for (const ch of str) {
		const i = B58.indexOf(ch);
		if (i < 0) throw new Error(`invalid base58 character "${ch}"`);
		n = n * 58n + BigInt(i);
	}
	const bytes = [];
	while (n > 0n) {
		bytes.unshift(Number(n & 0xffn));
		n >>= 8n;
	}
	let zeros = 0;
	for (const ch of str) {
		if (ch !== '1') break;
		zeros += 1;
	}
	return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

function pubkeyBytes(value, label) {
	if (typeof value !== 'string') throw new Error(`${label} must be a base58 address`);
	let bytes;
	try {
		bytes = b58decode(value);
	} catch (err) {
		throw new Error(`${label}: ${err.message}`);
	}
	if (bytes.length !== 32) throw new Error(`${label} must decode to 32 bytes, got ${bytes.length}`);
	return bytes;
}

function toBase64(bytes) {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromBase64(text) {
	const s = atob(text);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
	return out;
}

function toHex(bytes) {
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const INT_SIZES = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16, u256: 32, i8: 1, i16: 2, i32: 4, i64: 8, i128: 16, i256: 32 };

function definedName(type) {
	const d = type.defined;
	return typeof d === 'string' ? d : d.name;
}

function findType(name) {
	const t = (IDL.types || []).find((x) => x.name === name);
	if (!t) throw new Error(`IDL type "${name}" is not defined`);
	return t.type;
}

class Reader {
	constructor(bytes) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.pos = 0;
	}
	take(n) {
		if (this.pos + n > this.bytes.length) throw new Error('account data ended before the IDL layout did');
		const out = this.bytes.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}
}

function readInt(r, kind) {
	const size = INT_SIZES[kind];
	const signed = kind[0] === 'i';
	const raw = r.take(size);
	let n = 0n;
	for (let i = size - 1; i >= 0; i -= 1) n = (n << 8n) | BigInt(raw[i]);
	if (signed && raw[size - 1] & 0x80) n -= 1n << BigInt(size * 8);
	return size <= 4 ? Number(n) : n.toString();
}

function decodeValue(r, type) {
	if (typeof type === 'string') {
		if (type in INT_SIZES) return readInt(r, type);
		if (type === 'bool') return r.take(1)[0] !== 0;
		if (type === 'pubkey' || type === 'publicKey') return b58encode(r.take(32));
		if (type === 'string') {
			const len = readInt(r, 'u32');
			return new TextDecoder().decode(r.take(len));
		}
		if (type === 'bytes') return toHex(r.take(readInt(r, 'u32')));
		if (type === 'f32') return new DataView(r.take(4).slice().buffer).getFloat32(0, true);
		if (type === 'f64') return new DataView(r.take(8).slice().buffer).getFloat64(0, true);
		throw new Error(`unsupported IDL type "${type}"`);
	}
	if (type.vec) {
		const len = readInt(r, 'u32');
		return Array.from({ length: len }, () => decodeValue(r, type.vec));
	}
	if (type.option || type.coption) {
		const inner = type.option || type.coption;
		const flag = type.coption ? readInt(r, 'u32') : r.take(1)[0];
		return flag ? decodeValue(r, inner) : null;
	}
	if (type.array) {
		const [inner, len] = type.array;
		if (inner === 'u8') return toHex(r.take(len));
		return Array.from({ length: len }, () => decodeValue(r, inner));
	}
	if (type.defined) return decodeDefined(r, findType(definedName(type)));
	throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
}

function decodeDefined(r, def) {
	if (def.kind === 'struct') {
		const fields = def.fields || [];
		if (fields.length && typeof fields[0] === 'object' && fields[0].name) {
			const out = {};
			for (const f of fields) out[f.name] = decodeValue(r, f.type);
			return out;
		}
		return fields.map((t) => decodeValue(r, t));
	}
	if (def.kind === 'enum') {
		const idx = r.take(1)[0];
		const variant = def.variants[idx];
		if (!variant) throw new Error(`enum variant index ${idx} is out of range`);
		if (!variant.fields) return variant.name;
		const fields = variant.fields;
		if (typeof fields[0] === 'object' && fields[0].name) {
			const out = {};
			for (const f of fields) out[f.name] = decodeValue(r, f.type);
			return { [variant.name]: out };
		}
		return { [variant.name]: fields.map((t) => decodeValue(r, t)) };
	}
	throw new Error(`unsupported IDL type kind "${def.kind}"`);
}

function writeInt(out, kind, value) {
	const size = INT_SIZES[kind];
	let n;
	try {
		n = BigInt(value);
	} catch {
		throw new Error(`${kind} argument must be an integer, got ${JSON.stringify(value)}`);
	}
	const bits = BigInt(size * 8);
	const signed = kind[0] === 'i';
	const min = signed ? -(1n << (bits - 1n)) : 0n;
	const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
	if (n < min || n > max) throw new Error(`${kind} argument ${n} is out of range`);
	if (n < 0n) n += 1n << bits;
	for (let i = 0; i < size; i += 1) {
		out.push(Number(n & 0xffn));
		n >>= 8n;
	}
}

function encodeValue(out, type, value, label) {
	if (typeof type === 'string') {
		if (type in INT_SIZES) return writeInt(out, type, value);
		if (type === 'bool') {
			if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
			return out.push(value ? 1 : 0);
		}
		if (type === 'pubkey' || type === 'publicKey') {
			return out.push(...pubkeyBytes(value, label));
		}
		if (type === 'string') {
			if (typeof value !== 'string') throw new Error(`${label} must be a string`);
			const bytes = new TextEncoder().encode(value);
			writeInt(out, 'u32', bytes.length);
			return out.push(...bytes);
		}
		if (type === 'bytes') {
			const bytes = hexBytes(value, label);
			writeInt(out, 'u32', bytes.length);
			return out.push(...bytes);
		}
		throw new Error(`unsupported IDL type "${type}"`);
	}
	if (type.vec) {
		if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
		writeInt(out, 'u32', value.length);
		return value.forEach((v, i) => encodeValue(out, type.vec, v, `${label}[${i}]`));
	}
	if (type.option) {
		if (value === null || value === undefined) return out.push(0);
		out.push(1);
		return encodeValue(out, type.option, value, label);
	}
	if (type.array) {
		const [inner, len] = type.array;
		if (inner === 'u8') {
			const bytes = hexBytes(value, label);
			if (bytes.length !== len) throw new Error(`${label} must be ${len} bytes (hex), got ${bytes.length}`);
			return out.push(...bytes);
		}
		if (!Array.isArray(value) || value.length !== len) throw new Error(`${label} must be an array of ${len}`);
		return value.forEach((v, i) => encodeValue(out, inner, v, `${label}[${i}]`));
	}
	if (type.defined) return encodeDefined(out, findType(definedName(type)), value, label);
	throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
}

function hexBytes(value, label) {
	if (Array.isArray(value)) return Uint8Array.from(value);
	if (typeof value !== 'string' || value.length % 2 || /[^0-9a-fA-F]/.test(value)) {
		throw new Error(`${label} must be a hex string`);
	}
	const bytes = new Uint8Array(value.length / 2);
	for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

function encodeDefined(out, def, value, label) {
	if (def.kind === 'struct') {
		const fields = def.fields || [];
		if (fields.length && typeof fields[0] === 'object' && fields[0].name) {
			if (!value || typeof value !== 'object') throw new Error(`${label} must be an object`);
			for (const f of fields) encodeValue(out, f.type, value[f.name], `${label}.${f.name}`);
			return;
		}
		if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
		return fields.forEach((t, i) => encodeValue(out, t, value[i], `${label}[${i}]`));
	}
	if (def.kind === 'enum') {
		const name = typeof value === 'string' ? value : value && Object.keys(value)[0];
		const idx = def.variants.findIndex((v) => v.name === name);
		if (idx < 0) throw new Error(`${label} must be one of ${def.variants.map((v) => v.name).join(', ')}`);
		out.push(idx);
		const variant = def.variants[idx];
		if (!variant.fields) return;
		const payload = value[name];
		if (typeof variant.fields[0] === 'object' && variant.fields[0].name) {
			return variant.fields.forEach((f) => encodeValue(out, f.type, payload?.[f.name], `${label}.${name}.${f.name}`));
		}
		return variant.fields.forEach((t, i) => encodeValue(out, t, payload?.[i], `${label}.${name}[${i}]`));
	}
	throw new Error(`unsupported IDL type kind "${def.kind}"`);
}

function flattenAccounts(list, prefix = '') {
	const out = [];
	for (const a of list) {
		const name = prefix + a.name;
		if (a.accounts) out.push(...flattenAccounts(a.accounts, `${name}.`));
		else out.push({ ...a, name });
	}
	return out;
}

function rpcUrl(args, ctx) {
	const override = ctx?.secrets?.SOLANA_RPC_URL;
	if (override) return override;
	const cluster = args?.cluster || 'mainnet-beta';
	const url = RPC_URLS[cluster];
	if (!url) throw new Error(`cluster must be one of ${Object.keys(RPC_URLS).join(', ')}`);
	return url;
}

async function fetchAccount(address, args, ctx) {
	pubkeyBytes(address, 'address');
	const res = await ctx.fetch(rpcUrl(args, ctx), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'getAccountInfo',
			params: [address, { encoding: 'base64', commitment: 'confirmed' }],
		}),
	});
	if (!res.ok) throw new Error(`Solana RPC returned ${res.status}`);
	const body = JSON.parse(await res.text());
	if (body.error) throw new Error(`Solana RPC error: ${body.error.message}`);
	const value = body.result?.value;
	if (!value) throw new Error(`account ${address} does not exist on ${args?.cluster || 'mainnet-beta'}`);
	return { owner: value.owner, lamports: value.lamports, data: fromBase64(value.data[0]) };
}

async function readAccountTool(typeName, args, ctx) {
	const address = args?.address;
	const meta = IDL.accounts.find((a) => a.name === typeName);
	const acct = await fetchAccount(address, args, ctx);
	if (acct.owner !== IDL.address) {
		throw new Error(`account ${address} is owned by ${acct.owner}, not program ${IDL.address}`);
	}
	const disc = acct.data.subarray(0, 8);
	if (disc.length < 8 || meta.discriminator.some((b, i) => disc[i] !== b)) {
		const other = IDL.accounts.find((a) => a.discriminator.every((b, i) => disc[i] === b));
		throw new Error(
			other
				? `account ${address} is a ${other.name}, not a ${typeName}`
				: `account ${address} does not carry the ${typeName} discriminator`
		);
	}
	const r = new Reader(acct.data.subarray(8));
	const decoded = decodeDefined(r, findType(typeName));
	return { address, type: typeName, program_id: IDL.address, lamports: acct.lamports, data: decoded };
}

function buildInstruction(name, args) {
	const ix = IDL.instructions.find((i) => i.name === name);
	const accountInput = args?.accounts && typeof args.accounts === 'object' ? args.accounts : {};
	const argInput = args?.args && typeof args.args === 'object' ? args.args : {};

	const accounts = flattenAccounts(ix.accounts).map((a) => {
		const pubkey = a.address || accountInput[a.name];
		if (!pubkey) throw new Error(`accounts.${a.name} is required`);
		pubkeyBytes(pubkey, `accounts.${a.name}`);
		return { name: a.name, pubkey, isSigner: Boolean(a.signer), isWritable: Boolean(a.writable) };
	});

	const out = [...ix.discriminator];
	for (const a of ix.args) encodeValue(out, a.type, argInput[a.name], `args.${a.name}`);
	const data = Uint8Array.from(out);

	const risk = RISK[name];
	const summary = [
		`${name} on program ${IDL.address}`,
		ix.args.length ? `args: ${ix.args.map((a) => `${a.name}=${JSON.stringify(argInput[a.name])}`).join(', ')}` : 'no args',
		`signers: ${accounts.filter((a) => a.isSigner).map((a) => `${a.name} (${a.pubkey})`).join(', ') || 'none'}`,
		`writable: ${accounts.filter((a) => a.isWritable).map((a) => a.name).join(', ') || 'none'}`,
		risk.flags.length ? `risk ${risk.level}: ${risk.flags.map((f) => f.label).join('; ')}` : 'risk low: no token movement, account closure or authority change detected',
	].join('\n');

	return {
		program_id: IDL.address,
		instruction: name,
		accounts,
		data_base64: toBase64(data),
		data_hex: toHex(data),
		summary,
		risk,
	};
}

function previewTool(name, args) {
	return { ...buildInstruction(name, args), signed: false };
}

function sendTool(name, args) {
	const built = buildInstruction(name, args);
	return {
		status: 'confirmation_required',
		signed: false,
		message:
			'Nothing was signed or sent. Show the summary to the wallet owner and submit this instruction through the confirm-gated wallet flow; it executes only after their explicit yes.',
		...built,
	};
}
