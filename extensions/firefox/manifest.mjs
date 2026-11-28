// Turn a Chromium MV3 manifest into the Firefox one. Firefox runs the same code;
// only the manifest differs:
//   background.service_worker -> background.scripts (Firefox MV3 runs the
//     background as an event page, not a service worker)
//   options_page -> options_ui { open_in_tab } (same full-tab settings page)
//   minimum_chrome_version -> dropped; browser_specific_settings.gecko carries
//     the Firefox floor, the permanent add-on id and the data consent block.
import { DATA_CATEGORIES, FIREFOX_MIN_VERSION } from './targets.mjs';

// AMO accepts at most four dot-separated integers, no pre-release suffix.
const VERSION_RE = /^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){0,3}$/;
const GECKO_ID_RE = /^[a-z0-9._-]+@[a-z0-9.-]+$/i;

function checkDataCollection(dc, label) {
	const required = dc?.required;
	if (!Array.isArray(required) || required.length === 0) {
		throw new Error(`${label}: data_collection_permissions.required must list categories or ["none"]`);
	}
	if (required.includes('none') && required.length > 1) {
		throw new Error(`${label}: "none" cannot be combined with other required categories`);
	}
	for (const c of [...required.filter((c) => c !== 'none'), ...(dc.optional || [])]) {
		if (!DATA_CATEGORIES.has(c)) throw new Error(`${label}: unknown data category "${c}"`);
	}
}

/**
 * @param {object} manifest  the Chromium manifest (not mutated)
 * @param {{ id: string, dataCollection: object }} target  an entry of TARGETS
 * @param {{ version?: string, label?: string }} [opts]
 */
export function toFirefoxManifest(manifest, target, opts = {}) {
	const label = opts.label || target.id;
	if (manifest.manifest_version !== 3) throw new Error(`${label}: expected manifest_version 3`);
	if (!GECKO_ID_RE.test(target.id)) throw new Error(`${label}: invalid gecko id "${target.id}"`);
	checkDataCollection(target.dataCollection, label);

	const out = structuredClone(manifest);
	if (opts.version) out.version = opts.version;
	if (!VERSION_RE.test(out.version)) throw new Error(`${label}: version "${out.version}" is not valid for AMO`);

	if (out.background?.service_worker) {
		const { service_worker, type } = out.background;
		out.background = { scripts: [service_worker], ...(type ? { type } : {}) };
	}
	if (out.options_page) {
		out.options_ui = { page: out.options_page, open_in_tab: true };
		delete out.options_page;
	}
	delete out.minimum_chrome_version;

	const data_collection_permissions = { required: [...target.dataCollection.required] };
	if (target.dataCollection.optional?.length) {
		data_collection_permissions.optional = [...target.dataCollection.optional];
	}
	out.browser_specific_settings = {
		gecko: { id: target.id, strict_min_version: FIREFOX_MIN_VERSION, data_collection_permissions },
	};
	return out;
}
