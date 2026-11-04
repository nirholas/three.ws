// Builds the SkillRegistry an <agent-3d> element installs skills through, from
// the element's trust attributes and its `skillTrust` property.
//
// Kept apart from src/element.js so the attribute parsing is unit-testable
// without a DOM: the element only needs `getAttribute(name)` and an optional
// `skillTrust` property, which is all this module reads.
//
//   skill-trust             any | owned-only | whitelist   (default owned-only)
//   skill-trusted-authors   comma-separated author addresses, matched case-insensitively
//   skill-trusted-origins   comma-separated http(s) URLs; only the origin is kept
//   el.skillTrust           { authors?: string[] | string, origins?: string[] | string }
//
// Attribute and property lists are merged. Under `whitelist` a bundle installs
// only when its manifest author or the origin serving it is listed; empty lists
// admit nothing.

import { SkillRegistry } from './index.js';

export const SKILL_TRUST_MODES = Object.freeze(['any', 'owned-only', 'whitelist']);
export const DEFAULT_SKILL_TRUST = 'owned-only';

function splitList(value) {
	if (value == null) return [];
	const items = Array.isArray(value) ? value : String(value).split(',');
	return items.map((item) => String(item ?? '').trim()).filter(Boolean);
}

// Parsed without a base URL on purpose: resolving against the page would turn a
// typo like "skills.example.com" into the page's own origin and trust it.
function strictOrigin(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
	} catch {
		return '';
	}
}

function resolveMode(raw, logger) {
	if (raw == null || String(raw).trim() === '') return DEFAULT_SKILL_TRUST;
	const mode = String(raw).trim().toLowerCase();
	if (SKILL_TRUST_MODES.includes(mode)) return mode;
	// The registry enforces only the modes it knows, so an unknown value would
	// install every skill unchecked. Fall back to the safe default instead.
	logger.warn(
		`[agent-3d] skill-trust="${raw}" is not one of ${SKILL_TRUST_MODES.join(', ')}; using ${DEFAULT_SKILL_TRUST}`,
	);
	return DEFAULT_SKILL_TRUST;
}

/**
 * Reads the element's skill trust policy.
 * @returns {{ trust: string, trustedAuthors: string[], trustedOrigins: string[] }}
 */
export function resolveSkillTrust(el, logger = console) {
	const prop = el.skillTrust && typeof el.skillTrust === 'object' ? el.skillTrust : {};
	const trust = resolveMode(el.getAttribute('skill-trust'), logger);

	const authors = new Set(
		[...splitList(el.getAttribute('skill-trusted-authors')), ...splitList(prop.authors)].map((a) =>
			a.toLowerCase(),
		),
	);

	const origins = new Set();
	for (const raw of [...splitList(el.getAttribute('skill-trusted-origins')), ...splitList(prop.origins)]) {
		const origin = strictOrigin(raw);
		if (origin) origins.add(origin);
		else logger.warn(`[agent-3d] ignoring skill trusted origin "${raw}": not an http(s) URL`);
	}

	return { trust, trustedAuthors: [...authors], trustedOrigins: [...origins] };
}

/**
 * Constructs the registry for an element.
 * @param {{ getAttribute(name: string): string | null, skillTrust?: object }} el
 * @param {{ id?: { owner?: string } }} manifest
 * @param {string[]} mainThreadOrigins origins whose bundles may run on the main thread
 * @param {{ warn: Function }} [logger]
 */
export function buildSkillRegistry(el, manifest, mainThreadOrigins, logger = console) {
	return new SkillRegistry({
		...resolveSkillTrust(el, logger),
		ownerAddress: manifest?.id?.owner,
		mainThreadOrigins: (mainThreadOrigins || []).filter(Boolean),
	});
}

/**
 * Re-reads the policy onto an existing registry after an attribute or the
 * `skillTrust` property changes. Applies to skills installed from then on;
 * skills already installed stay installed.
 */
export function applySkillTrust(registry, el, logger = console) {
	const { trust, trustedAuthors, trustedOrigins } = resolveSkillTrust(el, logger);
	registry.trust = trust;
	registry.trustedAuthors = new Set(trustedAuthors);
	registry.trustedOrigins = new Set(trustedOrigins);
	return registry;
}
