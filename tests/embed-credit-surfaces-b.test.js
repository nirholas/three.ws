// Every copy-paste embed snippet must end with a visible, followed link back to
// three.ws (api/_lib/embed.js buildEmbedCredit). Pure builders are asserted on
// their output; DOM-coupled sites are asserted at the source level so the
// wiring cannot silently regress.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { embedSnippets } from '../src/dextools-input.js';
import { embedSnippet } from '../src/model-lib.js';
import { _buildBundle } from '../api/x402/embody.js';

const P = '<p style="margin:8px 0 0;font-size:13px;line-height:1.4">';
const read = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('pure snippet builders end with the credit line', () => {
	it('dextools scene snippet links the 3D token view; boost snippet is untouched', () => {
		const s = embedSnippets({ mint: 'THREEsynthetic1111111111111111111111111111' });
		expect(s.sceneHtml).toContain(`</iframe>\n${P}3D token view on <a href="https://three.ws/coin3d">three.ws</a></p>`);
		expect(s.sceneHtml.endsWith('</p>')).toBe(true);
		expect(s.boostHtml.endsWith('</iframe>')).toBe(true);
	});

	it('model-lib snippet links the model page when the id is known', () => {
		const id = '0b8f3c2a-1d4e-4f6a-9b7c-2e5d8a1f0c3b';
		const html = embedSnippet('https://three.ws/cdn/x.glb', 'Barrel', id);
		expect(html).toContain(`</iframe>\n${P}<a href="https://three.ws/m/${id}">Barrel</a>, forged on <a href="https://three.ws/forge">three.ws</a></p>`);
	});

	it('model-lib snippet without an id links the viewer and escapes hostile titles', () => {
		const html = embedSnippet('https://three.ws/cdn/x.glb', '<b>"x"</b>');
		expect(html).toContain('href="https://three.ws/forge">three.ws</a></p>');
		expect(html).not.toContain('<b>"x"</b>');
		expect(embedSnippet('https://three.ws/cdn/x.glb', '')).toContain('3D model forged on <a href="https://three.ws/forge">');
	});

	it('x402 embody embed_html ends with a credit linking the viewer and the Forge', () => {
		const glb = 'https://pub-xxxx.r2.dev/personas/persona_abc.glb';
		const b = _buildBundle('https://three.ws', {
			persona: { id: 'persona_abc', glb_url: glb },
			glbUrl: glb,
			rigged: true,
			voice: 'nova',
			name: 'Nova',
		});
		expect(b.embed_html).toContain('</iframe>\n' + P);
		expect(b.embed_html).toContain(`<a href="${b.viewer_url}">Nova</a>, 3D agent made on <a href="https://three.ws/forge">three.ws</a></p>`);
		expect(b.embed_html.endsWith('</p>')).toBe(true);
	});
});

describe('DOM-coupled snippet sites build the credit with buildEmbedCredit', () => {
	const sites = [
		['src/app-next-overlay.js', "text: 'made with'"],
		['src/animations-gallery.js', "text: 'animated on'"],
		['src/pocket.js', "href: `${location.origin}/pocket`"],
		['src/dashboard-next/pages/widgets.js', "text: 'widget made with'"],
		['src/chart-companion/main.js', '/chart-companion`'],
		['src/portal/main.js', "href: 'https://three.ws/portal'"],
		['src/diorama/share.js', '/diorama`'],
		['src/editor/embed-editor.js', '/walk`'],
		['src/editor/publish.js', "text: 'widget made with'"],
		['api/users/[username]/avatar.js', '/@${user.username}'],
	];
	for (const [file, needle] of sites) {
		it(`${file} imports and calls buildEmbedCredit`, () => {
			const src = read(file);
			expect(src).toMatch(/import \{ buildEmbedCredit \} from '[./]+\/api\/_lib\/embed\.js'|from '\.\.\/\.\.\/_lib\/embed\.js'/);
			expect(src).toContain('buildEmbedCredit(');
			expect(src).toContain(needle);
		});
	}

	it('widget copy snippets (script, iframe, web component) all carry the credit', () => {
		const src = read('src/dashboard-next/pages/widgets.js');
		expect(src).toContain('<\\/script>` + credit');
		expect(src).toContain('<\\/iframe>` + credit');
		expect(src).toContain('</threews-avatar>` + credit');
	});

	it('embed editor appends the credit to chat, script and iframe variants', () => {
		const src = read('src/editor/embed-editor.js');
		expect(src).toContain("text: 'AI agent chat on'");
		expect(src).toContain('<\\/script>\\n${walkCredit}');
		expect(src).toContain("'accelerometer; gyroscope; autoplay')}\\n${walkCredit}");
	});

	it('user avatar API script and iframe snippets both end with the credit', () => {
		const src = read('api/users/[username]/avatar.js');
		expect(src).toContain('</script>\\n${credit}');
		expect(src).toContain('</iframe>\\n${credit}');
	});

	it('copied snippets add no nofollow/ugc/sponsored rel', () => {
		for (const f of ['src/dextools-input.js', 'src/model-lib.js', 'src/editor/publish.js']) {
			expect(read(f)).not.toMatch(/rel="[^"]*(nofollow|ugc|sponsored)/);
		}
	});
});
