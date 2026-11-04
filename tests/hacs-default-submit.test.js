import { describe, it, expect } from 'vitest';
import { buildPrBody, HEAD, REPO, UPSTREAM, WORKFLOWS } from '../scripts/hacs-default-submit.mjs';

describe('scripts/hacs-default-submit.mjs', () => {
	const links = {
		releaseUrl: `https://github.com/${REPO}/releases/tag/v1.0.2`,
		hacsRunUrl: `https://github.com/${REPO}/actions/runs/1`,
		hassfestRunUrl: `https://github.com/${REPO}/actions/runs/2`,
	};

	it('fills every hacs/default template checkbox and link with the real URLs', () => {
		const body = buildPrBody(links);
		expect(body).not.toMatch(/- \[ \]/);
		expect(body.match(/- \[x\]/g)).toHaveLength(6);
		expect(body).toContain(`Link to current release: <${links.releaseUrl}>`);
		expect(body).toContain(`Link to successful HACS action (without the \`ignore\` key): <${links.hacsRunUrl}>`);
		expect(body).toContain(`Link to successful hassfest action (if integration): <${links.hassfestRunUrl}>`);
		expect(body).not.toContain('<>');
	});

	it('targets the standalone repository, its two workflows and the prepared fork branch', () => {
		expect(REPO).toBe('nirholas/three-ws-home-assistant');
		expect(UPSTREAM).toBe('hacs/default');
		expect(HEAD).toBe('nirholas:add-three-ws-home-assistant');
		expect(WORKFLOWS).toEqual({ hacs: 'hacs.yml', hassfest: 'hassfest.yml' });
	});
});
