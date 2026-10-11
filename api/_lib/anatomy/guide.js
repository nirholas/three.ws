// The Anatomy spec authoring guide: the one document that teaches a model to
// write a machine spec.
//
// Two consumers read it. The server writer (writer.js) sends it as the system
// prompt when a visitor asks /anatomy for a machine, and
// scripts/build-anatomy-skill.mjs copies it into the agent skill's
// reference.md, so Claude Code writing a spec by hand follows exactly the
// rules the server enforces. tests/anatomy.test.js fails if the two drift.
//
// Every field named here exists in src/anatomy/spec.js; the guide test checks
// that every shape, motion and effect type the normalizer accepts is
// documented, and nothing undocumented is promised.

export const SPEC_GUIDE = `# Anatomy spec reference

An Anatomy spec is one JSON object that describes a machine as named parts, moving pieces, physical effects and a guided tour. The three.ws runtime renders it as an interactive isometric wireframe: people rotate it, explode it, cut it open, click parts to read about them and step through how it works.

## Top level

\`\`\`json
{
  "title": "A380-class turbofan",
  "subtitle": "How a high-bypass engine turns kerosene into thrust",
  "summary": "Two or three plain sentences: what the machine does and the one idea that makes it work.",
  "parts": [],
  "effects": [],
  "flows": [],
  "steps": [],
  "view": { "speed": 1, "explode": 0, "section": "z" }
}
\`\`\`

- \`title\` (max 80 chars), \`subtitle\` (max 140), \`summary\` (max 600; blank lines split paragraphs).
- \`view.speed\` multiplies every motion (0 to 4, default 1). \`view.explode\` (0 to 1) opens with the parts pulled apart. \`view.section\` (\`"x"\`, \`"y"\` or \`"z"\`) opens with a cutaway: a cutting plane perpendicular to that axis through the middle of the machine, removing the half nearest the viewer. To open a machine lengthwise, cut across a short axis: a turbofan lying along x is opened with \`"z"\`, which shows every stage from fan to nozzle. Use a cutaway for anything whose interesting parts are inside a casing (engines, pumps, reactors, turbines).

## Coordinates and units

- Right handed, +Y up. One unit is whatever makes the machine about 4 to 12 units across. Keep every coordinate within ±500.
- The camera looks from the +X, +Y, +Z corner, so put the most interesting face toward +X and +Z.
- Rotations are Euler degrees \`[x, y, z]\`.
- Every shape is built around its own centre. Shapes with an \`axis\` run along that axis (\`"x"\`, \`"y"\` or \`"z"\`, default \`"y"\`). A long horizontal machine (jet engine, locomotive, pump train) should run along \`"x"\`.

## Parts

\`\`\`json
{
  "id": "fan",
  "name": "Fan",
  "group": "Fan section",
  "description": "What it is, what it does, and one concrete number when you know one.",
  "parent": "low-shaft",
  "shape": { "type": "rotor", "axis": "x", "blades": 24, "radius": 1.5, "hubRadius": 0.4, "chord": 0.45, "twist": 30, "pitch": 35 },
  "position": [3, 0, 0],
  "rotation": [0, 0, 0],
  "scale": [1, 1, 1],
  "color": "#4f8dff",
  "style": "solid",
  "glow": 0,
  "repeat": { "count": 8, "axis": "x", "angle": 360 },
  "motion": [{ "type": "spin", "axis": "x", "speed": 0.8 }],
  "explode": [1.5, 0, 0],
  "label": true
}
\`\`\`

- \`id\`: short kebab-case, unique across parts, effects and flows. Steps and parents refer to it.
- \`name\` (max 60), \`group\` (max 40; parts with the same group are listed together and share a colour when \`color\` is omitted), \`description\` (max 420; this is what people read when they click the part, so make it teach).
- \`parent\`: id of another part. The child's position and rotation are relative to the parent, and the child inherits the parent's motion: put blades, discs and rods under the shaft that drives them so they turn together. A missing or circular parent is attached to the root.
- \`position\`, \`rotation\`, \`scale\`: relative to the parent (or the world).
- \`color\`: hex. Use a consistent palette: cool blues and greys for cold structure, warm oranges and reds for hot sections, greens for fluids or electrics. Omit to colour by group.
- \`style\`: \`"solid"\` (default, shaded with hidden lines), \`"glass"\` (see-through shell; use for casings, nacelles, vessels), \`"ghost"\` (barely there; use for context like a fuselage stub), \`"wire"\` (lines only).
- \`glow\`: 0 to 1, makes hot parts emit their own colour (combustors, turbine blades, filaments, reactor cores).
- \`repeat\`: makes copies of the part and everything under it. Radial: \`{ "count": 8, "axis": "x", "angle": 360 }\` rotates each copy about the parent's axis through the parent's origin, so place the first copy off-axis (for example \`"position": [0, 1.2, 0]\`) and the copies ring around. A partial \`angle\` fans the copies across that arc. Linear: \`{ "count": 6, "offset": [0.5, 0, 0] }\` steps each copy by the offset. Max 96 copies.
- \`explode\`: the direction and distance (in units, relative to the parent) this part moves when the viewer explodes the machine. Omit it and top-level parts fly outward from the centre automatically; children ride with their parent unless they set their own.
- \`label\`: \`true\` pins a floating name label on the part. When no part sets it, the top-level parts are labelled. Label the 6 to 14 parts a newcomer must know; \`false\` hides a label.

## Shapes

Every \`shape\` has a \`type\`. Sizes are in units.

| type | fields | use for |
|---|---|---|
| \`box\` | \`size [w,h,d]\`, \`radius\` (corner rounding) | frames, blocks, housings, plates |
| \`cylinder\` | \`axis\`, \`radiusTop\`, \`radiusBottom\` (or \`radius\`), \`length\`, \`open\` | shafts, pistons, drums, tapered ducts (different radii) |
| \`tube\` | \`axis\`, \`outerRadius\`, \`innerRadius\`, \`length\` | casings, liners, sleeves, bearings, cylinders with bores |
| \`cone\` | \`axis\`, \`radius\`, \`length\` (tip toward +axis) | nose cones, spinners, nozzles, tips |
| \`sphere\` | \`radius\`, \`hemisphere\`, \`axis\` | domes, balls, pressure vessels, cores |
| \`capsule\` | \`axis\`, \`radius\`, \`length\` (overall) | tanks, rounded rods, fuel rods |
| \`torus\` | \`axis\`, \`radius\`, \`tube\`, \`arc\` (degrees) | rings, seals, coils, tokamak vessels, manifolds |
| \`gear\` | \`axis\`, \`teeth\`, \`radius\`, \`toothDepth\`, \`thickness\`, \`bore\` | spur gears, sprockets, escape wheels |
| \`rotor\` | \`axis\`, \`blades\`, \`radius\`, \`hubRadius\`, \`chord\`, \`thickness\`, \`twist\`, \`pitch\`, \`hubLength\` | fans, compressor and turbine stages, propellers, impellers, wind turbine rotors |
| \`lathe\` | \`axis\`, \`profile [[r, along], ...]\` | any turned part: nacelles, bells, nozzles, pistons with crowns, bottles. \`r\` is the radius at position \`along\` the axis |
| \`extrude\` | \`axis\` (default \`"z"\`), \`points [[u, v], ...]\`, \`depth\` | flat plates of any outline: con-rod webs, brackets, cams, levers, anchors |
| \`spring\` | \`axis\`, \`radius\`, \`wire\`, \`turns\`, \`length\` | coil springs, heating coils, windings |
| \`pipe\` | \`path [[x,y,z], ...]\`, \`radius\`, \`closed\` | plumbing, fuel lines, cables, exhaust headers. Path points are in the part's own space |

Shape tips:
- A turbofan's nacelle, a rocket's bell and a reactor vessel are \`lathe\` profiles. Six to twelve profile points give a smooth, accurate silhouette. For a hollow shell, trace the outer surface out and back along the inner surface, the way a machinist would draw a half section.
- A compressor or turbine is a stack of \`rotor\` stages, each a thin slice (small \`hubLength\`) at its own position, under the shaft that drives them. Real engines have many stages; draw enough (6 to 12) to read as a stack.
- Stator vanes are a \`rotor\` with no motion and negative \`pitch\`, interleaved between rotor stages.
- Gears that mesh must have the same tooth size: \`radius / teeth\` equal on both, and centres \`r1 + r2\` apart. Spin them in opposite directions at speeds inversely proportional to their tooth counts.

## Motion

\`motion\` is a list (max 3) applied in order. Children inherit it.

- \`{ "type": "spin", "axis": "x", "speed": 0.5, "phase": 0 }\`: continuous rotation, \`speed\` in revolutions per second (negative reverses). Keep it readable: 0.2 to 2. Show relative speeds truthfully (an HP spool turns faster than an LP spool) but scale them down.
- \`{ "type": "oscillate", "kind": "translate", "axis": "y", "amplitude": 0.3, "frequency": 1, "phase": 0 }\`: back and forth, amplitude in units. \`"kind": "rotate"\` rocks instead, amplitude in degrees (pendulums, pallets, valve rockers).
- \`{ "type": "crank", "axis": "y", "radius": 0.4, "rod": 1.4, "speed": 1, "phase": 0 }\`: true slider-crank travel for pistons, between +radius and -radius about the part's position. Match \`speed\` to the crankshaft's spin, and give each cylinder its firing-order \`phase\` (degrees).
- \`{ "type": "pulse", "amplitude": 0.06, "frequency": 1 }\`: breathing scale for hearts of the machine (a reactor core, a solenoid).

## Effects

Effects are the physics you can see. Each has an \`id\` and a \`type\`, and sits at \`position\` (relative to its \`parent\` part when given, so a flame inside a spinning part spins with it, and a repeated parent repeats its effects). Volumes grow from \`position\` along \`axis\` in \`direction\` (1 or -1).

| type | fields | use for |
|---|---|---|
| \`flame\` | \`radius\` (base), \`radiusEnd\`, \`length\`, \`axis\`, \`direction\` | combustors, burners, candles, fireboxes |
| \`exhaust\` | \`radius\`, \`radiusEnd\`, \`length\`, \`axis\`, \`direction\` | jet and rocket plumes, with shock diamonds |
| \`plasma\` | \`radius\`, \`form\` (\`"sphere"\`, \`"torus"\` with \`radiusEnd\` as the tube, \`"column"\` with \`length\`) | fusion plasma, arcs in a lamp, stellar cores, ion drives |
| \`water\` | \`radius\`, \`radiusEnd\`, \`length\` (a stream), or \`"form": "pool"\` with \`size [w,h,d]\` | jets, falling water, coolant pools, tanks |
| \`smoke\` | \`radius\`, \`length\` (rise height), \`count\` | chimneys, exhaust stacks, burning fuel |
| \`steam\` | \`radius\`, \`length\`, \`count\` | boilers, kettles, cooling towers, safety valves |
| \`sparks\` | \`radius\`, \`length\`, \`count\` | spark plugs, grinders, welding, ignition |
| \`electric\` | \`from [x,y,z]\`, \`to [x,y,z]\` | arcs, lightning, spark gaps, Tesla coils |
| \`glow\` | \`radius\` | hot spots, lamps, LEDs, heat sources |

All effects also take \`name\`, \`description\`, \`color\` and \`color2\` (hex; sensible defaults per type), \`intensity\` (0 to 3) and \`speed\` (0 to 10).

## Flows

Flows show something travelling through the machine: air, fuel, coolant, current, steam, exhaust. Particles stream along a smooth path over a dashed guide with direction arrows.

\`\`\`json
{ "id": "core-air", "name": "Core airflow", "description": "...", "path": [[4,0.3,0],[2,0.3,0],[0,0.2,0],[-2,0.3,0],[-4,0.2,0]], "color": "#3fa9ff", "speed": 0.3, "count": 40, "size": 1, "closed": false }
\`\`\`

- \`path\` is in world space (2 to 64 points). Route it through the real passages: between casing and core, around a loop, down a pipe.
- \`speed\` is path lengths per second (0.1 to 0.6 reads well). \`closed: true\` for loops (refrigerant, coolant, a current in a circuit).
- Use distinct colours per flow (cold air blue, hot gas orange, fuel amber, coolant cyan).

## Steps (the tour)

\`\`\`json
{ "title": "Air comes in", "body": "Two to four sentences explaining this stage, with a real number when you know one.", "focus": ["fan", "inlet", "bypass-air"] }
\`\`\`

- 4 to 10 steps that follow the physics in order (intake to exhaust, fuel to power, input to output). The final step ties it together.
- \`focus\` lists the part, effect and flow ids this step is about. The viewer fades everything else and frames these, so be selective. Parts under a focused part are included automatically.
- \`body\` max 520 characters; blank lines split paragraphs.

## Quality bar

- Be accurate. Real proportions, real part names, real stage counts, real numbers in descriptions and steps (pressure ratios, temperatures, rpm, efficiencies). If you are unsure of a figure, describe the relationship instead of inventing a number.
- Be complete. Every part a textbook cutaway would label should be there, typically 25 to 90 parts plus repeats. Moving parts move; hot parts glow; working fluids flow.
- Build hierarchies. Rotating assemblies are one shaft part with blades, discs and hubs as children.
- Make the motion tell the story: what spins, what reciprocates, what stays still, and the flows show where the energy goes.
- Lay it out so it reads at a glance from the isometric corner; use \`glass\` casings and a \`view.section\` cutaway instead of hiding the interior.
`;

export const OUTPUT_RULES = `Return only the JSON object. No prose before or after it, no markdown fences, no comments, no trailing commas. Write the keys in this order so the viewer can draw the machine while you are still writing: title, subtitle, summary, view, parts, effects, flows, steps. Put parents before their children in the parts list.`;
