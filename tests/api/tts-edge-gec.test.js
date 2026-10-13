import { describe, it, expect } from 'vitest';
import {
	generateSecMsGec,
	buildEdgeWsUrl,
	edgeWsHeaders,
	SEC_MS_GEC_VERSION,
} from '../../api/_lib/tts-edge.js';

// Reference vectors produced by rany2/edge-tts 7.3.1 (drm.generate_sec_ms_gec_v2),
// the implementation Microsoft's readaloud endpoint is currently known to accept.
const VECTORS = [
	[0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
	[1760000000, '6D50DDDB91812C33-DD68EFB01898B0750C9797D51A5FF93471DFDAE6888A1039D532CBDCCE54545D'],
	[1760000299, 'BAF4076F572BFE4E-2D6FBE5C0E24F56622EB94F37395F2D153C6C0C451DAAE2249A459BB3AFAD62C'],
	[1760000300, 'BAF4076F572BFE4E-2D6FBE5C0E24F56622EB94F37395F2D153C6C0C451DAAE2249A459BB3AFAD62C'],
	[1799999999, '8DD724B1AF1AEBDA-7EAB32704E1EBDC4C7D8109CC130E2B31826441D7C07CA6E8118FBCE8902837E'],
];

describe('Edge TTS Sec-MS-GEC v2 handshake', () => {
	it.each(VECTORS)('generates the v2 token for unix time %i', (t, expected) => {
		expect(generateSecMsGec(t)).toBe(expected);
	});

	it('rounds down to a 5 minute window', () => {
		expect(generateSecMsGec(1760000000)).toBe(generateSecMsGec(1760000099));
		expect(generateSecMsGec(1760000099)).not.toBe(generateSecMsGec(1760000100));
	});

	it('advertises the v2 GEC version matching the User-Agent Chromium major', () => {
		expect(SEC_MS_GEC_VERSION).toMatch(/^2-\d+\.\d+\.\d+\.\d+$/);
		const major = SEC_MS_GEC_VERSION.slice(2).split('.')[0];
		expect(edgeWsHeaders()['User-Agent']).toContain(`Edg/${major}.0.0.0`);
	});

	it('puts token, version and connection id on the websocket URL', () => {
		const url = new URL(buildEdgeWsUrl('abc123', 1760000000));
		expect(url.searchParams.get('Sec-MS-GEC')).toBe(VECTORS[1][1]);
		expect(url.searchParams.get('Sec-MS-GEC-Version')).toBe(SEC_MS_GEC_VERSION);
		expect(url.searchParams.get('ConnectionId')).toBe('abc123');
	});

	it('sends a muid cookie and chrome-extension origin', () => {
		const h = edgeWsHeaders();
		expect(h.Cookie).toMatch(/^muid=[0-9A-F]{32};$/);
		expect(h.Origin).toBe('chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
	});
});
