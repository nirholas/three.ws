// Email threading and address helpers for agent mail. Pure: no I/O, so every
// rule here is covered directly by tests/agent-mail.test.js.
//
// A thread is found the way mail clients do it (RFC 5322 section 3.6.4): the
// In-Reply-To and References headers name earlier Message-IDs, and a message
// joins the thread that owns any of them. When a sender's client drops those
// headers, a normalized subject with the same counterparty inside a recent
// window is the fallback.

/** Strip angle brackets and whitespace from a Message-ID. */
export function normalizeMessageId(id) {
	const s = String(id || '').trim();
	if (!s) return null;
	const m = s.match(/<([^>]+)>/);
	return (m ? m[1] : s).trim().toLowerCase() || null;
}

/** Split a References header (or an array of ids) into normalized ids. */
export function parseReferences(value) {
	if (!value) return [];
	const raw = Array.isArray(value) ? value.join(' ') : String(value);
	const bracketed = raw.match(/<[^>]+>/g);
	const parts = bracketed || raw.split(/[\s,]+/);
	const out = [];
	for (const p of parts) {
		const id = normalizeMessageId(p);
		if (id && !out.includes(id)) out.push(id);
	}
	return out;
}

/** Subject with every leading Re:/Fwd: (and bracketed list tags) removed, lowercased. */
export function normalizeSubject(subject) {
	let s = String(subject || '').trim();
	let prev;
	do {
		prev = s;
		s = s.replace(/^(\[[^\]]{1,40}\]\s*)?(re|fwd?|fw|aw|sv|vs)\s*(\[\d+\])?\s*:\s*/i, '').trim();
	} while (s !== prev);
	return s.replace(/\s+/g, ' ').toLowerCase();
}

/** The ids a new message points back at, nearest parent first. */
export function threadCandidates({ inReplyTo, references }) {
	const ids = [];
	const parent = normalizeMessageId(inReplyTo);
	if (parent) ids.push(parent);
	for (const r of parseReferences(references).reverse()) if (!ids.includes(r)) ids.push(r);
	return ids;
}

/**
 * Headers for a reply to `parent` (a stored message row). References carries
 * the parent's chain plus the parent itself, capped so a long thread never
 * grows the header without bound.
 */
export function replyHeaders(parent) {
	if (!parent?.message_id) return {};
	const parentId = normalizeMessageId(parent.message_id);
	const chain = [...(parent.references_ids || []).map(normalizeMessageId).filter(Boolean)];
	if (!chain.includes(parentId)) chain.push(parentId);
	const capped = chain.slice(-20);
	return {
		'In-Reply-To': `<${parentId}>`,
		References: capped.map((id) => `<${id}>`).join(' '),
	};
}

/** "Re: <subject>" unless it already carries a reply prefix. */
export function replySubject(subject) {
	const s = String(subject || '').trim();
	return /^re\s*:/i.test(s) ? s : `Re: ${s || '(no subject)'}`;
}

/** Parse `"Name" <addr@host>` or a bare address into { name, address }. */
export function parseAddress(value) {
	const s = String(value || '').trim();
	const m = s.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
	const address = (m ? m[2] : s).trim().toLowerCase();
	const name = m && m[1] ? m[1].trim() : null;
	return { name: name || null, address };
}

const ADDRESS_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** True for a syntactically valid single mailbox address. */
export function isValidAddress(addr) {
	const s = String(addr || '').trim();
	return s.length <= 254 && ADDRESS_RE.test(s);
}

/**
 * A valid local part derived from an agent's name: lowercase letters, digits,
 * dots and hyphens, 3 to 32 characters, no leading, trailing or doubled dots.
 */
export function localPartFrom(name) {
	const s = String(name || '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, '-')
		.replace(/[-.]{2,}/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.slice(0, 32)
		.replace(/[-.]+$/g, '');
	return s.length >= 3 ? s : null;
}

/** True when a caller-chosen local part meets the same rules. */
export function isValidLocalPart(s) {
	return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9.-]{1,30}[a-z0-9])$/.test(s) && !/[-.]{2}/.test(s);
}
