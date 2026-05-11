export const RESOURCES = [
	{
		uri: 'three-ws://pump/channel-feed',
		name: 'pump.fun Live Feed',
		description: 'Live pump.fun events: new mints, whale buys, social-fee claims. Free endpoint, no payment required.',
		mimeType: 'application/json',
	},
];

export const RESOURCE_TEMPLATES = [
	{
		uriTemplate: 'three-ws://pump/curve/{mint}',
		name: 'Pump.fun Bonding Curve',
		description: 'Bonding-curve snapshot for any pump.fun token — spot price, market cap, graduation progress. Free, substitute {mint} with the SPL address.',
		mimeType: 'application/json',
	},
	{
		uriTemplate: 'three-ws://pump/quote/{mint}/{side}/{amount}',
		name: 'Pump.fun Buy/Sell Quote',
		description: 'Deterministic buy or sell quote with price impact. side = buy|sell, amount in lamports. Free.',
		mimeType: 'application/json',
	},
];

export async function readResource(uri, config) {
	const remote = config?.remote ?? 'https://three.ws';

	if (uri === 'three-ws://pump/channel-feed') {
		const res = await fetch(`${remote}/api/pump/channel-feed`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`channel-feed error ${res.status}`);
		const data = await res.json();
		return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
	}

	const curveMatch = uri.match(/^three-ws:\/\/pump\/curve\/(.+)$/);
	if (curveMatch) {
		const mint = curveMatch[1];
		const res = await fetch(`${remote}/api/pump/curve?mint=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`curve error ${res.status}`);
		const data = await res.json();
		return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
	}

	const quoteMatch = uri.match(/^three-ws:\/\/pump\/quote\/([^/]+)\/([^/]+)\/([^/]+)$/);
	if (quoteMatch) {
		const [, mint, side, amount] = quoteMatch;
		const url = `${remote}/api/pump/quote-sdk?mint=${encodeURIComponent(mint)}&side=${encodeURIComponent(side)}&amount=${encodeURIComponent(amount)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`quote error ${res.status}`);
		const data = await res.json();
		return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
	}

	throw new Error(`unknown resource URI: ${uri}`);
}
