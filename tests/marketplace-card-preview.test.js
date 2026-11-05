// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { agentCardPreviewHtml } from '../src/shared/marketplace-card-preview.js';

// Agent card GLBs only load on hover (attendRotation), and the grid's
// model-viewer is opacity:0 until it has loaded. Any picture the card shows
// before that therefore has to be a visible element of its own, never a
// model-viewer `poster` (which is hidden along with the viewer).
const THUMB = 'https://three.ws/cdn/thumb/2faa666b-456e-431d-b7b9-ac9e344a9c1c.webp';
const GLB = 'https://three.ws/cdn/forge/9b86c6f92389/3c37961e-d733-42b6-9ca4-f0b0d574ed90.glb';

describe('agentCardPreviewHtml', () => {
	it('paints the stored thumbnail as a visible <img> when the agent also has a GLB', () => {
		const html = agentCardPreviewHtml({ name: 'Risk Auditor 9', thumbnail_url: THUMB, avatar_glb_url: GLB });
		const beforeViewer = html.slice(0, html.indexOf('<model-viewer'));
		expect(beforeViewer).toMatch(/<img [^>]*src="\/api\/img\?url=[^"]*2faa666b/);
		expect(beforeViewer).not.toContain('mv-placeholder');
		expect(html).toContain(`data-src="${GLB}"`);
	});

	it('keeps the GLB lazy (data-src only) so no model downloads before attention', () => {
		const html = agentCardPreviewHtml({ name: 'A', thumbnail_url: THUMB, avatar_glb_url: GLB });
		expect(html).not.toMatch(/\ssrc="[^"]*\.glb"/);
	});

	it('falls back to the name placeholder behind the viewer when there is no thumbnail', () => {
		const html = agentCardPreviewHtml({ name: 'yield', avatar_glb_url: GLB });
		expect(html).toContain('mv-placeholder-initial">Y<');
		expect(html).not.toContain('<img');
	});

	it('renders a thumbnail-only agent as an <img> with the broken-image fallback', () => {
		const html = agentCardPreviewHtml({ name: 'A', thumbnail_url: THUMB });
		expect(html).toMatch(/<img [^>]*data-fallback="element"/);
		expect(html).not.toContain('<model-viewer');
	});

	it('renders the placeholder alone when the agent has neither', () => {
		const html = agentCardPreviewHtml({ name: 'zed' });
		expect(html).toContain('mv-placeholder-initial">Z<');
	});
});
