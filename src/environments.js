export const environments = [
	{
		id: '',
		name: 'None',
		path: null,
	},
	{
		id: 'neutral', // THREE.RoomEnvironment
		name: 'Neutral',
		path: null,
	},
	{
		id: 'venice-sunset',
		name: 'Venice Sunset',
		path: 'https://storage.googleapis.com/donmccurdy-static/venice_sunset_1k.exr',
		format: '.exr',
	},
	{
		id: 'footprint-court',
		name: 'Footprint Court (HDR Labs)',
		path: 'https://storage.googleapis.com/donmccurdy-static/footprint_court_2k.exr',
		format: '.exr',
	},
	{
		id: 'pano', // the visitor's own 360 photo, loaded at runtime (src/viewer/pano-stage.js)
		name: 'Your 360 photo',
		path: null,
	},
];
