// Reader for multi-part Solana memo inscriptions. Three upstream formats are rebuilt and verified:
//
//   first/1    JSON envelope per memo: { protocol, id, type, part (1-based), total, data }.
//              No content hash; the writer's signer must be identical on every part.
//   firsts/1   JSON envelope per memo: { p, id, i (0-based), n, data (base64url) }, with
//              name, mime and the full SHA-256 on chunk 0 only.
//   spl404     "spl404:c:<fileId>:<index>:<total>:<base64>" chunk memos plus one JSON manifest
//              memo that lists every chunk signature and the SHA-256 of the whole file.
//
// This module is dependency free and runs unchanged in Node 20+ and in the browser
// (public/onchain/inscriptions.js is a byte-identical copy; tests/solana-memo-inscriptions-copy.test.js
// keeps them in step). Everything read from chain is untrusted: bytes are only handed back after
// every structural check passes, and SVG/HTML are classified as text, never as renderable media.

export const LIMITS = Object.freeze({
	maxParts: 1024,
	maxBytes: 8 * 1024 * 1024,
	maxTextBytes: 64 * 1024,
	maxDiscoveryPages: 3,
	fetchConcurrency: 4,
});

export const FIRST_TYPES = new Set(['text', 'json', 'image', 'agent']);
const RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SPL404_CHUNK_PREFIX = 'spl404:c:';
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export class InscriptionError extends Error {
	constructor(message, code = 'invalid_inscription') {
		super(message);
		this.code = code;
	}
}

// ---------------------------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------------------------

// Accepts standard and URL-safe alphabets, padded or not. Anything else is a hard error.
export function base64ToBytes(text) {
	if (typeof text !== 'string') throw new InscriptionError('Base64 payload must be a string.');
	const clean = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new InscriptionError('Payload is not valid base64.');
	const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function bytesToBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

export async function sha256Hex(bytes) {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concat(parts, total) {
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(bytes) {
	try {
		return strictDecoder.decode(bytes);
	} catch {
		return null;
	}
}

function isSafeInt(value) {
	return Number.isSafeInteger(value);
}

// ---------------------------------------------------------------------------------------------
// Memo classification
// ---------------------------------------------------------------------------------------------

// Returns one of { protocol: 'first/1' | 'firsts/1' | 'spl404/chunk' | 'spl404/manifest', ... }
// or null when the memo is not a recognised, well-formed multi-part envelope.
export function classifyMemo(text) {
	if (typeof text !== 'string') return null;
	if (text.startsWith(SPL404_CHUNK_PREFIX)) return parseSpl404Chunk(text);
	if (text[0] !== '{') return null;
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		return null;
	}
	if (!json || typeof json !== 'object') return null;
	if (json.protocol === 'first/1') return parseFirst(json);
	if (json.p === 'firsts/1') return parseFirsts(json);
	if (json.p === 'spl404') return parseSpl404Manifest(json);
	return null;
}

function parseFirst(json) {
	const { id, type, part, total, data } = json;
	if (typeof id !== 'string' || !id || typeof data !== 'string') return null;
	if (!FIRST_TYPES.has(type)) return null;
	if (!isSafeInt(part) || !isSafeInt(total) || part < 1 || total < part) return null;
	return { protocol: 'first/1', id, type, part, total, data };
}

function parseFirsts(json) {
	const { id, i, n, data } = json;
	if (typeof id !== 'string' || !HEX16.test(id) || typeof data !== 'string') return null;
	if (!isSafeInt(i) || !isSafeInt(n) || i < 0 || n < 1 || i >= n) return null;
	let bytes;
	try {
		bytes = base64ToBytes(data);
	} catch {
		return null;
	}
	if (i === 0 && !HEX64.test(json.hash)) return null;
	return {
		protocol: 'firsts/1',
		id,
		index: i,
		total: n,
		bytes,
		name: i === 0 && typeof json.name === 'string' ? json.name : null,
		mime: i === 0 && typeof json.mime === 'string' ? json.mime : null,
		hash: i === 0 ? json.hash : null,
	};
}

function parseSpl404Chunk(text) {
	const parts = text.slice(SPL404_CHUNK_PREFIX.length).split(':');
	if (parts.length !== 4) return null;
	const [fileId, index, total, data] = parts;
	if (!HEX16.test(fileId) || !/^\d{1,9}$/.test(index) || !/^\d{1,9}$/.test(total)) return null;
	const i = Number(index);
	const n = Number(total);
	if (i >= n) return null;
	try {
		return { protocol: 'spl404/chunk', fileId, index: i, total: n, bytes: base64ToBytes(data) };
	} catch {
		return null;
	}
}

function parseSpl404Manifest(json) {
	if (json.v !== 1 || json.t !== 'file' || !Array.isArray(json.chunks)) return null;
	if (typeof json.sha256 !== 'string' || !HEX64.test(json.sha256)) return null;
	const chunks = json.chunks.filter((signature) => typeof signature === 'string');
	if (chunks.length !== json.chunks.length) return null;
	return {
		protocol: 'spl404/manifest',
		name: typeof json.name === 'string' ? json.name : 'file',
		mime: typeof json.mime === 'string' ? json.mime : 'application/octet-stream',
		size: isSafeInt(json.size) && json.size >= 0 ? json.size : 0,
		hash: json.sha256,
		chunks,
	};
}

// ---------------------------------------------------------------------------------------------
// Presentation: what a client may do with reassembled bytes
// ---------------------------------------------------------------------------------------------

export function sniffRasterMime(bytes) {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
	if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
	return null;
}

// kind 'image': raster bytes whose magic number matches (declared MIME is never trusted).
// kind 'text':  UTF-8 text, shown as characters only. SVG and HTML land here with markup=true.
// kind 'binary': everything else, download only.
export function presentation(bytes, { mime = null, name = null } = {}) {
	const raster = sniffRasterMime(bytes);
	if (raster) return { kind: 'image', mime: raster, markup: false, text: null };
	const text = bytes.length <= LIMITS.maxBytes ? decodeUtf8(bytes) : null;
	if (text !== null && !text.includes('\u0000')) {
		const probe = text.slice(0, 2048).toLowerCase();
		const declared = `${mime || ''} ${name || ''}`.toLowerCase();
		const markup = /<svg[\s>]|<!doctype html|<html[\s>]|<script[\s>]|<\?xml/.test(probe) || /svg|html|xml/.test(declared);
		return { kind: 'text', mime: null, markup, text: text.length > LIMITS.maxTextBytes ? text.slice(0, LIMITS.maxTextBytes) : text, truncated: text.length > LIMITS.maxTextBytes };
	}
	return { kind: 'binary', mime: null, markup: false, text: null };
}

// ---------------------------------------------------------------------------------------------
// Assembly. Each assembler takes already-classified parts and returns a result object:
//   status   'verified'   all parts present and the writer's own SHA-256 matches
//            'complete'   all parts present; the format declares no hash (first/1)
//            'incomplete' parts are missing (missing[] lists 1-based part numbers)
//            'invalid'    parts disagree, overflow limits, or the hash does not match
//   bytes    only set for verified/complete; unverified bytes are never returned
// ---------------------------------------------------------------------------------------------

async function finish(base, parts, problems, { declaredHash, hasHash }) {
	const missing = base.missing;
	const result = {
		...base,
		declared_sha256: declaredHash || null,
		problems,
		bytes: null,
		content: null,
		content_sha256: null,
		size: 0,
		sha256: null,
		presentation: null,
	};
	if (missing.length) {
		result.status = 'incomplete';
		return result;
	}
	const total = parts.reduce((sum, part) => sum + part.bytes.length, 0);
	if (total > LIMITS.maxBytes) {
		result.status = 'invalid';
		problems.push(`Reassembled size exceeds the ${LIMITS.maxBytes}-byte limit.`);
		return result;
	}
	const bytes = concat(parts.map((part) => part.bytes), total);
	result.size = total;
	result.sha256 = await sha256Hex(bytes);
	if (hasHash && declaredHash !== result.sha256) problems.push('SHA-256 of the rebuilt bytes does not match the hash the writer declared.');
	if (problems.length) {
		result.status = 'invalid';
		return result;
	}
	result.status = hasHash ? 'verified' : 'complete';
	result.bytes = bytes;
	result.content = bytes;
	result.content_sha256 = result.sha256;
	result.presentation = presentation(bytes, { mime: result.mime, name: result.name });
	return result;
}

async function partSummaries(parts) {
	return Promise.all(parts.map(async (part) => ({ part: part.number, signature: part.signature, byte_length: part.bytes.length, sha256: await sha256Hex(part.bytes) })));
}

function missingParts(total, present) {
	const out = [];
	for (let n = 1; n <= total; n++) if (!present.has(n)) out.push(n);
	return out;
}

// entries: [{ signature, signer, envelope }] where envelope.protocol === 'first/1'.
export async function assembleFirst(entries) {
	const problems = [];
	if (!entries.length) throw new InscriptionError('No first/1 parts supplied.', 'no_parts');
	const { id, type, total } = entries[0].envelope;
	const signer = entries[0].signer ?? null;
	const byPart = new Map();
	for (const { signature, signer: partSigner, envelope } of entries) {
		if (envelope.id !== id || envelope.type !== type) { problems.push(`Part ${envelope.part} belongs to a different artifact.`); continue; }
		if (envelope.total !== total) { problems.push(`Part ${envelope.part} declares ${envelope.total} parts, expected ${total}.`); continue; }
		if (partSigner !== signer) { problems.push(`Part ${envelope.part} was signed by a different wallet.`); continue; }
		if (envelope.part > total) { problems.push(`Part ${envelope.part} is out of range.`); continue; }
		if (byPart.has(envelope.part)) { problems.push(`Part ${envelope.part} appears more than once.`); continue; }
		byPart.set(envelope.part, { number: envelope.part, signature, bytes: encoder.encode(envelope.data) });
	}
	if (total > LIMITS.maxParts) problems.push(`Artifact declares ${total} parts, over the ${LIMITS.maxParts}-part limit.`);
	const parts = [...byPart.values()].sort((a, b) => a.number - b.number);
	const missing = missingParts(Math.min(total, LIMITS.maxParts), byPart);
	const result = await finish(
		{ protocol: 'first/1', id, type, name: null, mime: null, signer, parts_total: total, parts_found: parts.length, missing, parts: await partSummaries(parts) },
		parts, problems, { declaredHash: null, hasHash: false },
	);
	if (result.status === 'complete') await validateFirstType(result);
	return result;
}

// first/1 type rules apply after reassembly: json parses, image is a data URI, agent has a manifest.
async function validateFirstType(result) {
	const text = decodeUtf8(result.bytes);
	const fail = (message) => { result.problems.push(message); result.status = 'invalid'; result.bytes = null; result.content = null; result.content_sha256 = null; result.presentation = null; };
	if (text === null) return fail('Reassembled data is not valid UTF-8.');
	if (result.type === 'text') { result.presentation = presentation(result.bytes); return; }
	if (result.type === 'json' || result.type === 'agent') {
		let json;
		try { json = JSON.parse(text); } catch { return fail(`Reassembled ${result.type} data is not valid JSON.`); }
		if (result.type === 'agent') {
			const ok = json && typeof json.name === 'string' && typeof json.version === 'string' && typeof json.endpoint === 'string' && /^https:\/\//.test(json.endpoint);
			if (!ok) return fail('Agent manifest needs a name, a version, and an HTTPS endpoint.');
		}
		result.presentation = { kind: 'text', mime: null, markup: false, text: text.length > LIMITS.maxTextBytes ? text.slice(0, LIMITS.maxTextBytes) : text, truncated: text.length > LIMITS.maxTextBytes };
		return;
	}
	const match = /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=_-]+)$/i.exec(text.trim());
	if (!match) return fail('Image artifact is not a base64 data URI.');
	let media;
	try { media = base64ToBytes(match[2]); } catch { return fail('Image data URI holds invalid base64.'); }
	const declaredMime = match[1].toLowerCase();
	result.mime = declaredMime;
	result.content = media;
	result.content_sha256 = await sha256Hex(media);
	const view = presentation(media, { mime: declaredMime });
	result.presentation = view.kind === 'image' ? view : { ...view, kind: view.kind === 'text' ? 'text' : 'binary' };
}

// entries: [{ signature, signer, envelope }] where envelope.protocol === 'firsts/1'.
export async function assembleFirsts(entries) {
	const problems = [];
	if (!entries.length) throw new InscriptionError('No firsts/1 chunks supplied.', 'no_parts');
	const { id, total } = entries[0].envelope;
	const byIndex = new Map();
	for (const { signature, envelope } of entries) {
		if (envelope.id !== id || envelope.total !== total) { problems.push(`Chunk ${envelope.index + 1} belongs to a different artifact.`); continue; }
		if (byIndex.has(envelope.index)) { problems.push(`Chunk ${envelope.index + 1} appears more than once.`); continue; }
		byIndex.set(envelope.index, { number: envelope.index + 1, signature, bytes: envelope.bytes, envelope });
	}
	if (total > LIMITS.maxParts) problems.push(`Artifact declares ${total} chunks, over the ${LIMITS.maxParts}-chunk limit.`);
	const parts = [...byIndex.values()].sort((a, b) => a.number - b.number);
	const head = byIndex.get(0)?.envelope;
	const missing = missingParts(Math.min(total, LIMITS.maxParts), new Set(parts.map((part) => part.number)));
	const result = await finish(
		{ protocol: 'firsts/1', id, type: null, name: head?.name ?? null, mime: head?.mime ?? null, signer: entries[0].signer ?? null, parts_total: total, parts_found: parts.length, missing, parts: await partSummaries(parts) },
		parts, problems, { declaredHash: head?.hash ?? null, hasHash: Boolean(head) },
	);
	if (!missing.length && head && result.sha256 && result.sha256.slice(0, 16) !== id) {
		result.problems.push('Artifact ID is not the first 16 hex characters of the content digest.');
		result.status = 'invalid';
		result.bytes = null;
		result.content = null;
		result.content_sha256 = null;
		result.presentation = null;
	}
	return result;
}

// manifest: classified spl404/manifest. chunkEntries: Map<signature, { index, total, fileId, bytes }|null>
// holding what each listed signature yielded (null when missing or not an spl404 chunk).
export async function assembleSpl404(manifest, chunkEntries) {
	const problems = [];
	const expectedId = manifest.hash.slice(0, 16);
	const total = manifest.chunks.length;
	if (total === 0) problems.push('Manifest lists no chunks.');
	if (total > LIMITS.maxParts) problems.push(`Manifest lists ${total} chunks, over the ${LIMITS.maxParts}-chunk limit.`);
	if (new Set(manifest.chunks).size !== total) problems.push('Manifest lists the same chunk signature more than once.');
	const byIndex = new Map();
	const unreadable = [];
	manifest.chunks.forEach((signature, position) => {
		const chunk = chunkEntries.get(signature);
		if (!chunk) { unreadable.push(position + 1); return; }
		if (chunk.fileId !== expectedId) { problems.push(`Chunk ${position + 1} belongs to a different file.`); return; }
		if (chunk.total !== total) { problems.push(`Chunk ${position + 1} declares ${chunk.total} parts, manifest lists ${total}.`); return; }
		if (byIndex.has(chunk.index)) { problems.push(`Chunk index ${chunk.index + 1} appears more than once.`); return; }
		byIndex.set(chunk.index, { number: chunk.index + 1, signature, bytes: chunk.bytes });
	});
	if (unreadable.length) problems.push(`Chunk ${unreadable.join(', ')} could not be read or is not an SPL404 chunk.`);
	const parts = [...byIndex.values()].sort((a, b) => a.number - b.number);
	const missing = missingParts(Math.min(total, LIMITS.maxParts), new Set(parts.map((part) => part.number)));
	const result = await finish(
		{ protocol: 'spl404', id: expectedId, type: null, name: manifest.name, mime: manifest.mime, signer: null, parts_total: total, parts_found: parts.length, missing, parts: await partSummaries(parts) },
		parts, problems, { declaredHash: manifest.hash, hasHash: true },
	);
	if (!missing.length && manifest.size && result.size && manifest.size !== result.size) {
		result.problems.push(`Rebuilt ${result.size} bytes, manifest says ${manifest.size}.`);
		result.status = 'invalid';
		result.bytes = null;
		result.content = null;
		result.content_sha256 = null;
		result.presentation = null;
	}
	return result;
}

// ---------------------------------------------------------------------------------------------
// Transaction access (jsonParsed getTransaction result)
// ---------------------------------------------------------------------------------------------

const MEMO_PROGRAMS = new Set([
	'Memo1UhkJRfHyvLMcVLMbLJYfW2tfU8G8H4PqvV6v8',
	'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
	'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH',
]);

export function memoTexts(transaction) {
	const message = transaction?.transaction?.message;
	const groups = [message?.instructions || [], ...(transaction?.meta?.innerInstructions || []).map((item) => item.instructions || [])];
	const out = [];
	for (const instructions of groups) {
		for (const instruction of instructions) {
			const memo = MEMO_PROGRAMS.has(instruction?.programId) || instruction?.program === 'spl-memo';
			if (memo && typeof instruction.parsed === 'string') out.push(instruction.parsed);
		}
	}
	return out;
}

export function transactionSigner(transaction) {
	return transaction?.transaction?.message?.accountKeys?.find((key) => key?.signer)?.pubkey ?? null;
}

// Each classified multi-part envelope found in one transaction.
export function envelopesIn(signature, transaction) {
	const signer = transactionSigner(transaction);
	const out = [];
	for (const text of memoTexts(transaction)) {
		const envelope = classifyMemo(text);
		if (envelope) out.push({ signature, signer, envelope });
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Orchestration. Transport is injected so Node (RPC with fallbacks) and the browser (one RPC URL)
// share every rule.
//   getTransaction: async function taking a signature, returning a jsonParsed transaction or null.
//   listSignatures: optional async function taking an address and paging options, returning
//                   signature rows with err and memo fields; enables sibling discovery.
// ---------------------------------------------------------------------------------------------

async function mapLimit(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	}));
	return results;
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function readInscription({ signature, signatures = [], getTransaction, listSignatures = null, discover = true }) {
	const cache = new Map();
	const fetchOne = async (sig) => {
		if (!cache.has(sig)) cache.set(sig, getTransaction(sig).catch((error) => { throw Object.assign(error, { signature: sig }); }));
		return cache.get(sig);
	};
	const fetchMany = async (sigs) => mapLimit([...new Set(sigs)], LIMITS.fetchConcurrency, async (sig) => {
		try { return { sig, transaction: await fetchOne(sig) }; } catch (error) { return { sig, transaction: null, error }; }
	});

	const supplied = [...new Set([signature, ...signatures])];
	const fetched = await fetchMany(supplied);
	const anchor = fetched.find((item) => item.sig === signature);
	if (!anchor?.transaction) {
		throw new InscriptionError('Transaction was not found or is not available from the configured RPC endpoints.', 'transaction_not_found');
	}
	const entries = fetched.flatMap((item) => (item.transaction ? envelopesIn(item.sig, item.transaction) : []));
	const anchorEntry = entries.find((entry) => entry.signature === signature);
	if (!anchorEntry) return { protocol: null, status: 'not_inscription', signature, signatures: supplied };
	const seed = anchorEntry.envelope;

	const discoverBySigner = async (needle, accept) => {
		if (!discover || !listSignatures || !anchorEntry.signer) return;
		let before;
		for (let page = 0; page < LIMITS.maxDiscoveryPages; page++) {
			const listed = (await listSignatures(anchorEntry.signer, before ? { before } : {})) || [];
			if (!listed.length) return;
			const hits = listed.filter((item) => item?.signature && !item.err && typeof item.memo === 'string' && needle.test(item.memo) && !cache.has(item.signature)).map((item) => item.signature);
			for (const result of await fetchMany(hits.slice(0, LIMITS.maxParts))) {
				if (result.transaction) entries.push(...envelopesIn(result.sig, result.transaction));
			}
			if (accept()) return;
			before = listed.at(-1).signature;
			if (listed.length < 1000) return;
		}
	};

	let result;
	if (seed.protocol === 'first/1') {
		const group = () => entries.filter((e) => e.envelope.protocol === 'first/1' && e.envelope.id === seed.id && e.envelope.type === seed.type && e.signer === anchorEntry.signer);
		const complete = () => new Set(group().map((e) => e.envelope.part)).size >= seed.total;
		if (!complete()) await discoverBySigner(new RegExp(`"id"\\s*:\\s*"${escapeRegExp(seed.id)}"`), complete);
		result = await assembleFirst(dedupe(group()));
	} else if (seed.protocol === 'firsts/1') {
		const group = () => entries.filter((e) => e.envelope.protocol === 'firsts/1' && e.envelope.id === seed.id);
		const complete = () => new Set(group().map((e) => e.envelope.index)).size >= seed.total;
		if (!complete()) await discoverBySigner(new RegExp(`"id"\\s*:\\s*"${seed.id}"`), complete);
		result = await assembleFirsts(dedupe(group()));
	} else {
		let manifest = seed.protocol === 'spl404/manifest' ? seed : entries.map((e) => e.envelope).find((e) => e.protocol === 'spl404/manifest' && e.hash.startsWith(seed.fileId));
		if (!manifest) {
			await discoverBySigner(new RegExp(`"sha256"\\s*:\\s*"${seed.fileId}[0-9a-f]{48}"`), () => entries.some((e) => e.envelope.protocol === 'spl404/manifest' && e.envelope.hash.startsWith(seed.fileId)));
			manifest = entries.map((e) => e.envelope).find((e) => e.protocol === 'spl404/manifest' && e.hash.startsWith(seed.fileId));
		}
		if (!manifest) {
			return {
				protocol: 'spl404', id: seed.fileId, status: 'incomplete', signature, signatures: supplied, parts_total: seed.total, parts_found: 1,
				missing: [], parts: [], problems: ['This is one chunk of a multi-part file. Its manifest was not found; supply the manifest transaction signature.'],
				bytes: null, size: 0, sha256: null, declared_sha256: null, presentation: null, name: null, mime: null, type: null, signer: anchorEntry.signer,
			};
		}
		const chunkMap = new Map();
		const wanted = manifest.chunks.slice(0, LIMITS.maxParts);
		for (const result of await fetchMany(wanted)) {
			const chunk = result.transaction ? envelopesIn(result.sig, result.transaction).map((e) => e.envelope).find((e) => e.protocol === 'spl404/chunk') : null;
			chunkMap.set(result.sig, chunk || null);
		}
		result = await assembleSpl404(manifest, chunkMap);
		if (!result.signer) result.signer = anchorEntry.signer;
		result.signatures = [signature, ...wanted];
		return finalize(result, signature);
	}
	result.signatures = [...new Set([signature, ...result.parts.map((part) => part.signature)])];
	return finalize(result, signature);
}

function finalize(result, signature) {
	return { signature, ...result };
}

function dedupe(entries) {
	const seen = new Set();
	return entries.filter((entry) => {
		const key = `${entry.signature}:${entry.envelope.part ?? entry.envelope.index}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
