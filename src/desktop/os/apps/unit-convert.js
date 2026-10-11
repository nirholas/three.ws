// Pure unit table for the Calculator's Converter mode. Linear categories carry a factor to the
// category's base unit; temperature uses explicit to/from functions.

export const CATEGORIES = {
	length: { label: 'Length', base: 'm', units: {
		mm: ['Millimeters', 0.001], cm: ['Centimeters', 0.01], m: ['Meters', 1], km: ['Kilometers', 1000],
		in: ['Inches', 0.0254], ft: ['Feet', 0.3048], yd: ['Yards', 0.9144], mi: ['Miles', 1609.344], nmi: ['Nautical miles', 1852],
	} },
	mass: { label: 'Mass', base: 'kg', units: {
		mg: ['Milligrams', 1e-6], g: ['Grams', 0.001], kg: ['Kilograms', 1], t: ['Metric tons', 1000],
		oz: ['Ounces', 0.028349523125], lb: ['Pounds', 0.45359237], st: ['Stone', 6.35029318],
	} },
	temperature: { label: 'Temperature', base: 'C', units: {
		C: ['Celsius', null], F: ['Fahrenheit', null], K: ['Kelvin', null],
	} },
	area: { label: 'Area', base: 'm2', units: {
		mm2: ['Square millimeters', 1e-6], cm2: ['Square centimeters', 1e-4], m2: ['Square meters', 1], ha: ['Hectares', 10000],
		km2: ['Square kilometers', 1e6], in2: ['Square inches', 0.00064516], ft2: ['Square feet', 0.09290304], ac: ['Acres', 4046.8564224], mi2: ['Square miles', 2589988.110336],
	} },
	volume: { label: 'Volume', base: 'l', units: {
		ml: ['Milliliters', 0.001], l: ['Liters', 1], m3: ['Cubic meters', 1000], tsp: ['Teaspoons (US)', 0.00492892159375],
		tbsp: ['Tablespoons (US)', 0.01478676478125], floz: ['Fluid ounces (US)', 0.0295735295625], cup: ['Cups (US)', 0.2365882365],
		pt: ['Pints (US)', 0.473176473], qt: ['Quarts (US)', 0.946352946], gal: ['Gallons (US)', 3.785411784], ft3: ['Cubic feet', 28.316846592],
	} },
	speed: { label: 'Speed', base: 'ms', units: {
		ms: ['Meters per second', 1], kmh: ['Kilometers per hour', 1 / 3.6], mph: ['Miles per hour', 0.44704], kn: ['Knots', 1852 / 3600], fts: ['Feet per second', 0.3048], mach: ['Mach (sea level)', 340.29],
	} },
	time: { label: 'Time', base: 's', units: {
		ms: ['Milliseconds', 0.001], s: ['Seconds', 1], min: ['Minutes', 60], h: ['Hours', 3600], d: ['Days', 86400], wk: ['Weeks', 604800], mo: ['Months (30.44 d)', 2629746], yr: ['Years (365.25 d)', 31557600],
	} },
	data: { label: 'Data', base: 'B', units: {
		bit: ['Bits', 0.125], B: ['Bytes', 1], KB: ['Kilobytes', 1e3], MB: ['Megabytes', 1e6], GB: ['Gigabytes', 1e9], TB: ['Terabytes', 1e12],
		KiB: ['Kibibytes', 1024], MiB: ['Mebibytes', 1048576], GiB: ['Gibibytes', 1073741824], TiB: ['Tebibytes', 1099511627776],
	} },
};

const toCelsius = { C: (v) => v, F: (v) => ((v - 32) * 5) / 9, K: (v) => v - 273.15 };
const fromCelsius = { C: (v) => v, F: (v) => (v * 9) / 5 + 32, K: (v) => v + 273.15 };

/** Convert `value` between two units of one category. Throws on unknown units. */
export function convert(category, from, to, value) {
	const cat = CATEGORIES[category];
	if (!cat) throw new Error(`Unknown category ${category}`);
	if (!(from in cat.units) || !(to in cat.units)) throw new Error('Unknown unit');
	if (!Number.isFinite(value)) throw new Error('Enter a number');
	if (category === 'temperature') {
		const c = toCelsius[from](value);
		if (c < -273.15 - 1e-9) throw new Error('Below absolute zero');
		return fromCelsius[to](c);
	}
	return (value * cat.units[from][1]) / cat.units[to][1];
}

export const unitKeys = (category) => Object.keys(CATEGORIES[category].units);
