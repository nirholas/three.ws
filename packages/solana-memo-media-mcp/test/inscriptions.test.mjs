import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { present } from '../src/tools/read-inscription.js';
import { assembleFirst, assembleFirsts, assembleSpl404, classifyMemo, presentation, readInscription } from '../src/lib/inscriptions.js';

// The writers are re-implemented here from each upstream PROTOCOL document, independently of the
// reader, so the tests exercise the wire format rather than the reader's own assumptions.
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const WALLET_A = 'THREEsynthetic1111111111111111111111111111A';
const WALLET_B = 'THREEsynthetic1111111111111111111111111111B';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwV8YQAAAABJRU5ErkJggg==', 'base64');

// jsonParsed getTransaction shape; `extra` adds a Compute Budget instruction that must be ignored.
function tx(signer, memo, { inner = false } = {}) {
	const instruction = { program: 'spl-memo', programId: MEMO, parsed: memo };
	return {
		version: 1, slot: 7, blockTime: 1,
		transaction: { message: { accountKeys: [{ pubkey: signer, signer: true }], instructions: inner ? [] : [{ programId: 'ComputeBudget111111111111111111111111111111', parsed: { type: 'setComputeUnitLimit' } }, instruction] } },
		meta: { innerInstructions: inner ? [{ index: 0, instructions: [instruction] }] : [] },
	};
}

function firstsChunks(bytes, { name = 'dot.png', mime = 'image/png', size = 40 } = {}) {
	const hash = sha(bytes);
	const total = Math.ceil(bytes.length / size);
	return Array.from({ length: total }, (_, i) => JSON.stringify({
		p: 'firsts/1', id: hash.slice(0, 16), i, n: total,
		...(i === 0 ? { name, mime, hash } : {}),
		data: b64url(bytes.subarray(i * size, (i + 1) * size)),
	}));
}

function firstParts(id, type, data, size = 12) {
	const total = Math.ceil(data.length / size);
	return Array.from({ length: total }, (_, i) => JSON.stringify({ protocol: 'first/1', id, type, part: i + 1, total, data: data.slice(i * size, (i + 1) * size) }));
}

function spl404(bytes, { name = 'dot.png', mime = 'image/png', size = 30 } = {}) {
	const hash = sha(bytes);
	const total = Math.ceil(bytes.length / size);
	const chunks = Array.from({ length: total }, (_, i) => `spl404:c:${hash.slice(0, 16)}:${i}:${total}:${Buffer.from(bytes.subarray(i * size, (i + 1) * size)).toString('base64')}`);
	const sigs = chunks.map((_, i) => `chunkSig${i}`.padEnd(88, 'x'));
	const manifest = JSON.stringify({ p: 'spl404', v: 1, t: 'file', name, mime, size: bytes.length, sha256: hash, chunks: sigs });
	return { hash, chunks, sigs, manifest };
}

const envelopes = (signer, memos) => memos.map((memo, i) => ({ signature: `sig${i}`, signer, envelope: classifyMemo(memo) }));

test('firsts/1 rebuilds an image from out-of-order chunks and verifies the declared hash', async () => {
	const memos = firstsChunks(PNG);
	assert.ok(memos.length > 1);
	const result = await assembleFirsts(envelopes(WALLET_A, memos).reverse());
	assert.equal(result.status, 'verified');
	assert.equal(result.sha256, sha(PNG));
	assert.equal(result.declared_sha256, sha(PNG));
	assert.equal(result.name, 'dot.png');
	assert.deepEqual(Buffer.from(result.bytes), PNG);
	assert.equal(result.presentation.kind, 'image');
	assert.equal(result.presentation.mime, 'image/png');
	assert.equal(result.parts.length, memos.length);
	assert.match(result.parts[0].sha256, /^[0-9a-f]{64}$/);
});

test('firsts/1 reports missing chunks by number and returns no bytes', async () => {
	const memos = firstsChunks(PNG);
	const partial = envelopes(WALLET_A, memos).filter((_, i) => i !== 1);
	const result = await assembleFirsts(partial);
	assert.equal(result.status, 'incomplete');
	assert.deepEqual(result.missing, [2]);
	assert.equal(result.bytes, null);
});

test('firsts/1 refuses a tampered chunk instead of displaying it', async () => {
	const memos = firstsChunks(PNG);
	const tampered = JSON.parse(memos[1]);
	tampered.data = b64url(Buffer.alloc(40, 7));
	memos[1] = JSON.stringify(tampered);
	const result = await assembleFirsts(envelopes(WALLET_A, memos));
	assert.equal(result.status, 'invalid');
	assert.equal(result.bytes, null);
	assert.match(result.problems.join(' '), /does not match/);
});

test('firsts/1 rejects a chunk 0 without a well formed hash and a mismatched artifact id', async () => {
	const memos = firstsChunks(PNG);
	const noHash = JSON.parse(memos[0]);
	delete noHash.hash;
	assert.equal(classifyMemo(JSON.stringify(noHash)), null);
	const wrongId = JSON.parse(memos[0]);
	wrongId.id = '0'.repeat(16);
	const rest = memos.slice(1).map((memo) => JSON.stringify({ ...JSON.parse(memo), id: '0'.repeat(16) }));
	const result = await assembleFirsts(envelopes(WALLET_A, [JSON.stringify(wrongId), ...rest]));
	assert.equal(result.status, 'invalid');
	assert.match(result.problems.join(' '), /Artifact ID/);
});

test('firsts/1 flags duplicate chunks and ignores unknown envelope fields', async () => {
	const memos = firstsChunks(PNG).map((memo) => JSON.stringify({ ...JSON.parse(memo), future: true }));
	const result = await assembleFirsts(envelopes(WALLET_A, [...memos, memos[0]]));
	assert.equal(result.status, 'invalid');
	assert.match(result.problems.join(' '), /more than once/);
	assert.equal((await assembleFirsts(envelopes(WALLET_A, memos))).status, 'verified');
});

test('first/1 concatenates text parts in numeric order and reports no declared hash', async () => {
	const text = 'I was here, and this note spans several memo instructions on Solana.';
	const memos = firstParts('01997ef0-0000-7000-8000-000000000000', 'text', text);
	assert.ok(memos.length >= 6);
	const shuffled = envelopes(WALLET_A, memos).sort((a, b) => b.envelope.part - a.envelope.part);
	const result = await assembleFirst(shuffled);
	assert.equal(result.status, 'complete');
	assert.equal(result.declared_sha256, null);
	assert.equal(new TextDecoder().decode(result.bytes), text);
	assert.equal(result.presentation.kind, 'text');
	assert.equal(result.sha256, sha(text));
});

test('first/1 orders parts numerically, not lexically (part 10 follows part 9)', async () => {
	const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(5);
	const memos = firstParts('numeric-order', 'text', text, 10);
	assert.ok(memos.length >= 13);
	const result = await assembleFirst(envelopes(WALLET_A, memos));
	assert.equal(new TextDecoder().decode(result.bytes), text);
});

test('first/1 requires one signer across parts and rejects out-of-range and inconsistent parts', async () => {
	const memos = firstParts('one-signer', 'text', 'x'.repeat(30), 10);
	const mixed = envelopes(WALLET_A, memos);
	mixed[1].signer = WALLET_B;
	const signerResult = await assembleFirst(mixed);
	assert.equal(signerResult.status, 'incomplete');
	assert.match(signerResult.problems.join(' '), /different wallet/);

	const inconsistent = envelopes(WALLET_A, memos);
	inconsistent[2].envelope = { ...inconsistent[2].envelope, total: 9 };
	assert.match((await assembleFirst(inconsistent)).problems.join(' '), /declares 9 parts/);

	assert.equal(classifyMemo(JSON.stringify({ protocol: 'first/1', id: 'a', type: 'text', part: 4, total: 3, data: '' })), null);
	assert.equal(classifyMemo(JSON.stringify({ protocol: 'first/1', id: 'a', type: 'video', part: 1, total: 1, data: '' })), null);
	assert.equal(classifyMemo(JSON.stringify({ protocol: 'first/1', id: 'a', type: 'text', part: 0, total: 1, data: '' })), null);
});

test('first/1 validates type after reassembly: json, agent, and image data URIs', async () => {
	const json = await assembleFirst(envelopes(WALLET_A, firstParts('j', 'json', '{"ok":true,"n":[1,2,3]}')));
	assert.equal(json.status, 'complete');
	const badJson = await assembleFirst(envelopes(WALLET_A, firstParts('j2', 'json', '{"ok":')));
	assert.equal(badJson.status, 'invalid');

	const agent = JSON.stringify({ name: 'Scout', version: '1.0.0', endpoint: 'https://example.com/agent', description: 'x', capabilities: [] });
	assert.equal((await assembleFirst(envelopes(WALLET_A, firstParts('a', 'agent', agent)))).status, 'complete');
	const insecure = agent.replace('https://', 'http://');
	assert.equal((await assembleFirst(envelopes(WALLET_A, firstParts('a2', 'agent', insecure)))).status, 'invalid');

	const image = await assembleFirst(envelopes(WALLET_A, firstParts('i', 'image', `data:image/png;base64,${PNG.toString('base64')}`, 30)));
	assert.equal(image.status, 'complete');
	assert.equal(image.presentation.kind, 'image');
	assert.equal(image.content_sha256, sha(PNG));
	assert.deepEqual(Buffer.from(image.content), PNG);
	assert.equal(image.sha256, sha(`data:image/png;base64,${PNG.toString('base64')}`));
});

test('SVG and HTML inscriptions are text, never a renderable image', async () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>';
	const html = '<!doctype html><html><body><script>alert(1)</script></body></html>';
	for (const markup of [svg, html]) {
		const asFirsts = await assembleFirsts(envelopes(WALLET_A, firstsChunks(Buffer.from(markup), { name: 'x.svg', mime: 'image/svg+xml' })));
		assert.equal(asFirsts.status, 'verified');
		assert.equal(asFirsts.presentation.kind, 'text');
		assert.equal(asFirsts.presentation.markup, true);
		assert.equal(asFirsts.presentation.mime, null);
	}
	const dataUri = await assembleFirst(envelopes(WALLET_A, firstParts('svg', 'image', `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, 40)));
	assert.equal(dataUri.status, 'complete');
	assert.equal(dataUri.presentation.kind, 'text');
	assert.equal(dataUri.presentation.markup, true);
	assert.notEqual(presentation(Buffer.from(svg), { mime: 'image/png' }).kind, 'image');
	assert.notEqual(presentation(Buffer.from(html), { mime: 'image/webp' }).kind, 'image');
});

test('a declared image MIME never makes non-image bytes an image', () => {
	assert.equal(presentation(Buffer.from('GIF-ish but not'), { mime: 'image/gif' }).kind, 'text');
	assert.equal(presentation(Buffer.from([0, 1, 2, 3, 0xff]), { mime: 'image/png' }).kind, 'binary');
	assert.equal(presentation(PNG, { mime: 'text/plain' }).kind, 'image');
});

test('spl404 rebuilds from manifest and chunk memos in manifest order and verifies sha256', async () => {
	const file = spl404(PNG);
	const manifest = classifyMemo(file.manifest);
	assert.equal(manifest.protocol, 'spl404/manifest');
	const map = new Map(file.sigs.map((sig, i) => [sig, classifyMemo(file.chunks[i])]));
	const result = await assembleSpl404(manifest, map);
	assert.equal(result.status, 'verified');
	assert.deepEqual(Buffer.from(result.bytes), PNG);
	assert.equal(result.presentation.kind, 'image');
	assert.equal(result.size, PNG.length);
});

test('spl404 names a missing chunk, a foreign chunk, and a size or hash mismatch separately', async () => {
	const file = spl404(PNG);
	const manifest = classifyMemo(file.manifest);
	const full = () => new Map(file.sigs.map((sig, i) => [sig, classifyMemo(file.chunks[i])]));

	const missing = full();
	missing.set(file.sigs[1], null);
	const m = await assembleSpl404(manifest, missing);
	assert.equal(m.status, 'incomplete');
	assert.deepEqual(m.missing, [2]);
	assert.equal(m.bytes, null);

	const foreign = full();
	foreign.set(file.sigs[0], { ...foreign.get(file.sigs[0]), fileId: 'f'.repeat(16) });
	const f = await assembleSpl404(manifest, foreign);
	assert.match(f.problems.join(' '), /different file/);

	const tampered = full();
	tampered.set(file.sigs[0], { ...tampered.get(file.sigs[0]), bytes: new Uint8Array(30) });
	const t = await assembleSpl404(manifest, tampered);
	assert.equal(t.status, 'invalid');
	assert.match(t.problems.join(' '), /does not match/);

	const wrongSize = await assembleSpl404({ ...manifest, size: manifest.size + 1 }, full());
	assert.equal(wrongSize.status, 'invalid');
	assert.match(wrongSize.problems.join(' '), /manifest says/);
});

test('classifyMemo ignores plain text, malformed envelopes and unknown protocols', () => {
	for (const memo of ['hello', '{"p":"other/1"}', '{not json', 'spl404:c:short:0:1:AAAA', `spl404:c:${'a'.repeat(16)}:5:2:AAAA`, 'data:image/png;base64,AAAA', '{"p":"spl404","v":2,"t":"file","chunks":[],"sha256":"x"}', null]) {
		assert.equal(classifyMemo(memo), null, String(memo));
	}
});

// ---- full read path through injected transport: version-1 transaction, discovery by signer ----

function memoOf(transaction) {
	const all = [...transaction.transaction.message.instructions, ...transaction.meta.innerInstructions.flatMap((group) => group.instructions)];
	return all.find((instruction) => instruction.program === 'spl-memo').parsed;
}

// getSignaturesForAddress reports a memo as "[length] text".
function chain(map) {
	return {
		getTransaction: async (signature) => map.get(signature) ?? null,
		listSignatures: async (address, { before } = {}) => {
			assert.ok(!before, 'fixture history fits one page');
			return [...map.entries()]
				.filter(([, transaction]) => transaction.transaction.message.accountKeys[0].pubkey === address)
				.map(([signature, transaction]) => ({ signature, err: null, memo: `[${memoOf(transaction).length}] ${memoOf(transaction)}` }));
		},
	};
}

test('readInscription discovers the sibling chunks of a firsts/1 artifact from one signature (v1 + inner memo)', async () => {
	const memos = firstsChunks(PNG);
	const map = new Map(memos.map((memo, i) => [`firstsSig${i}`, tx(WALLET_A, memo, { inner: i === 1 })]));
	map.set('unrelated', tx(WALLET_A, 'just a note'));
	const result = await readInscription({ signature: 'firstsSig1', ...chain(map) });
	assert.equal(result.status, 'verified');
	assert.equal(result.parts_found, memos.length);
	assert.deepEqual(new Set(result.signatures), new Set(memos.map((_, i) => `firstsSig${i}`)));
});

test('readInscription reports missing parts when only some signatures exist on chain', async () => {
	const memos = firstsChunks(PNG);
	const map = new Map(memos.map((memo, i) => [`firstsSig${i}`, tx(WALLET_A, memo)]));
	map.delete('firstsSig1');
	const result = await readInscription({ signature: 'firstsSig0', ...chain(map) });
	assert.equal(result.status, 'incomplete');
	assert.deepEqual(result.missing, [2]);
	assert.equal(result.bytes, null);
});

test('readInscription does not mix first/1 parts signed by a different wallet', async () => {
	const memos = firstParts('same-id', 'text', 'y'.repeat(36), 12);
	const map = new Map(memos.map((memo, i) => [`firstSig${i}`, tx(i === 1 ? WALLET_B : WALLET_A, memo)]));
	const result = await readInscription({ signature: 'firstSig0', ...chain(map), discover: true });
	assert.equal(result.status, 'incomplete');
	assert.deepEqual(result.missing, [2]);
});

test('readInscription follows a spl404 manifest and also finds it from a chunk signature', async () => {
	const file = spl404(PNG);
	const map = new Map(file.sigs.map((sig, i) => [sig, tx(WALLET_A, file.chunks[i])]));
	map.set('manifestSig', tx(WALLET_A, file.manifest));
	const viaManifest = await readInscription({ signature: 'manifestSig', ...chain(map) });
	assert.equal(viaManifest.status, 'verified');
	assert.deepEqual(Buffer.from(viaManifest.bytes), PNG);
	const viaChunk = await readInscription({ signature: file.sigs[1], ...chain(map) });
	assert.equal(viaChunk.status, 'verified');
	const noManifest = new Map([...map].filter(([sig]) => sig !== 'manifestSig'));
	const orphan = await readInscription({ signature: file.sigs[1], ...chain(noManifest) });
	assert.equal(orphan.status, 'incomplete');
	assert.match(orphan.problems[0], /manifest/);
});

test('readInscription says not_inscription for an ordinary memo and throws for an unknown transaction', async () => {
	const map = new Map([['plain', tx(WALLET_A, 'gm')]]);
	assert.equal((await readInscription({ signature: 'plain', ...chain(map) })).status, 'not_inscription');
	await assert.rejects(readInscription({ signature: 'nope', ...chain(map) }), (error) => error.code === 'transaction_not_found');
});

test('read_inscription output carries images as MCP media and markup as inert text, never raw byte arrays', async () => {
	const image = present(await assembleFirsts(envelopes(WALLET_A, firstsChunks(PNG))));
	assert.equal(image.kind, 'image');
	assert.equal(image.media.mimeType, 'image/png');
	assert.equal(image.metadata.sha256, sha(PNG));
	assert.equal('bytes' in image, false);
	assert.equal('content' in image, false);

	const svg = present(await assembleFirsts(envelopes(WALLET_A, firstsChunks(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { name: 'a.svg', mime: 'image/svg+xml' }))));
	assert.equal(svg.kind, 'text');
	assert.equal(svg.unsafe_markup, true);
	assert.equal('media' in svg, false);

	const incomplete = present(await assembleFirsts(envelopes(WALLET_A, firstsChunks(PNG)).slice(1)));
	assert.equal(incomplete.status, 'incomplete');
	assert.equal(incomplete.kind, null);
	assert.equal('media' in incomplete, false);
});
