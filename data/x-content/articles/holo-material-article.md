Type the word geode into the Holo Sticker page, pick Gold foil, and a die-cut sticker appears on a black background with one corner lifting away from the sheet. Move the pointer and the foil shifts colour the way a real one does when you turn it in your hand. Press Download PNG and the sticker on screen is saved as a picture. The page fetches no picture and no 3D model to make any of it, and says so in its own words: "no images, no model files".

![The Holo Sticker page with the word geode cut as a gold foil sticker, the mark, foil and peel controls on the right](/x-media/holo-material-article/page.png)

This article follows that one word, geode, through each stage that turns five typed letters into a lit, bendable object. The letters become white pixels on a canvas that is 640 pixels wide. A cutter's margin is added by stamping those pixels 48 times around a circle. A marching squares tracer reads the pixels back as vector outlines from a table of 16 cases. A constrained Delaunay mesh gives the flat faces vertices to bend at, a physical material gives the metal its thin-film colour, a painted environment gives it something to reflect, and a vertex shader rolls the corner up. Each number below is a constant in the code or a line on the live page, so you can check it.

## Five letters become white pixels on a 640 by 640 canvas

A sticker starts as a shape, and the shape starts as ink. The page draws the mark into a canvas that stays off screen, 640 pixels on each side. For a typed word the page sets the text in Inter at weight 900, which is the heaviest cut and gives the letters thick strokes that survive being cut out. It starts at 36% of the canvas height, which is a font size of about 230 pixels, and measures the word. If the word is wider than the canvas minus a 10% margin on each side, 512 pixels, the font is scaled down until it fits. A word of 16 characters, the most the text box accepts, is scaled to fit with the same rule.

The text box trims the input and cuts it at 16 characters. The three preset marks use the same canvas: the three slanted bars of the chevron preset, the word $THREE and the word three.ws. The bars are drawn with all slants at 45 degrees, so the notches between them are clean in the finished cut.

Using a 2D canvas for the mark is a design choice with a large payoff. The browser already knows how to set type, with kerning, ligatures and its own font fallbacks, so the sticker accepts any text the page can render and the tracer does not need to know what a letter is. It sees alpha values alone. Anything the canvas can draw can become a sticker.

```js
const RASTER = 640; // offscreen raster resolution, px

function drawTextMark(ctx, size, text) {
	const pad = size * 0.1;
	let fontSize = size * 0.36;
	const font = (px) => `900 ${px}px Inter, 'Helvetica Neue', Arial, system-ui, sans-serif`;
	ctx.font = font(fontSize);
	const w = ctx.measureText(text).width;
	if (w > size - pad * 2) fontSize *= (size - pad * 2) / w;
	fontSize = Math.max(fontSize, size * 0.06);
	ctx.font = font(fontSize);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#fff';
	ctx.fillText(text, size / 2, size / 2 + fontSize * 0.04);
}
```

## A cutter's margin is the mark stamped 48 times around a circle

A printed sticker has a white border because the cutting blade follows a line a little outside the artwork. Sticker makers call it the die-cut line, and it does two jobs: it gives the sticker a body to hold, and it joins nearby pieces, like the five letters of geode, into one sheet so nothing falls out.

The page builds that line the same way a cutter plan does, by growing the shape. It stamps the mark 48 times around a circle with a radius of 28 pixels, which is 4.4% of the canvas, and once more in the centre. The union of all those offset copies is the mark grown in all directions by the radius of the circle, and the page's own description says the same thing: the base is "dilated by a disc the way a cutter adds a margin". Two letters closer than twice that radius merge into one backing, which is why a word comes out as one sticker with a continuous edge and not as five loose pieces.

The step needs no pixel loop and no image library. Drawing an image at an offset is a single call on the 2D canvas, so 48 stamps plus one in the centre on a 640 pixel canvas produce the grown shape.

```js
// Dilate the mark by a disc: stamp the mark image around a circle. This is the
// die-cut margin, and it merges nearby islands exactly like a real cut line.
function dilate(markCanvas, radius) {
	const c = makeCanvas(markCanvas.width);
	const ctx = c.getContext('2d');
	const steps = 48;
	for (let i = 0; i < steps; i++) {
		const a = (i / steps) * Math.PI * 2;
		ctx.drawImage(markCanvas, Math.cos(a) * radius, Math.sin(a) * radius);
	}
	ctx.drawImage(markCanvas, 0, 0);
	return c;
}

const baseCanvas = dilate(markCanvas, RASTER * 0.044);
```

![The geode sticker in Gold foil, tilted toward the viewer on a black background, with the rounded die-cut backing running around all five letters](/x-media/holo-material-article/geode.png)

## Marching squares turns pixels into outlines using a table of 16 cases

Pixels are the wrong material for a 3D object. A sticker needs outlines: closed loops of points that can be extruded, bevelled and bent. The page recovers them with marching squares, the contour-tracing method behind contour maps.

The tracer reads the canvas and marks a pixel as inside when it is more than half opaque. It then walks the image in cells of 2 by 2 pixels. Each cell has four corners, each corner is inside or outside, so each cell is one of 16 cases, and the code packs the four corner bits into one number from 0 to 15. A lookup table says which edges of the cell a boundary line crosses in each case. Case 0 and case 15 are all outside and all inside, so they hold no line. The other cases hold one segment, apart from the two saddle cases, where opposite corners are inside and the cell holds two.

A saddle is the one place the method has a choice, because two inside corners on a diagonal could be joined or kept apart. The code fixes one pairing for both saddle cases, so each edge midpoint ends up touching exactly two segments and stitching a loop together cannot fork. Segments are then chained end to end through a map keyed on the midpoint, in integer coordinates that are doubled so a midpoint is a whole number and two segments that meet agree on where.

```js
const idx = at(x, y) * 8 + at(x + 1, y) * 4 + at(x + 1, y + 1) * 2 + at(x, y + 1);
const spec = SEGS[idx];

// T = top edge, R = right, B = bottom, L = left, one entry per corner pattern
const SEGS = [
	null, [[L, B]], [[B, R]], [[L, R]],
	[[T, R]], [[T, R], [L, B]], [[T, B]], [[T, L]],
	[[T, L]], [[T, B]], [[T, L], [B, R]], [[T, R]],
	[[L, R]], [[B, R]], [[L, B]], null,
];
```

The canvas is padded by 2 pixels on each side before tracing, so a shape that touches the edge of the canvas still closes into a loop. A loop is kept when it has more than 8 points and ends where it began.

## Three passes of corner cutting turn staircase edges into curves

A raw marching squares loop follows pixel steps, so a diagonal edge arrives as a staircase. The page smooths each loop with three rounds of Chaikin corner cutting. Each round replaces each edge with two points, one at a quarter of the way along it and one at three quarters, so the corners are shaved and the loop converges toward a smooth curve. After three rounds the staircase on the slanted bars of the chevron preset reads as a straight line with softly rounded ends, and the curves of the letters in geode come out smooth.

Smoothing multiplies the number of points by 8, so the page drops any point that lands closer than 1.4 pixels to the one before it. That keeps the outline dense where it curves and light where it runs straight.

The same trace and the same smoothing run twice: once on the grown base canvas, which gives the die-cut outline, and once on the plain mark canvas, which gives the raised foil lettering that sits on top of it. Both outlines pass through one shared transform, which centres them and scales the base to 3.1 world units wide, so the lettering lands exactly where it belongs on the backing.

```js
// Chaikin corner cutting on a closed loop, then drop near-duplicate points.
function smoothLoop(points, iterations) {
	let pts = points;
	for (let it = 0; it < iterations; it++) {
		const out = [];
		for (let i = 0; i < pts.length; i++) {
			const [ax, ay] = pts[i];
			const [bx, by] = pts[(i + 1) % pts.length];
			out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
			out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
		}
		pts = out;
	}
	/* ...then near-duplicate points under 1.4 px are dropped */
	return pts;
}
```

## Counting containing loops tells an outline from a hole

Look at the letter o in geode. The tracer finds two loops for it in the plain mark: the outside of the ring and the inside of the ring. Both are just closed curves. Which one is the letter and which one is the hole is not something the tracer knows.

The page works it out by counting. It discards loops with an area under 30 square pixels, which removes specks, and sorts the rest by area so each loop can be compared with the loops above it. Then each loop counts how many larger loops contain it, testing one of its points against each larger loop. A count of 0 means the loop is an outer outline. A count of 1 means it sits inside one outline, so it is a hole in that outline. A count of 2 means it is an island inside a hole, such as the dot inside a letter with a counter, so it becomes an outline again. Even counts are outlines and odd counts are holes, and each hole is attached to the outline that directly contains it.

This even-odd rule needs no knowledge of letters, fonts or winding direction, so it handles the counters in a, e, d and o, the eye of a punctuation mark and a ring inside a ring with the same few lines. The finished contour set goes to THREE.Shape, which takes an outline and its holes together, and the holes in geode come out as real openings you can see the black background through.

```js
const entries = contours
	.map((pts) => ({ pts, area: Math.abs(signedArea(pts)) }))
	.filter((e) => e.area > 30)
	.sort((a, b) => b.area - a.area);
for (const e of entries) {
	e.depth = entries.filter((o) => o !== e && o.area > e.area && pointInPoly(e.pts[0], o.pts)).length;
}
for (const e of entries) {
	if (e.depth % 2 !== 0) continue; // odd depth: a hole, attached below
	const shape = new THREE.Shape(toVec(e.pts));
	const holes = entries.filter(
		(h) => h.depth === e.depth + 1 && pointInPoly(h.pts[0], e.pts)
	);
	for (const h of holes) shape.holes.push(new THREE.Path(toVec(h.pts)));
	shapes.push(shape);
}
```

## A constrained Delaunay mesh gives the flat faces vertices that can bend

The outline is a flat shape, and a sticker needs to be a body with thickness, bevelled edges and a face that can curl. Three.js extrusion makes the walls and bevels of such a body well, because they are short quads running along the dense outline. Its flat faces are the issue for a peel. They are triangulated from the outline alone, so they come out as long slivers that run from edge to edge with no vertex in between, and a triangle bends at its vertices. A sliver across the fold line stays straight and reads as a stair step in the curl.

So the page keeps the walls and bevels from three.js and rebuilds both flat faces itself, in a small geometry module that sits beside the main file. The rebuild has three steps. To begin, it lays an even triangular lattice of interior points over the shape, with a spacing of about 0.04 world units, and rejects any lattice point closer to the rim than about a third of that spacing so no sliver forms against the edge. Next it runs a constrained Delaunay triangulation over the rim points and the lattice together, with the rim edges forced into the mesh. Then it floods inward from the outside of the shape, flipping between outside and inside each time it crosses a rim edge, and keeps the triangles inside. Holes fall out of the same rule, because crossing a hole's rim flips the state back to outside.

Edges across the faces are about as long as the lattice spacing. The spacing is not an arbitrary number: it is the tightest peel radius, 0.17 world units, times 0.24, so each lattice edge stays short enough to follow the tightest curl. The face also reuses the outline vertices of the walls bit for bit, so the rim stays welded together when it curls and no crack opens along it.

```js
const del = new Delaunator(coords);
const con = new Constrainautor(del);
con.constrainAll(edges);

// Flood fill from the hull: crossing a rim edge flips inside/outside.
while (queue.length) {
	const t = queue.pop();
	for (let k = 0; k < 3; k++) {
		const e = t * 3 + k;
		const opp = halfedges[e];
		if (opp === -1) continue;
		const nt = Math.floor(opp / 3);
		if (parity[nt] !== -1) continue;
		parity[nt] = parity[t] ^ (con.isConstrained(e) ? 1 : 0);
		queue.push(nt);
	}
}
```

## The foil is a physical material with a thin film on top

With the geometry built, the sticker needs a surface. Both layers, the base and the raised lettering, use three.js MeshPhysicalMaterial, the material that models real surfaces most completely. It is set to fully metallic, with a clearcoat on top that acts like the lacquer on a printed foil, and with thin-film iridescence. Thin-film iridescence is the effect behind the colours on a soap bubble or an oil slick: light reflects from the top and the bottom of a transparent layer measured in nanometres, the two reflections interfere, and the colour you see depends on the thickness of the layer and the angle of the view. The page states that the foil is "a physical material with thin-film iridescence".

The base layer uses a film of 120 to 480 nanometres with an index of refraction of 1.32. The lettering uses a thicker range, 140 to 860 nanometres with an index of 1.28, so the raised letters shift through a wider band of colours than the backing as you tilt the sticker. Both layers carry a 256 by 256 grain texture, scaled up to repeat 2.2 times, that roughens the metal a little so it reads as a foil sheet and not as a perfect mirror. The lettering also gets a gentle bump from the same texture.

Four foils share these two materials. Choosing one changes the colour, the roughness, the amount of iridescence and the light the metal reflects, and the base layer is set a little darker and rougher than the lettering so the raised mark stands out from its backing.

| Setting | Base layer | Raised mark |
|---|---|---|
| Metalness | 1 | 1 |
| Clearcoat | 1 | 1 |
| Clearcoat roughness | 0.12 | 0.18 |
| Film index of refraction | 1.32 | 1.28 |
| Film thickness range (nm) | 120 to 480 | 140 to 860 |
| Environment intensity | 1.9 | 2.2 |
| Colour | foil colour at 70% | foil colour |
| Roughness | foil roughness + 0.06 | foil roughness |

In the code, the clearcoat roughness is 0.12 on the base and 0.18 on the lettering, and the environment light is scaled by 1.9 on the base and 2.2 on the lettering.

| Foil | Colour | Roughness | Iridescence | Light blobs |
|---|---|---|---|---|
| Rainbow holo | 0x9aa1a8 | 0.16 | 1 | 6 |
| Chrome | 0xd7dde3 | 0.07 | 0.18 | 4 |
| Gold foil | 0xd8ae4e | 0.2 | 0.35 | 4 |
| Neon | 0x8f96b3 | 0.14 | 1 | 4 |

![The word $THREE cut as a sticker in the four foils, Rainbow holo, Chrome, Gold foil and Neon, in a two by two grid on black](/x-media/holo-material-article/foils.png)

## The light the foil reflects is painted on a 1024 by 512 canvas

A metal surface shows what is around it, so a sticker alone on black would look dull however good the material is. The page paints a small world for the foil to reflect, again on a 2D canvas, 1024 pixels wide and 512 tall, in the equirectangular layout three.js reads as a full panorama. The canvas starts as a dark blue-grey. Eight soft radial blobs of colour are added on top of it at fixed seats, blended additively, so where blobs overlap their colours move toward white the way stacked stage lights do. Then three soft white bands are drawn across it, which are the softboxes a product photographer places to give foil its streak of sheen.

The seats are fixed, not random, so the same foil gets the same light on each load. Each foil supplies its own blob colours: six for Rainbow holo, four for each of the other three. The environment canvas is filtered once per foil through three.js PMREMGenerator, which pre-blurs the panorama at a ladder of roughness levels so a rougher metal reflects a softer picture, and the result is cached, so switching back to a foil already seen costs nothing.

A key light of intensity 1.7 and a pale blue rim light add direct highlights on top, the tone mapper is ACES Filmic at an exposure of 1.3, and the camera looks at the sticker through a 34 degree field of view from 7.4 units away, which is a long-lens framing that keeps the sticker flat and graphic instead of stretched at the edges.

## The peel is a cylinder roll inside the vertex shader

The corner that lifts is the detail people remember. It is not an animation clip and not a second model. It is a few lines of GLSL injected into the material with onBeforeCompile, which lets the page edit the shader three.js generates and keep everything else, including the iridescence and the clearcoat, exactly as written.

The idea is the one a real sticker follows. Pick a fold line across the corner. Everything on the sheet side of the line stays flat. Everything beyond the line is wrapped around a virtual cylinder, so a point at distance t past the fold turns through an angle of t divided by the radius. The page computes that angle for each vertex on the GPU, moves the vertex around the cylinder, and rotates its normal by the same angle in a second injected block. The second block matters most: because the normals turn with the surface, the light on the curled lip is computed for the curled lip, so the underside catches the environment and the outer curve brightens as it would on foil in a hand.

Three numbers shape the roll. The radius grows with the peel amount, from 0.17 world units at a flat sticker up to 0.35 at full peel, so a small lift curls tightly and a large one opens into a gentle roll. The angle is capped at 1.22 times pi, about 220 degrees, past which the rest of the sheet continues straight along the tangent. The fold line moves in from the corner as the Corner peel slider rises, and the default is 30%. A slow breathing term of 0.028 is added to the peel on each frame, so the corner stays gently alive even when you are not touching anything.

```glsl
float tP = dot(transformed.xy, uFoldN) - uFoldT;
if (tP > 0.0) {
	float phi = min(tP / uRadius, uMaxPhi);
	float rest = max(tP - uRadius * uMaxPhi, 0.0);
	float s = sin(phi), c = cos(phi);
	float rz = uRadius - transformed.z;
	vec2 atFold = transformed.xy - uFoldN * tP;
	transformed.xy = atFold + uFoldN * (rz * s + rest * c);
	transformed.z = uRadius - rz * c + rest * s;
}
```

![The chevron sticker in Rainbow holo foil shown three times, from flat through a half peel to a fully rolled corner, with the light changing on the curled lip](/x-media/holo-material-article/peel.png)

## Tilt, keys, reduced motion and the PNG share one render loop

All of this runs in one frame function. The sticker group chases the pointer with a spring: each frame it moves 9% of the remaining distance toward the target angle, which gives the tilt a short, soft follow-through instead of a snap. Moving the pointer over the stage tilts it by up to 0.42 radians sideways and 0.34 up and down, dragging gives full control at 2.4 times the pointer movement, and leaving the stage settles it back to flat.

Keyboard users get the same control. The arrow keys tilt the sticker in steps of 0.12 radians, clamped to 1.1 radians, so the stage works without a pointer. The page also reads the reduced motion preference, and when it is set the idle wobble, the floating and the peel breathing are all switched off while tilt and the sliders keep working.

Download PNG renders one more frame and saves the canvas as holo-sticker.png, so the file is the exact pixels on the screen at the page's pixel ratio, which is capped at 2 to keep the frame fast on dense displays. Reset returns the tilt to flat and the peel to 30%.

The code that does all of this is one file of under 800 lines, plus the geometry module, and the page needs WebGL. The mesh is rebuilt when the mark changes, so a new word costs one pass through the pipeline above, and the render loop afterwards moves uniforms.

## Open work this sticker stands on

The sticker is built from open work, and each piece is credited here with its licence.

- **Three.js** is the 3D library under the page: the WebGL renderer, MeshPhysicalMaterial with its iridescence, PMREMGenerator, ExtrudeGeometry and the shape classes. It is released under the MIT licence and developed in the open on GitHub.
- **Delaunator** builds the Delaunay triangulation for the flat faces. It was written by Vladimir Agafonkin at Mapbox, is released under the ISC licence and is published on npm.
- **Constrainautor** by Marco Gunnink, an npm package that forces the outline edges into that triangulation so the mesh follows the die-cut line exactly. It is released under the ISC licence.
- **Marching squares** is a long-published family of contour-tracing algorithms, the two-dimensional relative of marching cubes, which Lorensen and Cline presented at SIGGRAPH. The page implements it from the published idea with its own fixed saddle rule.
- **Chaikin corner cutting** is the curve-subdivision scheme published by George Chaikin in Computer Graphics and Image Processing. It is the three-pass smoothing step above.
- **Inter** is the typeface the text mark is set in, released by Rasmus Andersson under the SIL Open Font License.

## The partners behind the Holo Sticker
three.ws builds alongside eight partners across AI, cloud, hardware, infrastructure and media. Each is an independent company, and each line below is taken from how [three.ws/partners](https://three.ws/partners) describes the partner.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The 3D Studio connector gives ChatGPT eleven keyless 3D tools.

**IBM.** The partners page lists IBM as a Strategic partner: three.ws 3D agent identity integrates with IBM watsonx and IBM Granite.

**Amazon Web Services.** The partners page lists Amazon Web Services under Cloud: three.ws is deployed on AWS infrastructure with Marketplace availability.

**Google Cloud.** The partners page lists Google Cloud under Cloud: its Vertex AI integration lets agents leverage Gemini models alongside the three.ws identity layer.

**Alibaba Cloud.** The partners page lists Alibaba Cloud under Cloud: it extends three.ws into APAC markets with Qwen model integration.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's program for startups building on accelerated computing. Every 3D generation lane already runs on NVIDIA silicon.

**HackerNoon.** The partners page lists HackerNoon under Media: a builder-focused publishing partnership, with articles published to HackerNoon's developer audience.

**Quicknode.** three.ws is a member of the Quicknode Startup Program with approved infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind agent wallets.

## Try it

The sticker is live at [three.ws/holo](https://three.ws/holo): pick Chevrons, $THREE, three.ws or Your text, choose a foil, drag the sticker to tilt it, move the Corner peel slider, and press Download PNG to keep it. Type a word of up to 16 characters to cut your own, and try one with holes in the letters. The same raster-and-trace idea drives other pages on the platform, and the [partners page](https://three.ws/partners) lists the programmes behind it.
