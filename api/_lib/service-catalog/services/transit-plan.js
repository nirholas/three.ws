// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'transit-plan',
	title: 'Transit Trip Plan',
	category: 'live-data',
	useCase: 'three.ws Transit Trip Plan: $0.002 USDC per call returns direct and one-transfer itineraries between two MBTA stops, with realtime predictions overlaid where the feed has them.',
	path: '/api/x402/transit-plan',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Transit',
	tags: ['transit', 'live-data', 'gtfs', 'mbta', 'mobility'],
	description: 'three.ws Transit Trip Plan: live public-data endpoint, no API key anywhere in the chain. Pay $0.002 USDC (or use the free daily per-IP quota) to plan a trip between two stops on the MBTA\'s public GTFS feed. Each place accepts a feed stop id, a station name, or a "lat,lon" pair. Returns direct and one-transfer itineraries from the static schedule, with realtime arrival/departure predictions overlaid where the GTFS-Realtime feed has them. No fixture mode: an upstream outage is a 502, never an invented departure time.',
	input: { from: 'South Station', to: 'Alewife', max: 3 },
	inputSchema: {
		type: 'object',
		required: ['from', 'to'],
		properties: {
			from: { type: 'string', description: 'Origin: stop id, station name, or "lat,lon".' },
			to: { type: 'string', description: 'Destination: stop id, station name, or "lat,lon".' },
			departAfter: { type: 'string', description: 'ISO 8601 timestamp. Defaults to now.' },
			max: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'Max itineraries to return.' },
		},
	},
	outputExample: {
		source: 'gtfs-live',
		agency: 'MBTA (Massachusetts Bay Transportation Authority)',
		itineraries: [
			{
				kind: 'direct',
				departure: '2026-10-14T18:05:00-04:00',
				arrival: '2026-10-14T18:42:00-04:00',
				durationMinutes: 37,
				transfers: 0,
				legs: [{ routeId: 'Red', routeName: 'Red Line', routeType: 'subway', headsign: 'Alewife', tripId: 'example' }],
			},
		],
		note: '1 route(s) serve both stops directly.',
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
