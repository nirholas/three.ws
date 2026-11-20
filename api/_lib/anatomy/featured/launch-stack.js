// Featured cutaway: a fully reusable two-stage super-heavy launch system.
//
// Proportions follow the publicly reported dimensions of the current reference
// vehicle (124 m stack, 72 m booster, 52 m upper stage, 9 m diameter) at one
// model unit to 4 m. Everything else is abstract geometry: no logos, markings
// or trade dress. Every sentence a visitor can read is traced to a public
// source in docs/anatomy/rocket-engines-sources.md and audited in
// docs/anatomy/rocket-engines-review.md; tests/anatomy-featured.test.js fails
// if a number here is missing from the sources document.

const STEEL = '#b9c3cf';
const LOX = '#4fb4ff';
const CH4 = '#f5c542';
const ENGINE = '#8d99a8';
const HOT = '#ffb35c';

const RADIUS = 1.125; // 9 m diameter at 4 m per unit
const BOOSTER_TOP = 17.2;
const RING_TOP = 18.0; // booster plus hot-stage ring: 72 m
const SHIP_BODY_TOP = 27.2;
const NOSE_HEIGHT = 3.8; // ship tip at 31.0: 52 m ship, 124 m stack

// The heat shield is a half-round shell on the windward (+z) side of the upper
// stage. An extrude along y maps (u, v) to (x, -z), so the arc uses v = -r sin.
function heatShieldOutline(outer, inner, segments = 12) {
	const arc = (r) =>
		Array.from({ length: segments + 1 }, (_, i) => {
			const a = (Math.PI * i) / segments;
			return [round(r * Math.cos(a)), round(-r * Math.sin(a))];
		});
	return [...arc(outer), ...arc(inner).reverse()];
}

function round(n) {
	return Math.round(n * 1000) / 1000;
}

function flap({ id, name, side, y, points, phase }) {
	return {
		id,
		name,
		group: 'Upper stage',
		description:
			'The upper stage carries four flaps, two forward and two aft. They move to steer and stabilise it as it falls back through the atmosphere.',
		shape: { type: 'extrude', axis: 'z', points: points.map(([u, v]) => [u * side, v]), depth: 0.08 },
		position: [1.08 * side, y, 0],
		color: '#7e8a99',
		motion: [{ type: 'oscillate', kind: 'rotate', axis: 'y', amplitude: 18, frequency: 0.3, phase }],
		label: side > 0,
	};
}

function catchArm(side) {
	return [
		{
			id: `arm-carriage-${side > 0 ? 'a' : 'b'}`,
			name: 'Catch arm carriage',
			group: 'Launch tower',
			description: 'The carriage rides the tower and swings its arm open and closed around the returning stage.',
			shape: { type: 'box', size: [0.5, 0.5, 0.5], radius: 0.04 },
			position: [-4.0, 16.0, 1.4 * side],
			color: '#6f7a88',
			style: 'ghost',
			motion: [{ type: 'oscillate', kind: 'rotate', axis: 'y', amplitude: 6, frequency: 0.25, phase: side > 0 ? 0 : 180 }],
			label: false,
		},
		{
			id: `catch-arm-${side > 0 ? 'a' : 'b'}`,
			name: 'Catch arm',
			group: 'Launch tower',
			description:
				'Two arms on the launch tower close around a returning stage and hold it. The first booster catch was on the fifth flight test, on 13 October 2024; the first upper-stage catch followed on the fifteenth, on 14 November 2026.',
			parent: `arm-carriage-${side > 0 ? 'a' : 'b'}`,
			shape: { type: 'box', size: [4.4, 0.28, 0.24], radius: 0.03 },
			position: [2.2, 0, 0],
			color: '#8592a2',
			style: 'wire',
			label: side > 0,
		},
	];
}

export const LAUNCH_STACK_SPEC = {
	title: 'Fully reusable two-stage super-heavy launch system',
	subtitle: 'Booster engine ring, hot staging, boostback and the tower catch, in proportion',
	summary:
		'A two-stage launch system where both stages come back to be caught and flown again. The booster carries 33 methane and oxygen engines; the upper stage carries six. The two separate by hot staging, and each returns to the launch tower.\n\nOuter proportions follow the publicly reported dimensions of the current reference vehicle. Interior layout is drawn from outlet reporting and shown as simple shapes.',
	view: { speed: 1, explode: 0, section: null },
	parts: [
		// Booster
		{
			id: 'booster-skin',
			name: 'Booster',
			group: 'Booster',
			description: 'The first stage: 72 m tall and 9 m across in the reference vehicle, publicly reported in 2026. It is designed to return to the launch site and be caught.',
			shape: { type: 'tube', axis: 'y', outerRadius: RADIUS, innerRadius: RADIUS - 0.03, length: BOOSTER_TOP },
			position: [0, BOOSTER_TOP / 2, 0],
			color: STEEL,
			style: 'glass',
			label: true,
		},
		{
			id: 'booster-thrust-structure',
			name: 'Engine section',
			group: 'Booster',
			description: 'The base of the booster, where its 33 engines are mounted.',
			shape: { type: 'cylinder', axis: 'y', radius: 1.08, length: 0.12 },
			position: [0, 1.0, 0],
			color: '#7d8896',
		},
		{
			id: 'booster-center-engines',
			name: 'Centre engines',
			group: 'Booster engines',
			description: 'Part of the 13 maneuverable engines in the centre of the booster.',
			parent: 'booster-thrust-structure',
			shape: { type: 'cone', axis: 'y', radius: 0.13, length: 0.5 },
			position: [0.2, -0.65, 0],
			repeat: { count: 3, axis: 'y', angle: 360 },
			color: ENGINE,
		},
		{
			id: 'booster-inner-ring',
			name: 'Inner engine ring',
			group: 'Booster engines',
			description: 'The rest of the 13 maneuverable centre engines, which can steer the booster.',
			parent: 'booster-thrust-structure',
			shape: { type: 'cone', axis: 'y', radius: 0.13, length: 0.5 },
			position: [0.55, -0.65, 0],
			repeat: { count: 10, axis: 'y', angle: 360 },
			color: ENGINE,
			label: true,
		},
		{
			id: 'booster-outer-ring',
			name: 'Outer engine ring',
			group: 'Booster engines',
			description: 'The remaining 20 engines, arranged around the perimeter of the booster.',
			parent: 'booster-thrust-structure',
			shape: { type: 'cone', axis: 'y', radius: 0.13, length: 0.5 },
			position: [0.93, -0.65, 0],
			repeat: { count: 20, axis: 'y', angle: 360 },
			color: ENGINE,
			label: true,
		},
		{
			id: 'booster-lox-tank',
			name: 'Booster oxygen tank',
			group: 'Booster',
			description: 'The lower main tank, holding sub-cooled liquid oxygen. The booster carries a publicly reported 3,650 tonnes of propellant in all.',
			shape: { type: 'capsule', axis: 'y', radius: 1.05, length: 8.2 },
			position: [0, 5.4, 0],
			color: LOX,
			style: 'glass',
			label: true,
		},
		{
			id: 'booster-ch4-tank',
			name: 'Booster methane tank',
			group: 'Booster',
			description: 'The upper main tank, holding sub-cooled liquid methane above the oxygen.',
			shape: { type: 'capsule', axis: 'y', radius: 1.05, length: 7.0 },
			position: [0, 13.1, 0],
			color: CH4,
			style: 'glass',
			label: true,
		},
		{
			id: 'grid-fins',
			name: 'Grid fins',
			group: 'Booster',
			description: 'Lattice fins near the top of the booster that guide it during its descent. The current version has three, down from four.',
			shape: { type: 'box', size: [0.6, 0.15, 0.9] },
			position: [1.45, 16.3, 0],
			repeat: { count: 3, axis: 'y', angle: 180 },
			color: '#9aa6b4',
			style: 'wire',
			label: true,
		},
		{
			id: 'hot-stage-ring',
			name: 'Hot-stage ring',
			group: 'Staging',
			description: 'The vented ring between the stages. During hot staging the upper stage fires into it before separation, and its exhaust escapes through the vents. The current version uses an integrated hot stage in place of the earlier single-use interstage.',
			shape: { type: 'tube', axis: 'y', outerRadius: RADIUS, innerRadius: RADIUS - 0.03, length: RING_TOP - BOOSTER_TOP },
			position: [0, (BOOSTER_TOP + RING_TOP) / 2, 0],
			color: '#9aa6b4',
			style: 'glass',
			label: true,
		},
		{
			id: 'hot-stage-vents',
			name: 'Hot-stage vents',
			group: 'Staging',
			description: 'Openings around the ring that let the upper stage exhaust escape sideways while the stages are still joined.',
			shape: { type: 'box', size: [0.06, 0.45, 0.32] },
			position: [1.12, 17.6, 0],
			repeat: { count: 16, axis: 'y', angle: 360 },
			color: '#3a4250',
		},
		// Upper stage
		{
			id: 'ship-skin',
			name: 'Upper stage',
			group: 'Upper stage',
			description: 'The second stage: 52 m tall in the reference vehicle, publicly reported in 2026. Like the booster, it is designed to come back and fly again.',
			shape: { type: 'tube', axis: 'y', outerRadius: RADIUS, innerRadius: RADIUS - 0.03, length: SHIP_BODY_TOP - RING_TOP },
			position: [0, (RING_TOP + SHIP_BODY_TOP) / 2, 0],
			color: STEEL,
			style: 'glass',
			label: true,
		},
		{
			id: 'nose-section',
			name: 'Nose section',
			group: 'Upper stage',
			description: 'The tapered forward section of the upper stage. It holds the two header tanks.',
			shape: {
				type: 'lathe',
				axis: 'y',
				profile: [
					[RADIUS, 0],
					[1.1, 0.8],
					[1.0, 1.6],
					[0.78, 2.5],
					[0.45, 3.3],
					[0, NOSE_HEIGHT],
				],
			},
			position: [0, SHIP_BODY_TOP, 0],
			color: STEEL,
			style: 'glass',
		},
		{
			id: 'lox-header',
			name: 'Oxygen header tank',
			group: 'Upper stage',
			description: 'A small liquid oxygen tank at the tip of the nose, separate from the main tanks.',
			shape: { type: 'sphere', radius: 0.32 },
			position: [0, 30.0, 0],
			color: LOX,
			style: 'glass',
			label: true,
		},
		{
			id: 'ch4-header',
			name: 'Methane header tank',
			group: 'Upper stage',
			description: 'A small liquid methane tank directly below the oxygen header in the nose.',
			shape: { type: 'sphere', radius: 0.38 },
			position: [0, 29.2, 0],
			color: CH4,
			style: 'glass',
		},
		{
			id: 'ship-lox-tank',
			name: 'Upper-stage oxygen tank',
			group: 'Upper stage',
			description: 'The aft main tank of the upper stage, holding liquid oxygen. The upper stage carries a publicly reported 1,600 tonnes of propellant in all.',
			shape: { type: 'capsule', axis: 'y', radius: 1.05, length: 3.9 },
			position: [0, 21.25, 0],
			color: LOX,
			style: 'glass',
		},
		{
			id: 'ship-ch4-tank',
			name: 'Upper-stage methane tank',
			group: 'Upper stage',
			description: 'The forward main tank of the upper stage, holding liquid methane.',
			shape: { type: 'capsule', axis: 'y', radius: 1.05, length: 3.3 },
			position: [0, 24.95, 0],
			color: CH4,
			style: 'glass',
		},
		{
			id: 'ship-engine-mount',
			name: 'Upper-stage engine section',
			group: 'Upper-stage engines',
			description: 'The base of the upper stage, where its six engines are mounted: three for sea level and three for vacuum.',
			shape: { type: 'cylinder', axis: 'y', radius: 1.05, length: 0.1 },
			position: [0, 18.9, 0],
			color: '#7d8896',
		},
		{
			id: 'ship-sea-level-engines',
			name: 'Sea-level engines',
			group: 'Upper-stage engines',
			description: 'Three engines with standard nozzles, the same type as the booster engines.',
			parent: 'ship-engine-mount',
			shape: { type: 'cone', axis: 'y', radius: 0.16, length: 0.5 },
			position: [0.3, -0.35, 0],
			repeat: { count: 3, axis: 'y', angle: 360 },
			color: ENGINE,
			label: true,
		},
		{
			id: 'ship-vacuum-engines',
			name: 'Vacuum engines',
			group: 'Upper-stage engines',
			description: 'Three vacuum engines, a variant with a much larger nozzle that improves efficiency in space.',
			parent: 'ship-engine-mount',
			shape: { type: 'cone', axis: 'y', radius: 0.34, length: 0.8 },
			position: [0.36, -0.4, 0.62],
			repeat: { count: 3, axis: 'y', angle: 360 },
			color: '#a3aebb',
			label: true,
		},
		flap({
			id: 'forward-flap-a',
			name: 'Forward flaps',
			side: 1,
			y: 27.4,
			points: [
				[0, 0],
				[0.9, 0.25],
				[0.9, 1.2],
				[0, 1.6],
			],
			phase: 0,
		}),
		flap({
			id: 'forward-flap-b',
			name: 'Forward flaps',
			side: -1,
			y: 27.4,
			points: [
				[0, 0],
				[0.9, 0.25],
				[0.9, 1.2],
				[0, 1.6],
			],
			phase: 180,
		}),
		flap({
			id: 'aft-flap-a',
			name: 'Aft flaps',
			side: 1,
			y: 18.4,
			points: [
				[0, 0],
				[1.1, 0.2],
				[1.1, 2.4],
				[0, 2.8],
			],
			phase: 90,
		}),
		flap({
			id: 'aft-flap-b',
			name: 'Aft flaps',
			side: -1,
			y: 18.4,
			points: [
				[0, 0],
				[1.1, 0.2],
				[1.1, 2.4],
				[0, 2.8],
			],
			phase: 270,
		}),
		{
			id: 'heat-shield',
			name: 'Heat shield',
			group: 'Upper stage',
			description: 'Hexagonal heat shield tiles cover the side of the upper stage that faces the airflow on the way back through the atmosphere.',
			shape: { type: 'extrude', axis: 'y', points: heatShieldOutline(RADIUS + 0.03, RADIUS + 0.005), depth: 8.9 },
			position: [0, 22.55, 0],
			color: '#1a1d24',
			label: true,
		},
		// Launch tower
		{
			id: 'catch-tower',
			name: 'Launch and catch tower',
			group: 'Launch tower',
			description: 'The tower beside the launch mount. It stacks the vehicle before flight and catches the returning stages with its two arms.',
			shape: { type: 'box', size: [1, 20, 1] },
			position: [-4.6, 10, 0],
			color: '#6f7a88',
			style: 'wire',
			label: true,
		},
		...catchArm(1),
		...catchArm(-1),
	],
	effects: [
		{
			id: 'booster-plume',
			type: 'exhaust',
			name: 'Booster exhaust',
			description: 'All 33 engines firing. The plume can show shock diamonds, standing waves that form when the exhaust leaves the nozzles at a different pressure from the surrounding air.',
			position: [0, -0.1, 0],
			axis: 'y',
			direction: -1,
			radius: 1.0,
			radiusEnd: 1.8,
			length: 9,
			intensity: 1.4,
		},
		{
			id: 'hot-stage-flame',
			type: 'flame',
			name: 'Upper-stage ignition',
			description: 'The upper stage engines firing into the ring before the stages separate.',
			position: [0, 18.1, 0],
			axis: 'y',
			direction: -1,
			radius: 0.7,
			radiusEnd: 0.9,
			length: 0.6,
			color: '#ffd08a',
			color2: '#ff6a1a',
		},
	],
	flows: [
		{
			id: 'hot-staging-gas-a',
			name: 'Hot-staging exhaust',
			description: 'Upper stage exhaust venting sideways out of the ring.',
			path: [
				[0.3, 18.1, 0],
				[0.3, 17.75, 0],
				[0.8, 17.62, 0],
				[1.25, 17.6, 0],
				[2.1, 17.55, 0],
			],
			color: HOT,
			speed: 0.5,
			count: 30,
		},
		{
			id: 'hot-staging-gas-b',
			name: 'Hot-staging exhaust',
			description: 'Upper stage exhaust venting sideways out of the ring.',
			path: [
				[-0.2, 18.1, 0],
				[-0.6, 17.65, 0],
				[-1.25, 17.6, 0],
				[-2.1, 17.55, 0],
			],
			color: HOT,
			speed: 0.5,
			count: 30,
		},
	],
	steps: [
		{
			title: 'Two stages, both reusable',
			body: 'A booster with an upper stage on top. The reference vehicle, publicly reported in 2026, stands 124 m tall: a 72 m booster under a 52 m upper stage, both 9 m across. Both stages are designed to come back and fly again. The model keeps those proportions; the inside is drawn as simple shapes.',
			focus: ['booster-skin', 'ship-skin', 'nose-section'],
		},
		{
			title: '33 engines on the booster',
			body: 'The booster carries 33 engines that burn sub-cooled liquid methane and liquid oxygen: 13 maneuverable engines in the centre and 20 around the perimeter. Together they are publicly reported at 8,240 tonnes-force.',
			focus: ['booster-thrust-structure', 'booster-center-engines', 'booster-inner-ring', 'booster-outer-ring'],
		},
		{
			title: 'Propellant',
			body: 'Two main tanks fill most of the booster: liquid oxygen in the lower one and liquid methane above it. The booster holds a publicly reported 3,650 tonnes of propellant.',
			focus: ['booster-lox-tank', 'booster-ch4-tank'],
		},
		{
			title: 'Liftoff',
			body: 'All 33 engines light and push the whole stack off the pad. The plume can show shock diamonds: standing waves that form when the exhaust leaves the nozzles at a different pressure from the surrounding air.',
			focus: ['booster-plume', 'booster-outer-ring', 'catch-tower'],
		},
		{
			title: 'Hot staging',
			body: 'Hot staging means the next stage fires its engines before separation instead of after. With most booster engines already shut down, the upper stage lights while still attached and its exhaust vents out through the ring. It was first done on the second flight test, on 18 November 2023. The current version, revealed on 12 May 2026, replaces the earlier single-use interstage with an integrated hot stage.',
			focus: ['hot-stage-ring', 'hot-stage-vents', 'hot-stage-flame', 'hot-staging-gas-a', 'hot-staging-gas-b'],
		},
		{
			title: 'Six engines on the upper stage',
			body: 'The upper stage has six engines: three for sea level and three vacuum engines, a variant with a much larger nozzle that improves efficiency in space. It carries a publicly reported 1,600 tonnes of propellant and 1,614 tonnes-force of thrust.',
			focus: ['ship-engine-mount', 'ship-sea-level-engines', 'ship-vacuum-engines', 'ship-lox-tank', 'ship-ch4-tank'],
		},
		{
			title: 'Boostback',
			body: 'After separation the booster fires a boostback burn that sends it back toward the launch site, a phase listed among the successes of the fifth flight test. On the way down, grid fins near the top guide it. The current version has three grid fins, down from four.',
			focus: ['grid-fins', 'booster-skin'],
		},
		{
			title: 'The catch',
			body: 'The booster is designed to return to the launch site and be caught. Two arms on the tower close around it and hold it. The first booster catch happened on the fifth flight test, on 13 October 2024.',
			focus: ['catch-tower', 'arm-carriage-a', 'arm-carriage-b', 'grid-fins'],
		},
		{
			title: 'The upper stage comes home',
			body: 'The upper stage falls back through the atmosphere with hexagonal heat shield tiles facing the airflow, steering with two forward and two aft flaps. Two small header tanks sit in the nose, liquid oxygen at the tip and methane just below. On the fifteenth flight test, on 14 November 2026, the tower arms caught the upper stage for the first time.',
			focus: ['heat-shield', 'forward-flap-a', 'forward-flap-b', 'aft-flap-a', 'aft-flap-b', 'lox-header', 'ch4-header'],
		},
		{
			title: 'Full reuse',
			body: 'Both stages come back to the tower they left, so the whole vehicle can fly again. Booster: 33 engines and 3,650 tonnes of propellant. Upper stage: 6 engines and 1,600 tonnes. Every figure here is publicly reported and dated in the sources behind this model.',
			focus: ['booster-skin', 'ship-skin', 'catch-tower', 'arm-carriage-a', 'arm-carriage-b'],
		},
	],
};
