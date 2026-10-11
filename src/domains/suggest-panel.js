// Domain suggestions for a project name: the cheapest available names across
// popular TLDs, each linking into /domains to register. Mounted on coin pages.

import { domainsApi, esc, fmtUsd } from './api.js';

export async function mountDomainSuggestions(el, name) {
	const label = String(name || '').trim();
	if (!el || !label) return;
	el.innerHTML = `<h2 class="dm-sug-title">Domains for ${esc(label)}</h2><p class="dm-sug-note" aria-live="polite">Checking availability…</p>`;
	try {
		const out = await domainsApi.suggest(label);
		const picks = out.results || [];
		if (!picks.length) {
			el.innerHTML = `<h2 class="dm-sug-title">Domains for ${esc(label)}</h2><p class="dm-sug-note">No available names found for this project. <a href="/domains?q=${encodeURIComponent(label)}">Search other names</a>.</p>`;
			return;
		}
		el.innerHTML = `<h2 class="dm-sug-title">Domains for ${esc(label)}</h2>
			<ul class="dm-sug-list">${picks
				.map(
					(r) => `<li><a class="dm-sug-chip" href="/domains?domain=${encodeURIComponent(r.domain)}"><span>${esc(r.domain)}</span><b>${fmtUsd(r.registrationUsd)}/yr</b></a></li>`,
				)
				.join('')}</ul>
			<p class="dm-sug-note">Live registrar availability. <a href="/domains?q=${encodeURIComponent(label)}">See all results</a>.</p>`;
	} catch (e) {
		el.innerHTML = `<h2 class="dm-sug-title">Domains for ${esc(label)}</h2><p class="dm-sug-note">${esc(e.message)} <a href="/domains?q=${encodeURIComponent(label)}">Try the domain search</a>.</p>`;
	}
}
