// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'carbon-now',
	title: 'Grid Carbon: Now',
	category: 'live-data',
	useCase: 'three.ws Grid Carbon now: $0.001 USDC per call returns the current UK electricity grid carbon intensity (gCO2/kWh) and live generation mix, nationally or for one GB postcode region.',
	path: '/api/x402/carbon-now',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '1000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Grid Carbon',
	tags: ['carbon', 'energy', 'live-data', 'uk-grid'],
	description: 'three.ws Grid Carbon now: live public-data endpoint, no API key anywhere in the chain. Pay $0.001 USDC (or use the free daily per-IP quota) for the current UK national grid carbon intensity in gCO2/kWh with its forecast/actual/index reading and full generation mix, live from the National Grid ESO Carbon Intensity API. Pass a GB postcode outcode (e.g. "SW1A") to get the regional reading for that DNO region instead of the national figure.',
	input: {},
	inputSchema: {
		type: 'object',
		properties: {
			postcode: { type: 'string', description: 'GB postcode outcode, e.g. "SW1A". Omit for the national reading.' },
		},
	},
	outputExample: {
		scope: 'national',
		from: '2026-10-14T22:00Z',
		to: '2026-10-14T22:30Z',
		intensity: { forecast: 118, actual: 121, index: 'moderate' },
		generationmix: [{ fuel: 'wind', perc: 34.2 }, { fuel: 'gas', perc: 28.1 }, { fuel: 'nuclear', perc: 14.6 }],
	},
	storefronts: ['x402scan'],
};
