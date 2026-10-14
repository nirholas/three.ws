// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.
//
// Upstream x402-places enriches this route with Yelp reviews, falling back
// to a deterministic fixture when no Yelp key is set. three.ws ships no
// fake data, so that enrichment is dropped: this returns only the real,
// live OpenStreetMap record.

export default {
	slug: 'places-detail',
	title: 'Place Detail',
	category: 'live-data',
	useCase: 'three.ws Place Detail: $0.002 USDC per call returns the full live OpenStreetMap record for one place found via Places Search.',
	path: '/api/x402/places-detail',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Places',
	tags: ['places', 'live-data', 'osm', 'overpass', 'poi'],
	description: 'three.ws Place Detail: pay $0.002 USDC per call to fetch the full live OpenStreetMap record for one place, by the id returned from Places Search (e.g. "node-1072800838"). Returns every OSM tag alongside the structured fields (name, category, coordinates, opening hours, contact, address, cuisine).',
	input: { id: 'node-1072800838' },
	inputSchema: {
		type: 'object',
		required: ['id'],
		properties: {
			id: { type: 'string', description: 'Place id from Places Search, e.g. "node-1072800838", "way-55", "relation-9".' },
		},
	},
	outputExample: {
		source: 'overpass',
		place: { id: 'node-1072800838', osmType: 'node', osmId: 1072800838, name: 'Example Cafe', category: 'cafe', latitude: 42.3519, longitude: -71.0552, openingHours: 'Mo-Fr 07:00-19:00', tags: { amenity: 'cafe', name: 'Example Cafe' } },
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
