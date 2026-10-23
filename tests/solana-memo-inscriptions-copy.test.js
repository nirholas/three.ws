import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The /onchain page imports public/onchain/inscriptions.js; the MCP package ships its own
// copy. They must stay byte-identical so the browser and the MCP tool apply the same rules.
describe('memo inscription reader copies', () => {
	it('public/onchain/inscriptions.js matches the MCP package module', () => {
		const canonical = readFileSync('packages/solana-memo-media-mcp/src/lib/inscriptions.js');
		const served = readFileSync('public/onchain/inscriptions.js');
		expect(served.equals(canonical)).toBe(true);
	});

	it('the /onchain page renders only sniffed rasters as images and never injects markup', () => {
		const page = readFileSync('public/onchain/index.html', 'utf8');
		expect(page).toContain("from '/onchain/inscriptions.js'");
		expect(page).toContain("view.kind === 'image'");
		const renderer = page.slice(page.indexOf('function renderInscription'), page.indexOf('async function lookup'));
		expect(renderer).not.toMatch(/innerHTML\s*=\s*[^;]*(view|result)\.(text|content)/);
		expect(renderer).toContain('text.textContent = view.text');
		expect(renderer).not.toContain('<iframe');
		expect(renderer).not.toContain('srcdoc');
	});
});
