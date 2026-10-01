Type a word of up to 16 characters into the sticker page and it comes back as a die-cut foil sticker: a cut line with a margin and rounded corners, holes inside the letters, and a film of colour that shifts as you tilt it. No image or model file is downloaded to draw it. The page draws the word, cuts it, traces it back into outlines and lights it, and the code that does all of it is one file of under 800 lines.

This is how each of those steps works, with the numbers the code uses.

![The Holo Sticker page on three.ws: the default chevron sticker in rainbow foil on a black stage, beside the controls for the mark, the foil, the corner peel and the PNG download](/x-media/holo-material-article/page.png)

## Draw the mark, then grow it the way a cutter does

Everything starts as white pixels on a 640 by 640 canvas that stays off screen. Text is set at weight 900, starting at 36% of the canvas height and shrunk until it fits inside a 10% margin. The default mark is three slanted bars, and each slant is 45 degrees so the notches between the bars come out crisp.

A real sticker cutter does not follow the edge of the ink. It runs a fixed distance outside it. The page does the same with a dilation by a disc: it stamps the mark 48 times around a circle of radius 28 pixels, which is 4.4% of the canvas, and once more in the centre. Each edge moves out by the same distance, outside corners come back rounded, and shapes that sit closer than twice that radius merge into one backing. That merge is why a word comes out as one sticker instead of a handful of loose letters.

![The typed word geode cut into a sticker in gold foil: one rounded backing behind all five letters, and raised letters whose counters are holes, so the backing shows through the g, e, o and d](/x-media/holo-material-article/geode.png)

## Trace the pixels back into outlines

Pixels cannot be extruded into 3D, so both the mark and its grown backing are traced back into vector outlines with marching squares. The tracer reads the alpha channel, counts a pixel as inside when it is over half opaque, and walks the image in 2 by 2 cells. Each cell is one of 16 cases, and each case says which cell edges the outline crosses. Two of those cases are saddles, where the corners alternate, and they can be joined two ways. The code fixes one pairing, so each edge midpoint touches exactly two segments and stitching a loop together cannot fork.

Each closed loop is then smoothed with three rounds of corner cutting, which replaces each edge with points at a quarter and three quarters of its length, and points closer than 1.4 pixels are dropped. Loops under 30 square pixels are thrown away as specks.

Holes come from counting. The loops are sorted by area, and each one counts how many larger loops contain it. An even count is an outline. An odd count is a hole in the outline around it. The inside of an o is contained by one loop, so it is cut out of the raised letter; an island inside that hole would be contained by two, and would be solid again. On the backing, the dilation has usually filled small counters already, which is why the backing shows through the letter rather than leaving a hole in the sticker.

Both sets of outlines are scaled so the cut is 3.1 units wide, with the same transform, so the mark lands exactly on its backing. Then they are extruded: the backing 0.028 units thick with a 0.016 bevel, the mark 0.05 thick with a 0.02 bevel, raised just above it. A last pass bows the whole sheet with three sine waves, the tallest 0.038 units high, and tilts the normals to match. A real sticker is not perfectly flat either, and that slight bow is what smears the reflections into gradients across each face.

## A foil is a material, not a texture

There is no foil image anywhere. Both surfaces use a physical material that is fully metallic, with a clear coat on top, and the colour shift is thin-film iridescence: light reflecting off the top and bottom of a thin transparent layer interferes with itself, which is what makes a soap bubble change colour as it turns. The renderer computes it from the film's refractive index and thickness. The backing's film has an index of 1.32 and a thickness range of 120 to 480 nanometres. The raised mark uses 1.28 and 140 to 860, a different film from its backing. A 256 pixel noise texture roughens both surfaces slightly, so the result reads as foil rather than a mirror.

A metal has almost no colour of its own. It shows you what is around it, so the light matters more than the material. That light is painted when the page loads, into a 1024 by 512 canvas: soft colour blobs at eight fixed positions, blended additively so overlaps run toward white the way stage lights do, plus three white bands that play the part of studio light panels. The canvas is then blurred ahead of time at several strengths, so rough surfaces reflect a softer version of it.

Each of the four foils is just a palette for that light, a base colour, a roughness and an iridescence strength. The rainbow and neon foils run iridescence at full strength, gold at 0.35 and chrome at 0.18. Switching foil swaps the light and the numbers and leaves the geometry alone. The blobs sit in fixed places, so a reload gives you the same sticker.

![The same $THREE sticker in all four foils, tilted to the same angle: Rainbow holo, Chrome, Gold foil and Neon](/x-media/holo-material-article/foils.png)

## The peel happens in the vertex shader

The peeling corner is not a separate model. Before the material compiles, the page injects a few lines into its vertex shader. A fold line runs at 45 degrees across one corner, and each vertex past it is wrapped around a virtual cylinder: the angle is the vertex's distance past the fold divided by the radius, capped at 1.22 half turns, about 220 degrees, after which the sticker carries on straight. The radius grows as you peel, from 0.17 units at rest by another 0.18 at full peel. The normals are rotated through the same angle, so the light on the curled lip is computed for the surface as it is bent, not painted on.

The corner rests at 30% and breathes by 2.8% either way, and the sticker drifts slightly, unless your system asks for reduced motion, in which case both stop. Tilt follows the pointer through a spring, a drag gives full control, and the stage takes focus so the arrow keys tilt it too.

## What it does not do yet

- **One line of text, up to 16 characters.** There is no wrapping and no font choice.
- **The download is a picture.** Download PNG saves the frame you are looking at. There is no vector cut file and no 3D export of the sticker yet.
- **It needs WebGL.** Without it the page says so instead of drawing.

The sticker is at three.ws/holo. Drag it to tilt it, or click the stage and use the arrow keys.
