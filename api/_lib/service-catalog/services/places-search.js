// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'places-search',
	title: 'Places Search',
	category: 'live-data',
	useCase: 'three.ws Places Search: $0.002 USDC per call returns real points of interest near a coordinate from OpenStreetMap, with opening hours, contact details, address, and cuisine where tagged.',
	path: '/api/x402/places-search',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Places',
	tags: ['places', 'live-data', 'osm', 'overpass', 'poi'],
	description: 'three.ws Places Search: live public-data endpoint, no API key anywhere in the chain. Pay $0.002 USDC (or use the free daily per-IP quota) to search OpenStreetMap via the Overpass API for points of interest within a radius of a coordinate, optionally filtered to a category (amenity/shop/leisure/tourism value such as cafe, restaurant, pharmacy, museum). Returns each place\'s name, category, coordinates, opening hours, phone, website, address, and cuisine where tagged in OSM.',
	input: { lat: 42.3519, lon: -71.0552, radius: 500, category: 'cafe', limit: 10 },
	inputSchema: {
		type: 'object',
		required: ['lat', 'lon'],
		properties: {
			lat: { type: 'number', minimum: -90, maximum: 90 },
			lon: { type: 'number', minimum: -180, maximum: 180 },
			radius: { type: 'integer', minimum: 1, maximum: 5000, default: 500, description: 'Search radius in metres.' },
			category: { type: 'string', description: 'OSM tag value such as cafe, restaurant, pharmacy, bar, museum.' },
			limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		},
	},
	outputExample: {
		source: 'overpass',
		count: 1,
		places: [
			{ id: 'node-1072800838', osmType: 'node', osmId: 1072800838, name: 'Example Cafe', category: 'cafe', latitude: 42.3519, longitude: -71.0552, openingHours: 'Mo-Fr 07:00-19:00', phone: null, website: null, address: '1 Example St, Boston, 02110', cuisine: null },
		],
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
