A model that the platform generates for its own catalog has to clear a structural gate before anyone sees it, and the Model Inspector runs that same gate, the same module with the same thresholds, against any .glb you give it. Its companion, Model Diff, compares two versions of a model and names what went missing: the joints, the clips, the meshes. Between them they answer the two questions a 3D pipeline keeps asking: whether a file is good enough to publish, and whether a change broke something that depends on it.

This article follows two real runs. In the first, we open the Inspector, choose the Mannequin sample from our library and read its verdict. In the second, we hand Model Diff the X Bot sample and Michelle and read what the change removed. Every number below comes from one of those runs, from the source files that produce them, or from the live pages, so each one can be checked.

## One module, two callers

The gate lives in a single file, `seed-mesh-gate.js`. The seeding job that fills the catalog imports it, and so does the inspector page. There is no second copy of the rules for the browser, and no API that might drift from them. A threshold change lands in both places at once because there is only one place.

That only works because the gate reads nothing but the glTF JSON chunk. It needs no renderer and no network, so it runs entirely in the browser: nothing is uploaded, and the verdict appears without a round trip. A build check walks the real bundler graph from the page and fails the moment a Node built-in becomes reachable, which is what keeps the shared module loadable in both places.

Every verdict carries a gate version, because an accept rate is only comparable within one version of the rules.

## Five checks, each with its bound and its fix

The structural gate is five checks, and the inspector shows each one with what it measured, the bound it was held to, and why the bound exists:

| Check | Bound | Verdict label |
|---|---|---|
| Geometry density | 1,500 to 1,500,000 vertices | Geometry density |
| File weight | 20 KB to 80 MB | File weight |
| Surface texture | at least 1 | Surface texture |
| Bounds | the bounding box must have extent | Non-collapsed bounds |
| Assembly | at most 8 meshes for a character | Single assembled character |

Geometry density holds a model between 1,500 and 1,500,000 vertices, and file weight holds it between 20 KB and 80 MB. The reasons are written into the gate itself. Geometry density asks for a model dense enough to read as a real object, without so much geometry that the viewer stalls on a phone. File weight asks for an asset heavy enough to be a real textured model and light enough to load before a visitor gives up. A collapsed mesh passes every triangle count and still draws as a speck, which is why bounds have a check of their own. A character arriving as a dozen disconnected meshes is a scene, not a character, and it will not rig or animate as one body.

A prop is exempt from the assembly rule, since a prop can legitimately be a loose collection of parts. A failed check comes with the fix, written next to the rule it explains, so the guidance cannot drift from the rule. The inspector also reports whether the model is rigged and how many joints it carries, because a model that is built well and has no skeleton still cannot be animated.

## A verdict you can act on: the Mannequin

The Mannequin sample is labelled "Fails two rules" on the page, and it is the right model to start with, because a failing verdict teaches the bar faster than a passing one. Here is what the Inspector printed:

![The Mannequin sample on the Model Inspector: Below the bar, 2 checks short. Surface texture reads none against at least 1, and Single assembled character reads 22 meshes against at most 8. Geometry density, file weight and bounds pass, and the page says there is no skeleton and the model cannot be animated until it is rigged.](/x-media/quality-gate-article/inspect-mannequin.png)

The headline says two checks short, and it names them: surface texture and single assembled character. The Mannequin has no texture and arrives as 22 meshes against a limit of 8. The other three checks pass, and each still prints its measurement: 5,196 vertices inside the density range, a 238 KB file, and a bounding box 0.561 units across.

Under each failed check sits a short "How to fix" note. For texture it says to bake and embed at least a base-colour map before publishing. For assembly it says to join the parts into one mesh, or to switch the category to Prop, where loose parts are legitimate and the check does not apply. The page also reports that the model has no skeleton and cannot be animated until it is rigged, so the creator leaves with the full to-do list from one run.

Two buttons sit under the verdict. Copy verdict JSON puts the full report on your clipboard, so a result can be pasted into a ticket or a pull request. Copy shareable link builds an address that carries the model's URL, and opening it runs the same gate on the same file, so a teammate sees the verdict you saw rather than a description of it. The page also has a Character and Prop switch, which is how the assembly rule knows whether loose parts are expected.

## A clean pass, and a close call

Michelle is the sample labelled "A clean pass":

![The Michelle sample on the Model Inspector: Clears the catalog bar. Geometry density 16,340 vertices, file weight 830 KB, surface texture 4 textures, and a single assembled character at 1 mesh. The page also reports it rigged with 65 joints and ready to animate.](/x-media/quality-gate-article/inspect-michelle.png)

Every check prints a green mark and its number, and the rigged line reads 65 joints, ready to animate. A passing check keeps its measurement on screen because the number tells a creator how much headroom they have, which a bare yes cannot.

Fox shows what headroom looks like at the other end. It is labelled "Passes, barely" for a reason:

![The Fox sample on the Model Inspector: it clears the catalog bar with 1,728 vertices against a floor of 1,500, one texture and one mesh, and is reported rigged with 24 joints](/x-media/quality-gate-article/inspect-fox.png)

It clears the density floor of 1,500 with 1,728 vertices. The verdict is the same green as Michelle's, and the numbers show a creator exactly how close to the line the model sits.

## Why the bar is deliberately strict

The texture rule is deliberately stricter than the interactive Forge. Someone who generates an untextured mesh chose to. A visitor browsing the catalog chose nothing, and an entry there is the platform vouching for itself. The page puts it in one line: one melted blob on the storefront costs more trust than ten rejected generations cost compute.

The gate is the first of two stages. On the catalog path a vision model then renders the mesh and scores whether it looks like what was asked for. That stage needs a renderer and a model call, so the page runs the structural half, which measures whether a model is built well enough to publish, and leaves the question of whether it looks good to the vision stage. The two answer different questions, and keeping them apart is what lets the first one run on your machine.

## The gate from a script

The same verdict is one function call in the repository, which is how the seeding job uses it. This script runs the gate over the three samples we have just looked at, straight from the files in `public/avatars`, and prints each decision:

```js
import { readFile } from 'node:fs/promises';
import { gateMesh, SEED_GATE_VERSION } from './api/_lib/seed-mesh-gate.js';

for (const name of ['mannequin', 'michelle', 'fox']) {
	const bytes = await readFile(`public/avatars/${name}.glb`);
	const verdict = gateMesh(new Uint8Array(bytes), { category: 'avatar' });
	console.log(name, verdict.pass ? 'pass' : 'fail', verdict.reasons.join(', ') || '-', `${verdict.metrics.vertexCount} vertices`, `gate v${SEED_GATE_VERSION}`);
}
```

It prints one line per model, and the reason codes are the same ones the page turns into sentences:

```text
mannequin fail no_textures, too_many_meshes_for_a_character 5196 vertices gate v1
michelle pass - 16340 vertices gate v1
fox pass - 1728 vertices gate v1
```

A reason code never ships without an explanation: a test asserts that every code the gate can emit has a label, a reason and a fix, which is why the page has a sentence to show next to a failed check. The vertex counts match the pictures above, and the gate version printed on every line is what makes a stored verdict comparable with a later one.

## Diffing two models by what they mean

Byte comparison cannot tell a lossless recompression from a rig that quietly lost joints. Model Diff reads both files and builds a structural description of each: scenes, nodes, meshes, materials, textures, skeletons and animation clips. Then it pairs objects across the two the way git pairs renamed files: by name first, then by a hash of the content, then by similarity. Anything still unpaired is a real addition or removal.

Vertex data is compared at a quantum of 1e-4 units, so the float drift of a re-export does not register while a genuine edit does.

Every change set carries one severity: none, cosmetic, minor, major or breaking. The ladder is ordered by what a consumer of the model notices, not by how many bytes moved:

| Severity | What it means |
|---|---|
| none | The two models are structurally identical |
| cosmetic | Only metadata changed, nothing a renderer or a clip can observe |
| minor | Appearance changed, and the model still loads, animates and keeps its shape |
| major | Geometry or hierarchy changed, so anything positioned against the model should be re-checked |
| breaking | Something a consumer references by name is gone |

A texture swap is minor because everything still loads and plays. Breaking means a clip, a joint or a mesh that something else points at has disappeared. That is the failure that renders fine and never moves, because a clip addresses joints by name and a missing joint is a silent no-op rather than an error anyone sees.

## A real pair: X Bot to Michelle

Here is the diff for the pair we ran, as the free endpoint reports it. The headline is the severity, and the table underneath gives the totals before and after:

```text
### 3D diff: xbot.glb to michelle.glb

breaking: Something a consumer references by name is gone.

- Skeleton "Character" lost 2 joint(s): mixamorig:LeftEye, mixamorig:RightEye.
- 5 animations were removed ("agree", "idle", "run" and 2 more).
- Triangle count is down 21,006 (-42.8%).

| metric     | before | after  | delta   |
| ---------- | -----: | -----: | ------: |
| meshes     |      2 |      1 |      -1 |
| animations |      7 |      2 |      -5 |
| joints     |    134 |     65 |     -69 |
| triangles  | 49,112 | 28,106 | -21,006 |
```

![Model Diff comparing the X Bot sample with Michelle: one skeleton lost the joints mixamorig:LeftEye and mixamorig:RightEye, and five clips are gone (agree, idle, run, sneak_pose and walk), each with its duration](/x-media/quality-gate-article/diff-detail.png)

The skeleton section names the two eye joints that are gone and says clips addressing them will not play. The animation section lists the five clips that no longer exist, with their lengths. That is a change set a person can act on: it says which joints, which clips and how long they were, so the owner of a consumer can search for exactly those names.

Rename pairing adds a pointer on top. Four objects kept their content and changed name, and the report lists each pair with the sign R. The pairing of clips is a similarity score over the joints they drive and their duration, which makes it an excellent prompt to look: on this pair headShake pairs with SambaDance because both drive the same rig, and the report lists the clip's changed duration and channel counts underneath, so you can open both clips and decide. The skeleton section underneath the summary line is the full record of what remains rigged and what does not.

## The same engine in a build

The page, a command line tool and a free HTTP endpoint all run the same published package, so a verdict in CI cannot disagree with what the page shows.

```bash
npm install --save-dev @three-ws/glb-diff meshoptimizer
npx glb-diff base.glb candidate.glb --fail-on breaking

# or, with no install, a report sized for a pull request comment
curl "https://three.ws/api/3d/diff?a=<url-a>&b=<url-b>&format=markdown"
```

The command line tool takes four options, and each one maps to a place a diff gets read:

| Option | What it does |
|---|---|
| `--json` | Prints the full change set as JSON for a script to read |
| `--markdown` | Prints a Markdown report sized for a pull request comment |
| `--fail-on <level>` | Exits with 1 once the severity reaches that level |
| `--verbose` | Includes unchanged totals in the table |

The severity ladder is what makes `--fail-on` useful. A texture swap should not fail a build, and a deleted bone that animation clips target should. Setting `--fail-on major` also stops geometry and hierarchy changes, for a team that wants a person to look at those before they merge, while `--fail-on breaking` stops only what would break a consumer.

The exit codes are the contract a pipeline depends on:

| Code | Meaning |
|---|---|
| 0 | The diff ran and stayed below the threshold set with `--fail-on` |
| 1 | The diff ran and the severity reached it |
| 2 | The tool could not run: a bad argument, an unreadable file, an unparseable model |

A tool that returned one for both "your model regressed" and "I could not open the file" would be useless in a pipeline, which is why two exists. The endpoint takes two public URLs and caps each side at 32 MB.

The same call is a library function, so a script can decide for itself. This snippet fails a build when a candidate is breaking and prints the report either way:

```js
import { readFile } from 'node:fs/promises';
import { diffModels, formatMarkdown } from '@three-ws/glb-diff';

const before = await readFile('avatar.v1.glb');
const after = await readFile('avatar.v2.glb');

const changes = await diffModels(before, after, { nameA: 'v1', nameB: 'v2' });
console.log(formatMarkdown(changes));

if (changes.severity === 'breaking') process.exit(1);
```

The function takes bytes, so the same call works in Node, in a worker, in a serverless handler and in a browser. That is how the Model Diff page runs it with nothing uploaded.

## Open work, credited

Model Diff stands on open work. It reads glTF through glTF-Transform, the open source toolkit for loading, inspecting and transforming glTF files, and uses its core and extensions packages. Most avatars on the platform ship with compressed geometry, and meshoptimizer is the open library that decodes it. The browser page decodes it for you, and the command line tool uses meshoptimizer as an optional peer package installed next to it, which is why the install line above names both. The package itself is released under the Apache-2.0 licence.

## What is next

The Inspector and the diff each answer one question precisely, and the next steps join them up. A rendered check from the GPU-free renderer package can sit beside the structural verdict, so a pull request shows the numbers and a picture. The similarity pass is bounded at 40,000 comparisons, and the result says when a pair of models was large enough to use the bound, so a large pair gets a clear statement instead of silent noise. Beyond that, the gate version on every verdict lets the thresholds move as the catalog grows, with each change visible as a new version.

Used together, the two tools make a small habit. Before a model goes into the catalog, run it through the Inspector and read the numbers, including the passing ones, because the margin on each check tells you how much room a later edit has. When a new version of that model comes back from an artist or an exporter, diff it against the last good one before it replaces the file, so the joints, clips and meshes that other things point at are accounted for by name. The Inspector protects the catalog from a model that was never good enough, and the diff protects everything downstream from a model that used to be.

## The partners behind the quality gate

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as three.ws/partners states it. The full map is at [three.ws/partners](https://three.ws/partners).

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The Inspector and the diff are free and run in the browser, so a model can be checked before it goes anywhere.

**IBM.** IBM is listed in the Strategic tier of the partner map. three.ws agent identity integrates with IBM watsonx and IBM Granite.

**Amazon Web Services.** three.ws is deployed on AWS infrastructure with Marketplace availability.

**Google Cloud.** Google Cloud powers three.ws inference, storage and real-time serving.

**Alibaba Cloud.** Alibaba Cloud extends three.ws into APAC markets with Qwen model integration and regional MCP server deployment, with low-latency inference close to users in Asia.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's program for startups building on accelerated computing.

**HackerNoon.** three.ws has a builder-focused publishing partnership with HackerNoon: feature articles, tutorials and developer guides for people shipping with AI, published to HackerNoon's developer audience.

**Quicknode.** three.ws is a member of the Quicknode Startup Program with approved infrastructure credits.

## Try it

Both tools are free and run in your browser. Give a .glb to the [Model Inspector](https://three.ws/inspect) to see whether it would make it into the catalog, or choose Mannequin to see a failing verdict. Open [Model Diff](https://three.ws/diff) to compare two versions of a model, and try the [X Bot to Michelle pair](https://three.ws/diff?a=/avatars/xbot.glb&b=/avatars/michelle.glb). The command line tool is [on npm](https://www.npmjs.com/package/@three-ws/glb-diff), and the diff endpoint answers a [live request for the X Bot to Michelle pair](https://three.ws/api/3d/diff?a=https://three.ws/avatars/xbot.glb&b=https://three.ws/avatars/michelle.glb&format=markdown).
