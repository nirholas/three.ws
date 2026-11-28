// The user's three.ws API key lives in this browser only (the extension iframe's own
// localStorage), never in the base's globalConfig, which every collaborator can read.
// Each collaborator who runs generations adds their own key, so every model has an
// owner on three.ws. When storage is blocked (some privacy settings deny it to
// iframes), the key is kept for this session only and the UI says so.

const STORAGE_KEY = 'three-ws:forge:api-key';
const KEY_SHAPE = /^sk_(live|test)_[A-Za-z0-9_-]{20,}$/;

let memoryKey = '';

function storage() {
	try {
		const s = window.localStorage;
		const probe = `${STORAGE_KEY}:probe`;
		s.setItem(probe, '1');
		s.removeItem(probe);
		return s;
	} catch {
		return null;
	}
}

export function isPersistent() {
	return storage() !== null;
}

export function readApiKey() {
	const s = storage();
	return (s && s.getItem(STORAGE_KEY)) || memoryKey || '';
}

export function saveApiKey(value) {
	const key = String(value || '').trim();
	memoryKey = key;
	const s = storage();
	if (s) s.setItem(STORAGE_KEY, key);
	return key;
}

export function clearApiKey() {
	memoryKey = '';
	const s = storage();
	if (s) s.removeItem(STORAGE_KEY);
}

/** A key that cannot be a three.ws key gets an inline hint before any request is sent. */
export function apiKeyProblem(value) {
	const key = String(value || '').trim();
	if (!key) return 'Paste your API key.';
	if (!KEY_SHAPE.test(key)) return 'three.ws API keys start with sk_live_. Copy the whole key from the API keys page.';
	return '';
}
