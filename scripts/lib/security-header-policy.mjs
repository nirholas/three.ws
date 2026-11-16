// The minimum HTTP security header policy every three.ws response has to meet.
//
// scripts/audit-csp.mjs answers "does this origin serve exactly what
// vercel.json declares?". This answers a different question: "is what it serves
// strong enough?". A change to vercel.json that drops `preload` from HSTS, or
// adds `'unsafe-eval'` to the site-wide CSP, passes the first check (served ==
// declared) and fails this one. These are also the headers security scanners
// grade, Microsoft Defender for Cloud Apps among them
// (docs/compliance/defender-cloud-apps.md).
//
// Pure functions: no network, no filesystem. Used by
// scripts/audit-security-headers.mjs and tested in
// tests/security-header-policy.test.js.

import { frameAncestors } from '../../server/security-headers.mjs';

/** One year: the floor for HSTS preload list eligibility (hstspreload.org). */
export const HSTS_MIN_MAX_AGE = 31536000;

/** Referrer policies that never send a full URL to another origin. */
export const STRICT_REFERRER_POLICIES = new Set([
	'no-referrer',
	'same-origin',
	'strict-origin',
	'strict-origin-when-cross-origin',
]);

/** Powerful features that must never be granted to every origin. */
export const GUARDED_FEATURES = ['camera', 'microphone', 'geolocation', 'usb', 'serial', 'display-capture'];

/**
 * Paths whose CSP may keep `'unsafe-eval'`, each for a reason recorded at the
 * route in vercel.json. /scene runs user-authored scene scripts in a sandboxed
 * evaluator. Anything else gaining it is a weakening.
 */
export const UNSAFE_EVAL_PATHS = [/^\/scene\/?$/];

function parsePolicy(value) {
	const directives = new Map();
	for (const chunk of String(value).split(';')) {
		const parts = chunk.trim().split(/\s+/).filter(Boolean);
		if (parts.length) directives.set(parts[0].toLowerCase(), parts.slice(1));
	}
	return directives;
}

function checkHsts(value, problems) {
	if (!value) return problems.push('Strict-Transport-Security is missing');
	const parts = String(value)
		.split(';')
		.map((p) => p.trim().toLowerCase());
	const maxAge = Number((parts.find((p) => p.startsWith('max-age=')) || '').slice(8));
	if (!(maxAge >= HSTS_MIN_MAX_AGE)) problems.push(`Strict-Transport-Security max-age ${maxAge || 0} is under ${HSTS_MIN_MAX_AGE}`);
	if (!parts.includes('includesubdomains')) problems.push('Strict-Transport-Security lacks includeSubDomains');
	if (!parts.includes('preload')) problems.push('Strict-Transport-Security lacks preload');
}

function checkCsp(value, { path, isHtml, production }, problems) {
	if (!value) {
		if (isHtml) problems.push('Content-Security-Policy is missing on a document');
		return;
	}
	const policy = parsePolicy(value);
	const objectSrc = policy.get('object-src');
	if (!objectSrc || objectSrc.join(' ') !== "'none'") problems.push("CSP object-src is not 'none'");
	const baseUri = policy.get('base-uri');
	if (!baseUri || !baseUri.every((s) => s === "'self'" || s === "'none'")) problems.push("CSP base-uri is not 'self' or 'none'");
	if (!policy.has('frame-ancestors')) problems.push('CSP sets no frame-ancestors');
	const script = policy.get('script-src') || policy.get('default-src');
	if (!script) return;
	if (script.some((s) => s === '*' || s === 'https:' || s === 'http:' || s === 'data:'))
		problems.push('CSP script-src allows any host');
	if (script.includes("'unsafe-eval'") && !UNSAFE_EVAL_PATHS.some((re) => re.test(path)))
		problems.push("CSP script-src allows 'unsafe-eval'");
	// Production rewrites 'unsafe-inline' into per-page sha256 hashes
	// (server/csp-hashes.mjs). The dev server skips that step on purpose, so the
	// raw keyword is only a weakening where the rewrite is supposed to happen.
	if (production && isHtml && script.includes("'unsafe-inline'") && !script.some((s) => s.startsWith("'sha256-")))
		problems.push("CSP script-src ships 'unsafe-inline' without hashes");
}

function checkFrameOptions(headers, problems) {
	const sources = frameAncestors(headers['content-security-policy']);
	const xfo = headers['x-frame-options'];
	if (sources && sources.includes('*')) {
		if (xfo) problems.push(`X-Frame-Options "${xfo}" contradicts frame-ancestors * on an embeddable page`);
		return;
	}
	if (!xfo) return problems.push('X-Frame-Options is missing');
	if (!['DENY', 'SAMEORIGIN'].includes(String(xfo).trim().toUpperCase()))
		problems.push(`X-Frame-Options "${xfo}" is not DENY or SAMEORIGIN`);
}

function checkPermissionsPolicy(value, problems) {
	if (!value) return problems.push('Permissions-Policy is missing');
	for (const feature of GUARDED_FEATURES) {
		const m = String(value).match(new RegExp(`(?:^|,)\\s*${feature}=([^,]*)`));
		if (m && /\*/.test(m[1])) problems.push(`Permissions-Policy grants ${feature} to every origin`);
	}
}

/**
 * Every way one response's headers fall short of the policy.
 *
 * @param {Record<string,string>} headers response headers, keyed lowercase
 * @param {{path: string, isHtml: boolean, production: boolean}} ctx
 * @returns {string[]} human-readable problems; empty when the response passes
 */
export function evaluateSecurityHeaders(headers, ctx) {
	const problems = [];
	checkHsts(headers['strict-transport-security'], problems);
	if (String(headers['x-content-type-options'] || '').toLowerCase() !== 'nosniff')
		problems.push('X-Content-Type-Options is not nosniff');
	const referrer = String(headers['referrer-policy'] || '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
		.pop();
	if (!referrer) problems.push('Referrer-Policy is missing');
	else if (!STRICT_REFERRER_POLICIES.has(referrer)) problems.push(`Referrer-Policy "${referrer}" can leak full URLs`);
	checkPermissionsPolicy(headers['permissions-policy'], problems);
	// OWASP: the legacy XSS auditor is gone from current browsers and could be
	// abused in the ones that had it, so the only safe value is 0 (disabled).
	if (String(headers['x-xss-protection'] ?? '').trim() !== '0') problems.push('X-XSS-Protection is not 0');
	checkCsp(headers['content-security-policy'], ctx, problems);
	checkFrameOptions(headers, problems);
	return problems;
}
