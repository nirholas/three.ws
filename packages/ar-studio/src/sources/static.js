// A source built from a list you hold in code. The simplest way to ship your own
// products into the studio:
//
//   staticSource({ label: 'Our catalogue', items: [
//     { src: 'https://cdn.acme.com/chair.glb', title: 'Aero chair', poster: '…' },
//   ] })

import { normalizeCatalogue } from './manifest.js';

/**
 * @param {object} opts
 * @param {Array<object>} opts.items  Entries in any of the shapes manifestSource accepts.
 * @param {string} [opts.id]
 * @param {string} [opts.label]
 * @param {string} [opts.hint]
 * @param {boolean} [opts.searchable]
 */
export function staticSource({ items = [], id = 'catalogue', label = 'Catalogue', hint = '', searchable } = {}) {
	const normalized = normalizeCatalogue(items);
	return {
		id,
		label,
		hint,
		searchable,
		async list() {
			return normalized;
		},
	};
}
