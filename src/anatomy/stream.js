// Read a spec while it is still being written.
//
// Claude streams the spec as one JSON document. Waiting for the closing brace
// would leave the stage empty for a minute, so the page scans the text so far
// and pulls out every array element that is already complete: each finished
// part appears the moment its closing brace arrives. The scanner tracks
// strings and escapes, so braces inside descriptions never confuse it.

const ARRAY_KEYS = new Set(['parts', 'effects', 'flows', 'steps']);
const STRING_KEYS = new Set(['title', 'subtitle', 'summary']);

/**
 * Scan partial JSON text. Returns
 *   { title?, subtitle?, summary?, parts: [], effects: [], flows: [], steps: [] }
 * holding every top-level string field and every array element that has fully
 * arrived. Malformed elements are skipped, never thrown.
 */
export function scanPartialSpec(source) {
	const out = { parts: [], effects: [], flows: [], steps: [] };
	const s = String(source || '');
	const start = s.indexOf('{');
	if (start === -1) return out;

	let depth = 0;
	let inString = false;
	let escaped = false;
	let stringStart = -1;
	let lastKey = null; // most recent key string read at depth 1
	let expectingValue = false; // a ':' was seen after lastKey at depth 1
	let arrayKey = null; // which top-level array we are inside (depth 2)
	let elemStart = -1; // start of the current element at depth 3

	for (let i = start; i < s.length; i++) {
		const ch = s[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') {
				inString = false;
				if (depth === 1) {
					const raw = s.slice(stringStart, i + 1);
					if (expectingValue) {
						if (STRING_KEYS.has(lastKey)) {
							try {
								out[lastKey] = JSON.parse(raw);
							} catch {
								/* incomplete escape; keep scanning */
							}
						}
						expectingValue = false;
					} else {
						try {
							lastKey = JSON.parse(raw);
						} catch {
							lastKey = null;
						}
					}
				}
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			stringStart = i;
			continue;
		}
		if (ch === ':' && depth === 1) {
			expectingValue = true;
			continue;
		}
		if (ch === ',' && depth === 1) {
			expectingValue = false;
			continue;
		}
		if (ch === '{' || ch === '[') {
			depth++;
			if (depth === 2) {
				arrayKey = ch === '[' && expectingValue && ARRAY_KEYS.has(lastKey) ? lastKey : null;
				expectingValue = false;
			} else if (depth === 3 && arrayKey && ch === '{') {
				elemStart = i;
			}
			continue;
		}
		if (ch === '}' || ch === ']') {
			if (depth === 3 && arrayKey && elemStart !== -1 && ch === '}') {
				try {
					out[arrayKey].push(JSON.parse(s.slice(elemStart, i + 1)));
				} catch {
					/* skip an element the model wrote badly */
				}
				elemStart = -1;
			}
			depth--;
			if (depth === 1) arrayKey = null;
			if (depth <= 0) break;
		}
	}
	return out;
}
