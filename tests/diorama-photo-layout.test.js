import { describe, it, expect } from 'vitest';
import { planFromPhotoAnalysis, boxFromBox2d, boxFromEdges, forgeOriginHint, MIN_CROP_SIDE } from '../src/diorama/photo-layout.js';
import { normalizeDiorama, ISLAND_RADIUS, OBJECT_FOOTPRINT, MAX_OBJECTS } from '../src/diorama/schema.js';
import { parseInlinePhoto, isOwnStorageUrl, stripForeignPhotos } from '../api/_lib/diorama-photo.js';

// A desk scene shaped like a real vision reply: a desk on the floor, a laptop
// and a lamp on the desk, a chair in front, a partly hidden bunny figurine.
const desk = () => ({
	title: 'Quiet Morning Desk',
	scene: 'A white desk by a bright window with a laptop, a lamp and a small bunny figurine.',
	mood: 'day',
	ground: 'stone',
	palette: { sky: ['#e8eef2', '#ffffff'], ground: '#d9d4cc', fog: '#eef2f5', accent: '#ffe7b0' },
	objects: [
		{ label: 'white desk', prompt: 'a white wooden writing desk with two drawers', box_2d: [600, 150, 1000, 850], distance_m: 1.6, footprint_m: 1.2, height_m: 0.75, on: null, facing: 'camera' },
		{ label: 'laptop', prompt: 'an open silver laptop', box_2d: [520, 560, 760, 780], distance_m: 1.7, footprint_m: 0.33, height_m: 0.22, on: 0, facing: 'left' },
		{ label: 'desk lamp', prompt: 'a white dome desk lamp', box_2d: [350, 380, 640, 480], distance_m: 1.9, footprint_m: 0.18, height_m: 0.45, on: 'white desk' },
		{ label: 'chair', prompt: 'a white chair with a knit blanket', box_2d: [760, 380, 1000, 640], distance_m: 1.1, footprint_m: 0.5, height_m: 0.8, on: null },
		{ label: 'bunny', prompt: 'a small white bunny figurine', box_2d: [610, 240, 680, 280], distance_m: 1.8, footprint_m: 0.06, height_m: 0.1, on: 0, occluded: true },
	],
});

const byLabel = (plan, label) => plan.objects.find((o) => o.label === label);

describe('boxFromBox2d', () => {
	it('converts the 0..1000 [ymin,xmin,ymax,xmax] convention to [x0,y0,x1,y1] fractions', () => {
		expect(boxFromBox2d([100, 200, 500, 800])).toEqual([0.2, 0.1, 0.8, 0.5]);
	});
	it('accepts fractional boxes as-is and rejects inverted or malformed ones', () => {
		expect(boxFromBox2d([0.1, 0.2, 0.5, 0.8])).toEqual([0.2, 0.1, 0.8, 0.5]);
		expect(boxFromBox2d([500, 200, 100, 800])).toBeNull();
		expect(boxFromBox2d([1, 2, 3])).toBeNull();
		expect(boxFromBox2d(['a', 0, 1, 1])).toBeNull();
	});
});

describe('boxFromEdges', () => {
	// Models disagree on array box order (Gemini answers [ymin,xmin,ymax,xmax],
	// nemotron-omni answered [x0,y0,x1,y1] to the same prompt), so the prompt
	// asks for named edges and the layout reads those first.
	it('reads named 0..1000 edges into [x0,y0,x1,y1] fractions', () => {
		expect(boxFromEdges({ left: 10, top: 120, right: 175, bottom: 540 })).toEqual([0.01, 0.12, 0.175, 0.54]);
		expect(boxFromEdges({ left: 0.1, top: 0.2, right: 0.5, bottom: 0.9 })).toEqual([0.1, 0.2, 0.5, 0.9]);
		expect(boxFromEdges({ left: 500, top: 0, right: 100, bottom: 1000 })).toBeNull();
		expect(boxFromEdges({ left: 1, top: 2 })).toBeNull();
		expect(boxFromEdges(null)).toBeNull();
	});
	it('places an object from its named box ahead of any box_2d array', () => {
		const { plan } = planFromPhotoAnalysis({
			objects: [
				{
					label: 'green lamp',
					prompt: 'a green desk lamp',
					box: { left: 10, top: 120, right: 175, bottom: 540 },
					box_2d: [999, 999, 1000, 1000],
					distance_m: 0.6,
				},
			],
		});
		expect(plan.objects[0].box).toEqual([0.01, 0.12, 0.175, 0.54]);
	});
});

describe('planFromPhotoAnalysis', () => {
	it('keeps the photo left/right order and puts nearer objects toward the camera (+z)', () => {
		const { plan } = planFromPhotoAnalysis(desk());
		const deskObj = byLabel(plan, 'white desk');
		const laptop = byLabel(plan, 'laptop');
		const lamp = byLabel(plan, 'desk lamp');
		const chair = byLabel(plan, 'chair');
		expect(laptop.position[0]).toBeGreaterThan(lamp.position[0]); // laptop is right of the lamp
		expect(chair.position[2]).toBeGreaterThan(deskObj.position[2]); // chair is nearer the camera
	});

	it('scales every object by one factor so real proportions survive', () => {
		const { plan } = planFromPhotoAnalysis(desk());
		const deskObj = byLabel(plan, 'white desk');
		const laptop = byLabel(plan, 'laptop');
		// 1.2 m desk vs 0.33 m laptop: the footprint ratio carries into the plan.
		expect(deskObj.scale / laptop.scale).toBeCloseTo(1.2 / 0.33, 1);
	});

	it('fits the room on the island and holds the largest object to the scale cap', () => {
		const { plan } = planFromPhotoAnalysis(desk());
		for (const o of plan.objects) {
			expect(Math.hypot(o.position[0], o.position[2])).toBeLessThan(ISLAND_RADIUS);
			expect(o.scale).toBeLessThanOrEqual(4);
		}
		const big = planFromPhotoAnalysis({
			objects: [
				{ label: 'bed', prompt: 'a double bed', box_2d: [400, 100, 1000, 900], distance_m: 3, footprint_m: 2.2, height_m: 0.6 },
				{ label: 'rug', prompt: 'a round rug', box_2d: [800, 300, 1000, 700], distance_m: 2, footprint_m: 1.5, height_m: 0.02 },
			],
		}).plan;
		expect(Math.max(...big.objects.map((o) => o.scale))).toBeLessThanOrEqual(4);
		expect(byLabel(big, 'bed').scale * OBJECT_FOOTPRINT).toBeGreaterThan(byLabel(big, 'rug').scale * OBJECT_FOOTPRINT);
	});

	it('links what rests on what, by index or by label, and lifts it by the support height', () => {
		const { plan } = planFromPhotoAnalysis(desk());
		const deskObj = byLabel(plan, 'white desk');
		expect(byLabel(plan, 'laptop').supportId).toBe(deskObj.id);
		expect(byLabel(plan, 'desk lamp').supportId).toBe(deskObj.id);
		expect(byLabel(plan, 'chair').supportId).toBeUndefined();
		expect(deskObj.position[1]).toBe(0);
		expect(byLabel(plan, 'laptop').position[1]).toBeGreaterThan(0);
	});

	it('orders supporters before the objects that rest on them', () => {
		const a = desk();
		a.objects = [a.objects[1], a.objects[2], a.objects[0]]; // laptop, lamp, desk
		a.objects[0].on = 2;
		a.objects[1].on = 2;
		const { plan } = planFromPhotoAnalysis(a);
		const idx = (label) => plan.objects.findIndex((o) => o.label === label);
		expect(idx('white desk')).toBeLessThan(idx('laptop'));
		expect(idx('white desk')).toBeLessThan(idx('desk lamp'));
	});

	it('breaks support cycles and ignores self or unknown supports', () => {
		const { plan } = planFromPhotoAnalysis({
			objects: [
				{ label: 'a', prompt: 'a box', box_2d: [100, 100, 400, 400], on: 1 },
				{ label: 'b', prompt: 'a crate', box_2d: [500, 500, 900, 900], on: 0 },
				{ label: 'c', prompt: 'a vase', box_2d: [100, 600, 300, 800], on: 2 },
				{ label: 'd', prompt: 'a cup', box_2d: [600, 100, 800, 300], on: 9 },
			],
		});
		const ids = new Map(plan.objects.map((o) => [o.id, o]));
		for (const o of plan.objects) {
			const seen = new Set();
			for (let cur = o; cur?.supportId; cur = ids.get(cur.supportId)) {
				expect(seen.has(cur.id)).toBe(false);
				seen.add(cur.id);
			}
		}
		expect(byLabel(plan, 'c').supportId).toBeUndefined();
		expect(byLabel(plan, 'd').supportId).toBeUndefined();
	});

	it('forges visible, crop-sized objects from the photo and the rest from text', () => {
		const { plan } = planFromPhotoAnalysis(desk());
		expect(byLabel(plan, 'white desk').forgeFrom).toBe('photo');
		expect(byLabel(plan, 'white desk').rotationY).toBe(0);
		expect(byLabel(plan, 'bunny').forgeFrom).toBe('text'); // occluded
		const tiny = planFromPhotoAnalysis({
			objects: [{ label: 'pin', prompt: 'a pin', box_2d: [100, 100, 100 + MIN_CROP_SIDE * 500, 300] }],
		}).plan;
		expect(tiny.objects[0].forgeFrom).toBe('text');
	});

	it('takes the facing estimate only for text-forged objects', () => {
		const a = desk();
		a.objects[1].occluded = true; // laptop now forges from text, facing left
		const { plan } = planFromPhotoAnalysis(a);
		expect(byLabel(plan, 'laptop').rotationY).toBeCloseTo(-Math.PI / 2, 2);
	});

	it('drops bad boxes and same-label duplicates, and caps the object count', () => {
		const objects = Array.from({ length: 14 }, (_, i) => ({
			label: `thing ${i}`,
			prompt: `thing number ${i}`,
			box_2d: [50 * i, 10, 50 * i + 60, 300],
		}));
		objects.push({ label: 'thing 0', prompt: 'thing 0 again', box_2d: [0, 10, 60, 300] });
		objects.push({ label: 'broken', prompt: 'no box' });
		const { plan, dropped } = planFromPhotoAnalysis({ objects });
		expect(plan.objects.length).toBe(MAX_OBJECTS);
		expect(dropped).toBe(objects.length - MAX_OBJECTS);
	});

	it('returns an empty plan for a reply with no usable objects', () => {
		expect(planFromPhotoAnalysis(null).plan.objects).toEqual([]);
		expect(planFromPhotoAnalysis({ objects: 'nope' }).plan.objects).toEqual([]);
	});

	it('produces a plan the schema accepts unchanged, photo fields included', () => {
		const { plan } = planFromPhotoAnalysis(desk());
		plan.sourceImage = 'https://cdn.example.com/forge/uploads/desk.jpg';
		const { ok, diorama } = normalizeDiorama(plan);
		expect(ok).toBe(true);
		expect(diorama.sourceImage).toBe(plan.sourceImage);
		expect(diorama.title).toBe('Quiet Morning Desk');
		expect(diorama.ground).toBe('stone');
		const laptop = diorama.objects.find((o) => o.label === 'laptop');
		expect(laptop.box).toEqual(byLabel(plan, 'laptop').box);
		expect(laptop.supportId).toBe(byLabel(plan, 'white desk').id);
		expect(normalizeDiorama(diorama).diorama).toEqual(diorama);
	});
});

describe('schema photo fields', () => {
	it('leaves a sentence world exactly as it was', () => {
		const { diorama } = normalizeDiorama({ prompt: 'a campsite', objects: [{ prompt: 'a tent', position: [0, 0, 0] }] });
		expect(diorama).not.toHaveProperty('sourceImage');
		expect(Object.keys(diorama.objects[0]).sort()).toEqual(
			['glbUrl', 'id', 'label', 'position', 'prompt', 'rotationY', 'scale', 'status'].sort(),
		);
	});

	it('rejects non-https photo URLs and drops dangling supports', () => {
		const { diorama } = normalizeDiorama({
			prompt: 'p',
			sourceImage: 'http://insecure.example/x.jpg',
			objects: [
				{ id: 'a', prompt: 'a', refImage: 'javascript:alert(1)', supportId: 'ghost', box: [0.5, 0, 0.2, 1] },
				{ id: 'b', prompt: 'b', supportId: 'b', forgeFrom: 'magic' },
			],
		});
		expect(diorama).not.toHaveProperty('sourceImage');
		expect(diorama.objects[0]).not.toHaveProperty('refImage');
		expect(diorama.objects[0]).not.toHaveProperty('supportId');
		expect(diorama.objects[0]).not.toHaveProperty('box');
		expect(diorama.objects[1]).not.toHaveProperty('supportId');
		expect(diorama.objects[1]).not.toHaveProperty('forgeFrom');
	});
});

describe('compose-photo input guards', () => {
	it('parses data URLs and bare base64, and bounds the size', () => {
		const b64 = Buffer.alloc(4000, 7).toString('base64');
		expect(parseInlinePhoto(`data:image/png;base64,${b64}`)).toEqual({ base64: b64, mimeType: 'image/png' });
		expect(parseInlinePhoto(b64)).toEqual({ base64: b64, mimeType: 'image/jpeg' });
		expect(parseInlinePhoto('data:image/svg+xml;base64,AAAA').error).toMatch(/PNG, JPEG or WebP/);
		expect(parseInlinePhoto('abc').error).toMatch(/too small/);
		expect(parseInlinePhoto(Buffer.alloc(800_000).toString('base64')).error).toMatch(/capped/);
		expect(parseInlinePhoto(undefined).error).toBeTruthy();
	});

	it('only treats https URLs on our own public storage as ours', () => {
		expect(isOwnStorageUrl('https://media.example.org/forge/uploads/a.jpg', 'https://media.example.org')).toBe(true);
		expect(isOwnStorageUrl('https://media.example.org/a.jpg', 'media.example.org')).toBe(true);
		expect(isOwnStorageUrl('https://evil.example/a.jpg', 'https://media.example.org')).toBe(false);
		expect(isOwnStorageUrl('http://media.example.org/a.jpg', 'https://media.example.org')).toBe(false);
		expect(isOwnStorageUrl('https://media.example.org/a.jpg', '')).toBe(false);
	});

	it('keeps only own-storage photo links on a world being saved', () => {
		const own = 'https://media.example.org/forge/uploads/room.jpg';
		const crop = 'https://media.example.org/forge/uploads/lamp.jpg';
		const world = {
			title: 'Desk',
			sourceImage: 'https://evil.example/tracker.jpg',
			objects: [
				{ id: 'a', prompt: 'a desk', refImage: crop },
				{ id: 'b', prompt: 'a lamp', refImage: 'https://evil.example/b.jpg' },
				{ id: 'c', prompt: 'a mug' },
			],
		};
		const out = stripForeignPhotos(world, 'https://media.example.org');
		expect(out).not.toHaveProperty('sourceImage');
		expect(out.objects[0].refImage).toBe(crop);
		expect(out.objects[1]).not.toHaveProperty('refImage');
		expect(out.objects[2]).toEqual({ id: 'c', prompt: 'a mug' });
		expect(world.sourceImage).toBe('https://evil.example/tracker.jpg');
		expect(stripForeignPhotos({ ...world, sourceImage: own }, 'https://media.example.org').sourceImage).toBe(own);
		expect(stripForeignPhotos({ ...world, sourceImage: own }, '')).not.toHaveProperty('sourceImage');
		expect(stripForeignPhotos(null, 'https://media.example.org')).toBe(null);
	});
});

describe('forgeOriginHint', () => {
	it('only claims a piece was forged from the photo once it actually forged', () => {
		const obj = { label: 'lamp', forgeFrom: 'photo' };
		expect(forgeOriginHint(obj, 'ready')).toBe('Forged from its crop of your photo');
		expect(forgeOriginHint(obj, 'forging')).toBe('Being forged from its crop of your photo');
		expect(forgeOriginHint(obj, 'pending')).toBe('Will be forged from its crop of your photo');
		expect(forgeOriginHint(obj, 'failed')).not.toMatch(/^Forged/);
		expect(forgeOriginHint(obj, 'failed')).toMatch(/Retry/);
	});

	it('describes the description lane in the same tense as its status', () => {
		const obj = { label: 'glasses', forgeFrom: 'text' };
		expect(forgeOriginHint(obj, 'ready')).toMatch(/^Forged from its description/);
		expect(forgeOriginHint(obj, 'forging')).toMatch(/^Being forged from its description/);
		expect(forgeOriginHint(obj, 'failed')).not.toMatch(/^Forged/);
	});

	it('says nothing for objects from a sentence-composed world', () => {
		expect(forgeOriginHint({ label: 'tent' }, 'ready')).toBe('');
		expect(forgeOriginHint(null, 'ready')).toBe('');
	});
});
