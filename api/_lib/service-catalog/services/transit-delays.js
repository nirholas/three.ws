// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'transit-delays',
	title: 'Transit Delay Snapshot',
	category: 'live-data',
	useCase: 'three.ws Transit Delay Snapshot: $0.001 USDC per call measures live MBTA arrivals against the schedule at a stop, with a running-well/minor-delays/significant-delays verdict.',
	path: '/api/x402/transit-delays',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '1000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Transit',
	tags: ['transit', 'live-data', 'gtfs-rt', 'mbta', 'mobility'],
	description: 'three.ws Transit Delay Snapshot: pay $0.001 USDC per call to see how the MBTA\'s realtime feed compares to the scheduled timetable right now at a stop, optionally filtered to one route. delaySeconds is the realtime prediction minus the scheduled time for the same trip, measured from the feed, never modelled. Returns a per-arrival breakdown plus a summary (on-time / late / early counts, median and worst delay, and a verdict). Find a stop id with Transit Trip Plan or by name first.',
	input: { stop: 'South Station', route: 'Red', limit: 20 },
	inputSchema: {
		type: 'object',
		required: ['stop'],
		properties: {
			stop: { type: 'string', description: 'Stop id, station name, or "lat,lon".' },
			route: { type: 'string', description: 'Optional feed route id to filter by.' },
			limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		},
	},
	outputExample: {
		source: 'gtfs-rt-live',
		agency: 'MBTA (Massachusetts Bay Transportation Authority)',
		summary: { predictions: 12, withSchedule: 10, onTime: 8, late: 2, early: 0, medianDelaySeconds: 30, worstDelaySeconds: 240, verdict: 'running-well' },
		arrivals: [{ routeId: 'Red', routeName: 'Red Line', delaySeconds: 30, status: 'on-time' }],
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
