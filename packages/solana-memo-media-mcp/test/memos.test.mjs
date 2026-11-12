import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMO_PROGRAM_IDS, memoPayloads, memoTexts, signatureMayCarryMedia } from '../src/lib/memos.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwV8YQAAAABJRU5ErkJggg==';

// Shape of a jsonParsed getTransaction result for a version-1 transaction on mainnet.
function transaction(instructions, inner = []) {
	return { version: 1, slot: 1, blockTime: 1, transaction: { message: { accountKeys: [], instructions } }, meta: { innerInstructions: inner } };
}

test('reads memos from every SPL Memo program, top level and inner', () => {
	const [v1, v2, next] = [...MEMO_PROGRAM_IDS];
	const tx = transaction(
		[{ program: 'spl-memo', programId: next, parsed: PNG, stackHeight: 1 }, { programId: v1, parsed: 'hello' }],
		[{ index: 0, instructions: [{ programId: v2, parsed: 'inner note' }] }],
	);
	assert.deepEqual(memoPayloads(tx), [PNG, 'hello', 'inner note']);
});

test('ignores programs that merely look like a memo program', () => {
	const tx = transaction([
		{ programId: 'MemoSq4gqABAXKb96qnH8TysNcV4F6n7jKx9jABZx1s', parsed: PNG },
		{ program: 'system', programId: '11111111111111111111111111111111', parsed: { type: 'transfer' } },
		{ programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', data: '3Bxs4h24hBtQy9rw' },
	]);
	assert.deepEqual(memoPayloads(tx), []);
});

test('deduplicates a payload repeated across instructions', () => {
	const id = [...MEMO_PROGRAM_IDS][1];
	assert.deepEqual(memoPayloads(transaction([{ programId: id, parsed: PNG }, { programId: id, parsed: PNG }])), [PNG]);
});

test('address scans only fetch signatures whose memo summary holds a data URI', () => {
	assert.equal(signatureMayCarryMedia('[3826] data:image/png;base64,iVBOR'), true);
	assert.equal(signatureMayCarryMedia('[11] JPP #379584'), false);
	assert.equal(signatureMayCarryMedia(null), false);
	assert.equal(signatureMayCarryMedia(undefined), false);
});

// The real SPL Memo v1 program, as executable on mainnet (BPFLoader1111...).
const SPL_MEMO_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Length(text) {
	let value = 0n;
	for (const char of text) {
		const digit = BASE58.indexOf(char);
		if (digit < 0) return -1;
		value = value * 58n + BigInt(digit);
	}
	let bytes = 0;
	for (; value > 0n; value >>= 8n) bytes++;
	for (const char of text) {
		if (char !== '1') break;
		bytes++;
	}
	return bytes;
}

test('every recognized memo program id is a real 32-byte public key, SPL Memo v1 included', () => {
	assert.ok(MEMO_PROGRAM_IDS.has(SPL_MEMO_V1));
	for (const id of MEMO_PROGRAM_IDS) assert.equal(base58Length(id), 32, `${id} is not a 32-byte key`);
});

test('a v1 memo identified only by its program id is read by both memo readers', () => {
	const tx = transaction([{ programId: SPL_MEMO_V1, parsed: 'v1 note' }]);
	assert.deepEqual(memoPayloads(tx), ['v1 note']);
	assert.deepEqual(memoTexts(tx), ['v1 note']);
});
