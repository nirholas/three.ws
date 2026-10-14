// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'carbon-best-window',
	title: 'Grid Carbon: Best Window',
	category: 'live-data',
	useCase: 'three.ws Grid Carbon best window: $0.002 USDC per call scans the 48h UK grid carbon forecast and returns the lowest-carbon window to run a flexible load, plus runners-up, the worst window, and a plain-language recommendation.',
	path: '/api/x402/carbon-best-window',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Grid Carbon',
	tags: ['carbon', 'energy', 'live-data', 'uk-grid'],
	description: 'three.ws Grid Carbon best window: pay $0.002 USDC per call to scan the live 48h National Grid ESO carbon-intensity forecast for the lowest-carbon window of a given length (1 to 12 hours), nationally or for one GB postcode region. Returns the best window (mean + peak intensity), up to 3 non-overlapping runner-up windows, the worst window, and a plain-language recommendation, including a near-zero-carbon call-out and a marginal-savings warning when the forecast barely varies.',
	input: { hours: 4 },
	inputSchema: {
		type: 'object',
		properties: {
			hours: { type: 'number', minimum: 1, maximum: 12, default: 4, description: 'Length of the window to find, in hours.' },
			postcode: { type: 'string', description: 'GB postcode outcode, e.g. "SW1A". Omit for the national forecast.' },
		},
	},
	outputExample: {
		scope: 'national',
		hoursRequested: 4,
		best: { from: '2026-10-15T03:00Z', to: '2026-10-15T07:00Z', meanIntensity: 62, peakIntensity: 80 },
		worst: { from: '2026-10-14T18:00Z', to: '2026-10-14T22:00Z', meanIntensity: 210, peakIntensity: 240 },
		runnersUp: [{ from: '2026-10-15T08:00Z', to: '2026-10-15T12:00Z', meanIntensity: 75, peakIntensity: 95 }],
		recommendation: 'Best window 2026-10-15T03:00Z to 2026-10-15T07:00Z averages 62 gCO2/kWh, about 54% below the current reading.',
	},
	storefronts: ['x402scan'],
};
