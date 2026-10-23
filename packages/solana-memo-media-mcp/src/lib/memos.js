// SPL Memo v1, SPL Memo v2, and the newer memo program that version-1 transactions carry.
export const MEMO_PROGRAM_IDS = new Set([
	'Memo1UhkJRfHyvLMcVLMbLJYfW2tfU8G8H4PqvV6v8',
	'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
	'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH',
]);

function isMemo(instruction) {
	return MEMO_PROGRAM_IDS.has(instruction?.programId) || instruction?.program === 'spl-memo';
}

// jsonParsed RPC responses carry a memo's UTF-8 text as a string in `parsed`.
export function memoPayloads(transaction) {
	const groups = [transaction?.transaction?.message?.instructions || [], ...(transaction?.meta?.innerInstructions || []).map((item) => item.instructions || [])];
	const output = [];
	for (const instructions of groups) {
		for (const instruction of instructions) {
			if (isMemo(instruction) && typeof instruction.parsed === 'string') output.push(instruction.parsed);
		}
	}
	return [...new Set(output)];
}

// getSignaturesForAddress reports memos as "[length] text; [length] text". A signature whose
// memo summary holds no data URI cannot carry memo media, so it needs no getTransaction call.
export function signatureMayCarryMedia(memoSummary) {
	return typeof memoSummary === 'string' && memoSummary.includes('data:');
}

// Multi-part inscriptions (first/1, firsts/1, spl404 manifests and chunks).
export * from './inscriptions.js';
