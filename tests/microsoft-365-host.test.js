// The tab's host rules (src/microsoft-365-host.js): which Microsoft 365 host a
// TeamsJS host name means, how the host theme maps onto the page, and which
// share action each host gets, only ever behind that capability's isSupported().

import { describe, it, expect, vi } from 'vitest';
import { hostFamily, hostLabel, themeAttrs, shareActionFor } from '../src/microsoft-365-host.js';

const capability = (isSupported, extra = {}) => ({ isSupported: () => isSupported, ...extra });

function fakeSdk({ sharing = false, mail = false } = {}) {
	return {
		sharing: capability(sharing, { shareWebContent: vi.fn(async () => {}) }),
		mail: capability(mail, { ComposeMailType: { New: 'new' }, composeMail: vi.fn(async () => {}) }),
	};
}

describe('hostFamily', () => {
	it('maps the TeamsJS host names onto the three hosts', () => {
		expect(hostFamily('Teams')).toBe('teams');
		expect(hostFamily('TeamsModern')).toBe('teams');
		expect(hostFamily('Outlook')).toBe('outlook');
		expect(hostFamily('OutlookWin32')).toBe('outlook');
		expect(hostFamily('Office')).toBe('m365');
		expect(hostFamily(undefined)).toBe('standalone');
		expect(hostLabel('m365')).toBe('the Microsoft 365 app');
	});
});

describe('themeAttrs', () => {
	it('follows default, dark and high contrast', () => {
		expect(themeAttrs('default')).toEqual({ theme: 'light', contrast: false });
		expect(themeAttrs('dark')).toEqual({ theme: 'dark', contrast: false });
		expect(themeAttrs('contrast')).toEqual({ theme: 'dark', contrast: true });
		expect(themeAttrs(undefined)).toEqual({ theme: 'light', contrast: false });
	});
});

describe('shareActionFor', () => {
	const link = { url: 'https://three.ws/agents/x', title: 'Forge Bot' };

	it('uses the Teams share dialog in Teams when sharing is supported', async () => {
		const sdk = fakeSdk({ sharing: true, mail: true });
		const action = shareActionFor({ family: 'teams', sdk }, {});
		expect(action.kind).toBe('teams-share');
		await action.run(link);
		expect(sdk.sharing.shareWebContent).toHaveBeenCalledWith({ content: [{ type: 'URL', url: link.url, message: link.title, preview: true }] });
	});

	it('never calls the Teams share API in Outlook, where it is not supported; composes an email instead', async () => {
		const sdk = fakeSdk({ sharing: false, mail: true });
		const action = shareActionFor({ family: 'outlook', sdk }, {});
		expect(action.kind).toBe('compose-mail');
		await action.run(link);
		expect(sdk.sharing.shareWebContent).not.toHaveBeenCalled();
		expect(sdk.mail.composeMail).toHaveBeenCalledWith({ type: 'new', subject: link.title, message: `${link.title} on three.ws: ${link.url}` });
	});

	it('falls back to the browser when the host supports neither, and treats a throwing isSupported as unsupported', () => {
		const sdk = { sharing: { isSupported: () => { throw new Error('not initialized'); } }, mail: capability(false) };
		expect(shareActionFor({ family: 'm365', sdk }, { share: () => {} }).kind).toBe('web-share');
		expect(shareActionFor({ family: 'standalone' }, { clipboard: { writeText: () => {} } }).kind).toBe('copy-link');
		expect(shareActionFor({ family: 'standalone' }, {})).toBeNull();
	});
});
