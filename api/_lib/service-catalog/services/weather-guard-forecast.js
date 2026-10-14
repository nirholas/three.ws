// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'weather-guard-forecast',
	title: 'Weather Guard: Forecast',
	category: 'live-data',
	useCase: 'three.ws Weather Guard forecast: $0.001 USDC per call returns a 24h hourly forecast (temperature, wind, precipitation chance, WMO conditions) plus active severe-weather alerts for any lat/lon, live from Open-Meteo with a US National Weather Service fallback.',
	path: '/api/x402/weather-guard-forecast',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '1000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Weather Guard',
	tags: ['weather', 'forecast', 'live-data', 'open-meteo'],
	description: 'three.ws Weather Guard forecast: live public-data endpoint, no API key anywhere in the chain. Pay $0.001 USDC (or use the free daily per-IP quota) for the next 24 hours of hourly temperature, wind speed, precipitation probability and WMO weather conditions at any latitude/longitude, sourced live from Open-Meteo. Falls over to the US National Weather Service automatically if Open-Meteo is unreachable, and always layers in active NWS severe-weather alerts for US coordinates. Real upstream calls only; a dead upstream refuses before settlement rather than serving stale or fabricated data.',
	input: { lat: 42.3601, lon: -71.0589 },
	inputSchema: {
		type: 'object',
		required: ['lat', 'lon'],
		properties: {
			lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude.' },
			lon: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude.' },
		},
	},
	outputExample: {
		source: 'open-meteo',
		lat: 42.3601,
		lon: -71.0589,
		failedOver: false,
		current: { tempC: 14.2, windKph: 11.4, weatherCode: 2, conditions: 'partly cloudy' },
		hourly: [{ time: '2026-10-14T12:00', tempC: 14.2, precipProbPct: 10, windKph: 11.4, weatherCode: 2, conditions: 'partly cloudy' }],
		alerts: [],
	},
	storefronts: ['x402scan'],
};
