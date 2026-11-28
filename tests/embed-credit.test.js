// Every copy-paste embed snippet three.ws hands out ends in a visible credit
// line with a plain, followed <a href> back to three.ws. An <iframe> or a
// custom element gives the host page no link of its own, so this line is the
// only thing that tells search engines (and readers) where an embed came from.
// See docs/ops/backlinks.md for why this matters for Ahrefs DR4.

import { describe, it, expect } from 'vitest';
import { buildEmbedCredit } from '../api/_lib/embed.js';
import {
	buildIframeSnippet as forgeIframe,
	buildWebComponentSnippet as forgeModelViewer,
	buildAgentThreeDSnippet as forgeAgent3d,
} from '../src/forge-embed-snippets.js';
import {
	buildIframeSnippet as studioIframe,
	buildWebComponentSnippet as studioModelViewer,
} from '../src/forge-studio/forge-embed-snippets.js';
import {
	buildIframeSnippet as agentIframe,
	buildWebComponentSnippet as agentComponent,
} from '../src/share-panel-builders.js';

const GLB = 'https://cdn.test/robot.glb';
const ID = '9fc7f1ba-2f34-4d79-843b-9b34c27e0d72';

// The last element of the snippet must be the credit paragraph, and its links
// must be followed (no rel=nofollow/ugc/sponsored) so they count as links.
function creditOf(snippet) {
	const m = snippet.match(/<p [^>]*>(.*)<\/p>\s*$/s);
	expect(m, `snippet has no trailing credit line:\n${snippet}`).toBeTruthy();
	expect(m[0]).not.toMatch(/rel=/);
	return m[1];
}

describe('buildEmbedCredit', () => {
	it('renders a brand link after the lead text when there is no subject', () => {
		const html = buildEmbedCredit({ href: 'https://three.ws/forge', text: '3D model forged on' });
		expect(html).toBe(
			'<p style="margin:8px 0 0;font-size:13px;line-height:1.4">3D model forged on <a href="https://three.ws/forge">three.ws</a></p>',
		);
	});

	it('links the subject by name to its own page, then credits three.ws', () => {
		const html = buildEmbedCredit({
			href: 'https://three.ws/forge',
			text: 'forged on',
			subject: 'Red dragon',
			subjectHref: 'https://three.ws/forge/embed?src=x',
		});
		expect(creditOf(html)).toBe(
			'<a href="https://three.ws/forge/embed?src=x">Red dragon</a>, forged on <a href="https://three.ws/forge">three.ws</a>',
		);
	});

	it('escapes a hostile subject and href so a pasted snippet cannot inject markup', () => {
		const html = buildEmbedCredit({
			href: 'https://three.ws/"><script>',
			text: 'on',
			subject: '<img src=x onerror=alert(1)>',
		});
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).toContain('href="https://three.ws/&quot;&gt;&lt;script&gt;"');
	});

	it('treats a blank subject as no subject', () => {
		const html = buildEmbedCredit({ href: 'https://three.ws/', text: 'Made with', subject: '   ' });
		expect(creditOf(html)).toBe('Made with <a href="https://three.ws/">three.ws</a>');
	});
});

describe('Forge model snippets carry the credit line', () => {
	for (const [name, build] of [
		['iframe', forgeIframe],
		['model-viewer', forgeModelViewer],
		['agent-3d', forgeAgent3d],
		['studio iframe', studioIframe],
		['studio model-viewer', studioModelViewer],
	]) {
		it(`${name}: names the model, links its viewer page and credits the Forge`, () => {
			const credit = creditOf(build(GLB, 'A friendly robot', 'wide'));
			expect(credit).toContain('>A friendly robot</a>, forged on <a href="https://three.ws/forge">three.ws</a>');
			expect(credit).toContain('href="https://three.ws/forge/embed?');
		});

		it(`${name}: falls back to a generic lead when the model has no title`, () => {
			const credit = creditOf(build(GLB, '', 'wide'));
			expect(credit).toBe('3D model forged on <a href="https://three.ws/forge">three.ws</a>');
		});
	}
});

describe('agent share-panel snippets carry the credit line', () => {
	for (const [name, build] of [
		['iframe', agentIframe],
		['agent-3d', agentComponent],
	]) {
		it(`${name}: links the agent's public page`, () => {
			const credit = creditOf(build({ origin: 'https://three.ws', agentId: ID }));
			expect(credit).toBe(`3D AI agent on <a href="https://three.ws/agents/${ID}">three.ws</a>`);
		});

		it(`${name}: does not double the slash when the origin ends in one`, () => {
			const credit = creditOf(build({ origin: 'https://three.ws/', agentId: ID }));
			expect(credit).toContain(`href="https://three.ws/agents/${ID}"`);
		});
	}
});
