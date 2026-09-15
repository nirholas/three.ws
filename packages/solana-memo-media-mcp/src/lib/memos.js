const MEMO_PROGRAMS = new Set(['MemoSq4gqABAXKb96qnH8TysNcV4F6n7jKx9jABZx1s', 'Memo1UhkJRfHyvLMcVLMbLJYfW2tfU8G8H4PqvV6v8']);

function isMemo(instruction) {
	return MEMO_PROGRAMS.has(instruction?.programId) || /memo/i.test(String(instruction?.program || '')) || /memo/i.test(String(instruction?.programId || ''));
}

function textFrom(instruction) {
	if (typeof instruction?.parsed === 'string') return instruction.parsed;
	if (typeof instruction?.data === 'string' && instruction.data.startsWith('data:')) return instruction.data;
	return null;
}

export function memoPayloads(transaction) {
	const groups = [transaction?.transaction?.message?.instructions || [], ...(transaction?.meta?.innerInstructions || []).map((item) => item.instructions || [])];
	const output = [];
	for (const instructions of groups) {
		for (const instruction of instructions) {
			if (!isMemo(instruction)) continue;
			const payload = textFrom(instruction);
			if (payload) output.push(payload);
		}
	}
	return [...new Set(output)];
}
