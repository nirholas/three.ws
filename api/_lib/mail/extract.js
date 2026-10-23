// One-time-code and magic-link extraction from a received email.
//
// Pure: no I/O, no model. The message is untrusted text, so this module only
// ever returns values it matched with a strict character class (digits and
// letters for a code, URL-safe characters for a link). Nothing a sender writes
// outside those classes can leave this function, and a link is returned as a
// string for the caller to hand to the owner or a browser tool; it is never
// fetched here.
//
// Confidence is 0 to 1 and built from visible evidence: a code next to a
// phrase like "verification code", standing alone on its line, appearing in the
// subject; a link whose path says verify or confirm, that carries a long token,
// and whose host belongs to the sender. Candidates below MIN_CONFIDENCE are
// dropped so a year, a price or a phone number is not offered as a code.

export const MIN_CONFIDENCE = 0.5;

const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

const CODE_WORDS =
	/\b(?:verification|verify|confirmation|confirm|security|authentication|login|log-in|sign-in|signin|one[- ]time|single[- ]use|access|activation|passcode|password|pin|otp|2fa|code)\b/i;
const CODE_LABEL = /\b(?:code|passcode|pin|otp|token)\b/i;

const LINK_VERB = /(?:verify|confirm|magic|login|log-in|signin|sign-in|activate|authenticate|auth|callback|validate|token|otp|reset)/i;
const LINK_REJECT = /(?:unsubscribe|optout|opt-out|preferences?|privacy|terms|policy|help|support|\.(?:png|jpe?g|gif|svg|webp|css|js)(?:\?|$)|\/track\/|\/open\b|pixel)/i;
const URL_RE = /https:\/\/[A-Za-z0-9._~:/?#@!$&'*+,;=%[\]-]+/g;

function clean(s) {
	return String(s ?? '').replace(INVISIBLE_RE, '').replace(/\r\n?/g, '\n');
}

function stripTrailing(url) {
	return url.replace(/[.,;:!?)\]'*]+$/, '');
}

/** Lowercased address and domain from a From value like `Name <a@b.com>`. */
export function parseSender(from) {
	const s = String(from ?? '');
	const m = s.match(/<([^>]+)>/);
	const address = (m ? m[1] : s).trim().toLowerCase();
	const at = address.lastIndexOf('@');
	return { address, domain: at > 0 ? address.slice(at + 1) : '' };
}

function baseDomain(host) {
	const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
	return parts.slice(-2).join('.');
}

function windowAround(text, start, end, before = 70, after = 40) {
	return text.slice(Math.max(0, start - before), start) + '\u0000' + text.slice(end, end + after);
}

function numericCandidates(text, subject) {
	const out = [];
	const re = /(?<![\w$#.@/-])(\d{3}[ -]\d{3}|\d{4,8})(?![\w%@/-]|\.\d)/g;
	for (const m of text.matchAll(re)) {
		const raw = m[1];
		const value = raw.replace(/[ -]/g, '');
		if (value.length < 4 || value.length > 8) continue;
		const start = m.index;
		const end = start + raw.length;
		const [pre, post] = windowAround(text, start, end).split('\u0000');
		const lineStart = text.lastIndexOf('\n', start - 1) + 1;
		const lineEndIdx = text.indexOf('\n', end);
		const line = text.slice(lineStart, lineEndIdx === -1 ? text.length : lineEndIdx).trim();
		const reasons = [];
		let c = 0.2;
		if (CODE_WORDS.test(pre) || CODE_WORDS.test(post.slice(0, 30))) {
			c += 0.35;
			reasons.push('near_code_phrase');
		}
		if (CODE_LABEL.test(pre.slice(-30)) || /^\s*(?:is|:|-)\s/.test(post)) c += 0.1;
		if (line === raw) {
			c += 0.25;
			reasons.push('standalone_line');
		}
		if (CODE_WORDS.test(subject)) {
			c += 0.1;
			reasons.push('subject_mentions_code');
		}
		if (value.length === 6) c += 0.1;
		else if (value.length === 4 && !reasons.includes('near_code_phrase')) c -= 0.2;
		if (/^(?:19|20)\d{2}$/.test(value)) c -= 0.3;
		if (/[$€£¥]\s*$/.test(pre) || /^\s*(?:usd|eur|gbp|%|percent|minutes?|mins?|hours?|days?|seconds?)\b/i.test(post)) c -= 0.4;
		if (/\b(?:expires?|valid|within|for|in)\s+$/i.test(pre) && /^\s*(?:minutes?|mins?|hours?|seconds?)/i.test(post)) c -= 0.4;
		if (/\b(?:call|phone|tel|fax|zip|order|invoice|ticket|reference|ref|account)\b\s*(?:#|no\.?|number)?\s*:?\s*$/i.test(pre)) c -= 0.3;
		out.push({ value, kind: 'numeric', confidence: c, reasons });
	}
	return out;
}

function alphanumericCandidates(text, subject) {
	const out = [];
	const re = /(?<![\w.@/-])([A-Z0-9]{3,5}-[A-Z0-9]{3,5}|[A-Z0-9]{5,10})(?![\w@/-])/g;
	for (const m of text.matchAll(re)) {
		const raw = m[1];
		const value = raw;
		if (!/[0-9]/.test(value) || !/[A-Z]/.test(value)) continue;
		if (/^\d+$/.test(value.replace(/-/g, ''))) continue;
		const start = m.index;
		const end = start + raw.length;
		const [pre, post] = windowAround(text, start, end).split('\u0000');
		if (!(CODE_LABEL.test(pre.slice(-45)) || CODE_WORDS.test(pre.slice(-45)))) continue;
		const reasons = ['near_code_phrase'];
		let c = 0.55;
		const lineStart = text.lastIndexOf('\n', start - 1) + 1;
		const lineEndIdx = text.indexOf('\n', end);
		const line = text.slice(lineStart, lineEndIdx === -1 ? text.length : lineEndIdx).trim();
		if (line === raw) {
			c += 0.25;
			reasons.push('standalone_line');
		}
		if (CODE_WORDS.test(subject)) c += 0.1;
		if (/^\s*(?:minutes?|mins?|hours?)/i.test(post)) c -= 0.4;
		out.push({ value, kind: 'alphanumeric', confidence: c, reasons });
	}
	return out;
}

function linkCandidates(text, subject, senderDomain) {
	const out = [];
	const sBase = baseDomain(senderDomain);
	for (const m of text.matchAll(URL_RE)) {
		const url = stripTrailing(m[0]);
		if (url.length > 2048) continue;
		let u;
		try {
			u = new URL(url);
		} catch {
			continue;
		}
		if (u.username || u.password) continue;
		const pathAndQuery = `${u.pathname}${u.search}`;
		if (LINK_REJECT.test(pathAndQuery)) continue;
		const reasons = [];
		let c = 0.2;
		if (LINK_VERB.test(u.pathname)) {
			c += 0.3;
			reasons.push('verify_path');
		}
		const longToken = [...u.searchParams.values(), ...u.pathname.split('/')].some((v) => /^[A-Za-z0-9_-]{20,}$/.test(v));
		if (longToken) {
			c += 0.25;
			reasons.push('carries_token');
		} else if (LINK_VERB.test(u.search)) c += 0.1;
		const hostMatches = Boolean(sBase) && baseDomain(u.hostname) === sBase;
		if (hostMatches) {
			c += 0.15;
			reasons.push('host_matches_sender');
		}
		if (CODE_WORDS.test(subject) || /\b(?:verify|confirm|sign in|log in|login|magic)\b/i.test(subject)) c += 0.1;
		out.push({ url: u.toString(), host: u.hostname, kind: 'magic_link', host_matches_sender: hostMatches, confidence: c, reasons });
	}
	return out;
}

function finalize(items, key) {
	const best = new Map();
	for (const it of items) {
		const c = Math.max(0, Math.min(1, Math.round(it.confidence * 100) / 100));
		if (c < MIN_CONFIDENCE) continue;
		const prev = best.get(it[key]);
		if (!prev || prev.confidence < c) best.set(it[key], { ...it, confidence: c });
	}
	return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * @param {{ from?: string, subject?: string, text?: string }} message
 * @returns {{ sender: { address: string, domain: string }, codes: object[], links: object[],
 *   best_code: object|null, best_link: object|null }}
 */
export function extractCodes({ from, subject, text } = {}) {
	const sender = parseSender(from);
	const subj = clean(subject).slice(0, 300);
	const body = clean(text).slice(0, 50000);
	const hay = `${subj}\n${body}`;
	const codes = finalize([...numericCandidates(hay, subj), ...alphanumericCandidates(hay, subj)], 'value');
	const links = finalize(linkCandidates(body, subj, sender.domain), 'url');
	return { sender, codes, links, best_code: codes[0] || null, best_link: links[0] || null };
}
