// WMO weather interpretation codes (Open-Meteo) mapped to labels and icon kinds. Pure data.

const T = {
	0: ['Clear sky', 'clear'],
	1: ['Mainly clear', 'clear'],
	2: ['Partly cloudy', 'partly'],
	3: ['Overcast', 'cloud'],
	45: ['Fog', 'fog'],
	48: ['Freezing fog', 'fog'],
	51: ['Light drizzle', 'drizzle'],
	53: ['Drizzle', 'drizzle'],
	55: ['Heavy drizzle', 'drizzle'],
	56: ['Light freezing drizzle', 'drizzle'],
	57: ['Freezing drizzle', 'drizzle'],
	61: ['Light rain', 'rain'],
	63: ['Rain', 'rain'],
	65: ['Heavy rain', 'rain'],
	66: ['Light freezing rain', 'rain'],
	67: ['Freezing rain', 'rain'],
	71: ['Light snow', 'snow'],
	73: ['Snow', 'snow'],
	75: ['Heavy snow', 'snow'],
	77: ['Snow grains', 'snow'],
	80: ['Light showers', 'rain'],
	81: ['Showers', 'rain'],
	82: ['Violent showers', 'rain'],
	85: ['Light snow showers', 'snow'],
	86: ['Snow showers', 'snow'],
	95: ['Thunderstorm', 'storm'],
	96: ['Thunderstorm with hail', 'storm'],
	99: ['Severe thunderstorm with hail', 'storm'],
};

/** { label, kind, night } for a WMO code. `isDay` false picks the night variant of clear and partly. */
export function describe(code, isDay = true) {
	const [label, kind] = T[code] || ['Unknown', 'cloud'];
	const night = !isDay;
	let l = label;
	if (night && code === 0) l = 'Clear night';
	if (night && code === 1) l = 'Mainly clear night';
	return { label: l, kind, night };
}

/** Compass point for a wind direction in degrees. */
export function compass(deg) {
	const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** UV index category label. */
export function uvLabel(uv) {
	if (uv < 3) return 'Low';
	if (uv < 6) return 'Moderate';
	if (uv < 8) return 'High';
	if (uv < 11) return 'Very high';
	return 'Extreme';
}
