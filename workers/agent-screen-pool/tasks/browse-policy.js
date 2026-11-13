// browse-policy.js: the rules an autonomous browsing run must satisfy before
// any model-chosen action touches the page. Pure and dependency-light so the
// loop, the API and the tests share one definition.
//
//   - closed action schema: click, type, scroll, goto, extract, done
//   - navigation: http(s) only, public hosts only (isNavAllowed refuses
//     file:, loopback, private and metadata addresses), and inside the run's
//     domain allowlist
//   - financial pages are never entered (host and path heuristics)
//   - credential fields are never typed into: the pool has no vault, so an
//     action that targets a password, one-time code or card field is refused
//   - step, wall-clock and token budgets are hard caps

import { isNavAllowed } from '../egress-guard.js';

export const ACTION_NAMES = ['click', 'type', 'scroll', 'goto', 'extract', 'done'];

export const LIMITS = {
	defaultSteps: 12, maxSteps: 30,
	defaultMs: 180_000, maxMs: 600_000,
	defaultTokens: 20_000, maxTokens: 60_000,
	maxDomains: 20, maxTextLen: 500,
};

const FINANCIAL_HOST = /(^|[.-])(bank|banking|pay|payment|payments|paypal|checkout|billing|wallet|invoice|brokerage|venmo|stripe|wise|revolut|chase|wellsfargo|bankofamerica)([.-]|$)/;
const FINANCIAL_PATH = /\/(checkout|payment|payments|billing|cart|wallet|transfer|withdraw|deposit|pay)(\/|$|\?)/i;
const CREDENTIAL_FIELD = /pass(word|code|phrase)?|otp|one[- ]time|cvv|cvc|card[- ]?(number|no)|credit|ssn|social security|secret|seed phrase|private key|2fa|verification code|pin\b/i;

export function clampInt(value, def, max, min = 1) {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return def;
	return Math.min(max, Math.max(min, n));
}

export function normalizeDomains(list) {
	const out = [];
	for (const raw of Array.isArray(list) ? list : []) {
		let h = String(raw || '').trim().toLowerCase();
		if (!h) continue;
		try { h = new URL(/^[a-z]+:\/\//.test(h) ? h : `https://${h}`).hostname; } catch { continue; }
		h = h.replace(/^www\./, '').replace(/\.$/, '');
		if (h && !out.includes(h)) out.push(h);
		if (out.length >= LIMITS.maxDomains) break;
	}
	return out;
}

export function hostInAllowlist(hostname, allowed) {
	const h = String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
	return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}

export function isFinancialUrl(rawUrl) {
	let u;
	try { u = new URL(String(rawUrl)); } catch { return false; }
	return FINANCIAL_HOST.test(u.hostname.toLowerCase()) || FINANCIAL_PATH.test(u.pathname);
}

export function isCredentialField(el) {
	if (!el) return false;
	if (String(el.type || '').toLowerCase() === 'password') return true;
	return CREDENTIAL_FIELD.test(`${el.name || ''} ${el.field || ''} ${el.autocomplete || ''} ${el.placeholder || ''}`);
}

// Parse a model reply into one validated action, or null. The model may wrap
// the object in prose; take the first balanced JSON object.
export function parseAction(text) {
	const s = String(text || '');
	const start = s.indexOf('{');
	if (start < 0) return null;
	let depth = 0, inStr = false, esc = false;
	for (let i = start; i < s.length; i++) {
		const c = s[i];
		if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
		if (c === '"') inStr = true;
		else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) {
			try { return validateShape(JSON.parse(s.slice(start, i + 1))); } catch { return null; }
		}
	}
	return null;
}

// Notes show in the owner's step strip, so a long one ends on a whole word.
function clipNote(text, max = 160) {
	const t = text.trim();
	if (t.length <= max) return t;
	const cut = t.slice(0, max - 1);
	const space = cut.lastIndexOf(' ');
	return `${space > max / 2 ? cut.slice(0, space) : cut}\u2026`;
}

function validateShape(o) {
	if (!o || typeof o !== 'object' || !ACTION_NAMES.includes(o.action)) return null;
	const note = typeof o.note === 'string' ? clipNote(o.note) : '';
	const id = Number.isInteger(o.id) && o.id >= 0 && o.id < 1000 ? o.id : null;
	switch (o.action) {
		case 'click': return id === null ? null : { action: 'click', id, note };
		case 'type': {
			if (id === null || typeof o.text !== 'string') return null;
			return { action: 'type', id, text: o.text.slice(0, LIMITS.maxTextLen), submit: o.submit === true, note };
		}
		case 'scroll': return { action: 'scroll', direction: o.direction === 'up' ? 'up' : 'down', note };
		case 'goto': return typeof o.url === 'string' ? { action: 'goto', url: o.url.slice(0, 2048), note } : null;
		case 'extract': return { action: 'extract', id, note };
		case 'done': return { action: 'done', result: String(o.result ?? '').slice(0, 2000), note };
		default: return null;
	}
}

export function createBrowsePolicy({ allowedDomains, maxSteps, maxMs, maxTokens } = {}) {
	const domains = normalizeDomains(allowedDomains);
	const policy = {
		allowedDomains: domains,
		maxSteps: clampInt(maxSteps, LIMITS.defaultSteps, LIMITS.maxSteps),
		maxMs: clampInt(maxMs, LIMITS.defaultMs, LIMITS.maxMs),
		maxTokens: clampInt(maxTokens, LIMITS.defaultTokens, LIMITS.maxTokens),

		// { ok: true } or { ok: false, reason }. `elements` maps id to the
		// descriptor from the latest observation.
		checkUrl(rawUrl) {
			if (!isNavAllowed(rawUrl)) return { ok: false, reason: 'url_not_public_http' };
			const u = new URL(rawUrl);
			if (!domains.length) return { ok: false, reason: 'no_allowed_domains' };
			if (!hostInAllowlist(u.hostname, domains)) return { ok: false, reason: 'domain_not_allowed' };
			if (isFinancialUrl(rawUrl)) return { ok: false, reason: 'financial_page' };
			return { ok: true };
		},
		checkAction(action, { elements = new Map() } = {}) {
			if (!action || !ACTION_NAMES.includes(action.action)) return { ok: false, reason: 'unknown_action' };
			if (action.action === 'goto') return policy.checkUrl(action.url);
			if (action.action === 'type') {
				const el = elements.get(action.id);
				if (!el) return { ok: false, reason: 'unknown_element' };
				if (isCredentialField(el)) return { ok: false, reason: 'credential_entry_needs_vault' };
			}
			if (action.action === 'click' && !elements.get(action.id)) return { ok: false, reason: 'unknown_element' };
			return { ok: true };
		},
	};
	return policy;
}
