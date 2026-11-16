/**
 * Pure data shaping for /enterprise (src/enterprise.js) and the /pricing
 * company row. No DOM, no fetch: unit-tested in tests/enterprise.test.js.
 *
 * Two jobs: validate data/enterprise.json, and refuse any wording that claims a
 * certification, co-sell status or Microsoft partner tier three.ws does not
 * hold. The approved Microsoft wording is "three.ws and Microsoft have announced
 * a partnership" and "three.ws is live on Microsoft Marketplace" (docs/microsoft.md).
 */

/** What a buyer wants help with. Keys are what the /enterprise form posts. */
export const INTERESTS = Object.freeze({
	marketplace: 'Buy through Microsoft Marketplace',
	invoice: 'Invoice or purchase order',
	security: 'Security review or vendor questionnaire',
	dpa: 'Data processing agreement',
	identity: 'Single sign-on and SCIM provisioning',
	deployment: 'Deploying in Microsoft 365, Teams or Power Platform',
	other: 'Something else',
});

/** Team sizes the form offers. */
export const TEAM_SIZES = Object.freeze(['1-10', '11-50', '51-250', '251-1000', '1000+']);

/** Statuses an identity feature may carry. "live" is only ever set by the live probe. */
export const IDENTITY_STATUSES = Object.freeze(['built, not switched on', 'available on request']);

/** Statuses the compliance attestation may carry until Microsoft says otherwise. */
export const ATTESTATION_STATUSES = Object.freeze(['in preparation', 'submitted']);

/**
 * Phrases that would claim a status three.ws does not hold. Applied to every
 * string in data/enterprise.json and to the status of every surface the page
 * renders from data/microsoft-surfaces.json.
 */
export const FORBIDDEN_CLAIMS = Object.freeze([
	{ re: /\bcertified\b/i, why: 'claims a certification' },
	{ re: /\bcertification (?:achieved|granted|complete|completed|received)\b/i, why: 'claims a certification' },
	{ re: /\bco-?sell/i, why: 'claims a co-sell status' },
	{ re: /\b(?:solutions|gold|silver|preferred|premier|managed|elite)\s+partner\b/i, why: 'claims a partner tier' },
	{ re: /\bpartner\s+(?:tier|level|designation|specialization|specialisation)\b/i, why: 'claims a partner tier' },
	{ re: /\bendorse(?:d|s|ment)?\b/i, why: 'implies an endorsement' },
	{ re: /\b(?:approved|verified|audited) by microsoft\b/i, why: 'implies Microsoft approval' },
	{ re: /\b(?:soc ?2|iso ?27001)\s+(?:type (?:i{1,2}|[12])\s+)?(?:compliant|attested|audited|report available)\b/i, why: 'claims a compliance report' },
	{ re: /\bip co-?sell|\bazure ip\b/i, why: 'claims a co-sell programme' },
]);

/** Every string inside a JSON value, with a readable path. */
export function collectStrings(value, path = '') {
	if (typeof value === 'string') return [{ path: path || '(root)', text: value }];
	if (Array.isArray(value)) return value.flatMap((v, i) => collectStrings(v, `${path}[${i}]`));
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([k, v]) => (k.startsWith('$') ? [] : collectStrings(v, path ? `${path}.${k}` : k)));
	}
	return [];
}

/** Forbidden phrases in a list of { path, text }, as { path, text, why }. */
export function findForbiddenClaims(strings) {
	const hits = [];
	for (const { path, text } of strings) {
		for (const { re, why } of FORBIDDEN_CLAIMS) {
			if (re.test(text)) hits.push({ path, text, why });
		}
	}
	return hits;
}

/**
 * Every claim the page would render: all of data/enterprise.json plus the
 * status, today and built text of each surface it shows.
 */
export function renderedClaims(enterprise, surfaceData) {
	const shown = new Set(enterprise?.surfaces || []);
	const surfaceStrings = (surfaceData?.surfaces || [])
		.filter((s) => shown.has(s.id))
		.flatMap((s) => ['status', 'today', 'built'].map((k) => ({ path: `microsoft-surfaces.${s.id}.${k}`, text: String(s[k] || '') })));
	return [...collectStrings(enterprise), ...surfaceStrings];
}

function isLink(v) {
	if (typeof v !== 'string' || !v) return false;
	if (v.startsWith('/') || v.startsWith('#')) return true;
	try {
		return new URL(v).protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Problems with data/enterprise.json, as readable strings. Empty means safe to
 * render: known statuses, real links, every surface id resolvable, no
 * forbidden claim anywhere on the page.
 */
export function validateEnterprise(data, surfaceData) {
	const errors = [];
	if (!data || typeof data !== 'object') return ['enterprise data must be an object'];
	const mp = data.marketplace || {};
	if (!isLink(mp.publisher_profile_url) || !mp.publisher_profile_url.startsWith('https://')) errors.push('marketplace.publisher_profile_url must be an https URL');
	if (mp.offer_url && !String(mp.offer_url).startsWith('https://')) errors.push('marketplace.offer_url must be empty or an https URL');
	if (!ATTESTATION_STATUSES.includes(data.attestation?.status)) {
		errors.push(`attestation.status "${data.attestation?.status}" is not one of ${ATTESTATION_STATUSES.join(' | ')}`);
	}
	for (const key of ['sales', 'security', 'privacy']) {
		if (!/^[^\s@]+@three\.ws$/.test(String(data.contacts?.[key] || ''))) errors.push(`contacts.${key} must be a three.ws address`);
	}
	const ids = new Set();
	for (const [i, item] of (data.identity || []).entries()) {
		const at = `identity[${i}]${item?.id ? ` (${item.id})` : ''}`;
		if (!item?.id || ids.has(item.id)) errors.push(`${at}: id missing or duplicate`);
		ids.add(item?.id);
		if (!IDENTITY_STATUSES.includes(item?.status)) errors.push(`${at}: status "${item?.status}" is not one of ${IDENTITY_STATUSES.join(' | ')}`);
		if (item?.probe !== undefined && item.probe !== 'sso') errors.push(`${at}: unknown probe "${item.probe}"`);
		if (!isLink(item?.link?.url)) errors.push(`${at}: link.url must be a path or https URL`);
	}
	for (const [i, b] of (data.buy || []).entries()) {
		if (!b?.name || !b?.summary) errors.push(`buy[${i}]: name and summary are required`);
		if (!b?.probe && !isLink(b?.action?.url)) errors.push(`buy[${i}]: needs a probe or an action link`);
	}
	const known = new Set((surfaceData?.surfaces || []).map((s) => s.id));
	for (const id of data.surfaces || []) if (!known.has(id)) errors.push(`surfaces: "${id}" is not in data/microsoft-surfaces.json`);
	for (const group of ['security', 'support']) {
		for (const [i, row] of (data[group] || []).entries()) {
			if (!row?.label || !row?.value) errors.push(`${group}[${i}]: label and value are required`);
			if (row?.link !== undefined && !isLink(row.link)) errors.push(`${group}[${i}]: link must be a path or https URL`);
		}
	}
	for (const hit of findForbiddenClaims(renderedClaims(data, surfaceData))) {
		errors.push(`${hit.path}: "${hit.text}" ${hit.why}`);
	}
	return errors;
}

/**
 * The status an identity feature shows. Features behind the Microsoft sign-in
 * app turn live only when the production probe reports it switched on.
 * @param {{ status: string, probe?: string }} item
 * @param {{ sso?: boolean } | null} probe  /api/microsoft-marketplace/status, or null when unread
 */
export function identityStatus(item, probe) {
	if (item?.probe === 'sso' && probe?.sso === true) return { label: 'live', tone: 'ok' };
	if (item?.status === 'available on request') return { label: item.status, tone: 'neutral' };
	return { label: item?.status || 'unknown', tone: 'pending' };
}

/** Where a company buys through Microsoft: the offer once published, the publisher profile before. */
export function marketplaceTarget(data) {
	const offer = String(data?.marketplace?.offer_url || '').trim();
	if (offer) return { url: offer, label: 'Buy on Microsoft Marketplace', kind: 'offer' };
	return { url: data?.marketplace?.publisher_profile_url, label: 'View the Marketplace listing', kind: 'profile' };
}

/** The live purchase line under the Marketplace buy path. */
export function marketplacePurchaseLine(probe) {
	if (!probe || typeof probe.ready !== 'boolean') return { tone: 'unknown', text: 'In-Marketplace purchase status could not be read right now.' };
	if (probe.ready) return { tone: 'ok', text: 'In-Marketplace purchase is switched on: subscribe with your Microsoft account.' };
	return { tone: 'pending', text: 'In-Marketplace purchase is built and switches on when the SaaS offer is published. Until then, buy by invoice.' };
}

/**
 * The /pricing "Buying for a company?" row: the offer when its URL is
 * configured, the enterprise page otherwise.
 */
export function pricingCompanyLink(data) {
	const offer = String(data?.marketplace?.offer_url || '').trim();
	if (offer) return { href: offer, label: 'Purchase through Microsoft Marketplace', external: true };
	return { href: '/enterprise', label: 'Purchase through Microsoft Marketplace', external: false };
}

/** The publisher line for the packet; never invents an entity name. */
export function publisherLine(data) {
	const p = data?.publisher || {};
	if (p.legal_entity) return `${p.legal_entity} (trading as ${p.name})`;
	return `${p.name}. Registered entity name and country are provided with the order form.`;
}
