import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildEmbedCredit } from '../api/_lib/embed.js';
import { buildAgentCredit } from '../src/share-panel-builders.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('credit builders used by the copy-paste embed surfaces', () => {
	it('agent credit links the public agent page with a plain anchor', () => {
		const html = buildAgentCredit({ origin: 'https://three.ws', agentId: 'abc' });
		expect(html.startsWith('<p ')).toBe(true);
		expect(html.endsWith('</p>')).toBe(true);
		expect(html).toContain('<a href="https://three.ws/agents/abc">three.ws</a>');
		expect(html).not.toMatch(/rel=/);
	});

	it('avatar credit names the avatar and links its public page', () => {
		const html = buildEmbedCredit({
			href: 'https://three.ws/avatars/av1',
			text: '3D avatar on',
			subject: 'Ada <b>',
		});
		expect(html).toContain('<a href="https://three.ws/avatars/av1">Ada &lt;b&gt;</a>, 3D avatar on');
		expect(html).toContain('<a href="https://three.ws/avatars/av1">three.ws</a></p>');
	});
});

// Each entry: file, then substrings that must be present in the copied-snippet
// code so the credit wiring cannot silently regress.
const surfaces = [
	['src/avatar-page.js', ['buildAgentCredit({ origin: location.origin, agentId: entityId })', '/avatars/${encodeURIComponent(avatarId)}', '></agent-3d>\n${embedCredit}', '></iframe>\n${embedCredit}']],
	['src/create-review-features.js', ["buildEmbedCredit({ href: 'https://three.ws/'", '></script>\n${credit}', '</iframe>\n${credit}']],
	['src/marketplace.js', ['buildAgentCredit({ origin: location.origin, agentId })', '></agent-3d>\\n${credit}', '></iframe>\\n${credit}']],
	['src/agent-edit.js', ['buildAgentCredit({ origin, agentId })', "$('embed-iframe-code').value"]],
	['src/agent-detail-market.js', ['buildAgentCredit({ origin: location.origin, agentId })', '></agent-3d>\\n${credit}', '></iframe>\\n${credit}']],
	['src/handle.js', ['buildEmbedCredit({', '/@${encodeURIComponent(user.username)}', '}\\n${credit}`']],
	['src/dashboard/dashboard.js', ['buildAgentCredit({ origin, agentId: agent.id })', '</iframe>\\n${credit}', 'credit,\n\t\t`<script src="${origin}/embed-sdk.js">', '</iframe>\\n` +\n\t\twidgetCredit(w, pageUrl)', 'data-widget="${esc(w.id)}"></script>\\n${widgetCredit(w, pageUrl)}', "text: '3D avatar on'", 'title="${safeName}" loading="lazy"></iframe>\\n${credit}`']],
	['src/erc8004/register-ui.js', ['buildEmbedCredit({', 'href: pageUrl', '</agent-3d>\\n` +\n\t\t\tcredit', '</iframe>\\n` +\n\t\t\tcredit']],
	['src/dashboard-next/pages/avatars.js', ['/avatars/${encodeURIComponent(a.id)}', '</iframe>\\n${buildEmbedCredit(']],
	['src/dashboard-next/pages/community-avatars.js', ['/avatars/${encodeURIComponent(a.id)}', '</iframe>\\n${buildEmbedCredit(']],
	['src/dashboard-next/pages/api.js', ['embedSelectionCredit(sel, o)', '</iframe>\\n${credit}', '</threews-avatar>`,\n\t\t\tcredit', '</script>\\n${credit}']],
];

describe('every copied embed snippet ends with a three.ws credit link', () => {
	for (const [file, needles] of surfaces) {
		it(file, () => {
			const src = read(file);
			expect(src).toMatch(/buildEmbedCredit|buildAgentCredit/);
			for (const n of needles) expect(src, n).toContain(n);
		});
	}

	it('agent-edit keeps the live preview a bare iframe', () => {
		const src = read('src/agent-edit.js');
		expect(src).toContain('$(\'embed-preview\').innerHTML = `<iframe ${iframeAttrs}></iframe>`;');
	});

	it('no surface adds rel nofollow/ugc/sponsored to a credit', () => {
		for (const [file] of surfaces) expect(read(file)).not.toMatch(/credit[^\n]*rel="(nofollow|ugc|sponsored)/i);
	});
});
