// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'weather-guard-decision',
	title: 'Weather Guard: Activity Decision',
	category: 'live-data',
	useCase: 'three.ws Weather Guard decision: $0.002 USDC per call turns a live forecast into a go / caution / no-go verdict for a specific outdoor activity (running, cycling, outdoor-event, drone-flight, photography), with the exact reasons behind the call.',
	path: '/api/x402/weather-guard-decision',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Weather Guard',
	tags: ['weather', 'decision', 'live-data', 'open-meteo'],
	description: 'three.ws Weather Guard decision: pay $0.002 USDC per call to turn the next 6 hours of live forecast at any lat/lon into a go / caution / no-go verdict for a named activity. Each activity (running, cycling, outdoor-event, drone-flight, photography) carries its own wind, precipitation and weather-code thresholds; the response lists every reason a threshold was crossed, the live forecast window it judged, and any active NWS severe-weather alert that forced a no-go. Same live Open-Meteo/NWS sourcing as weather-guard-forecast.',
	input: { lat: 42.3601, lon: -71.0589, activity: 'running' },
	inputSchema: {
		type: 'object',
		required: ['lat', 'lon', 'activity'],
		properties: {
			lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude.' },
			lon: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude.' },
			activity: { type: 'string', enum: ['running', 'cycling', 'outdoor-event', 'drone-flight', 'photography'] },
		},
	},
	outputExample: {
		activity: 'running',
		verdict: 'caution',
		reasons: ['wind 38 km/h exceeds 35 km/h at 2026-10-14T15:00'],
		source: 'open-meteo',
		failedOver: false,
		window: [{ time: '2026-10-14T12:00', tempC: 14.2, precipProbPct: 10, windKph: 11.4, weatherCode: 2, conditions: 'partly cloudy' }],
		alerts: [],
	},
	storefronts: ['x402scan'],
};
