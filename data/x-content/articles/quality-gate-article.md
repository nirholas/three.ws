A model that the platform generates for its own catalog has to clear a structural gate before anyone sees it, and the Model Inspector runs that same gate, the same module with the same thresholds, against any .glb you give it. Its companion, Model Diff, compares two versions of a model and names what went missing: the joints, the clips, the meshes. Between them they answer the two questions a 3D pipeline keeps asking: whether a file is good enough to publish, and whether a change broke something that depends on it.

## One module, two callers

The gate lives in a single file, `seed-mesh-gate.js`. The seeding job that fills the catalog imports it, and so does the inspector page. There is no second copy of the rules for the browser, and no API that might drift from them. A threshold change lands in both places at once because there is only one place.

That only works because the gate reads nothing but the glTF JSON chunk. It needs no renderer and no network, so it runs entirely in the browser: nothing is uploaded, and the verdict appears without a round trip. A build check walks the real bundler graph from the page and fails the moment a Node built-in becomes reachable, which is what keeps the shared module loadable in both places.

Every verdict carries a gate version, because an accept rate is only comparable within one version of the rules.

## What the bar measures

The structural gate is five checks, and the inspector shows each one with what it measured, the bound it was held to, and why the bound exists:

- Geometry density: between 1,500 and 1,500,000 vertices.
- File weight: between 20 KB and 80 MB.
- Surface texture: at least one.
- Bounds: the bounding box must have some extent, because a collapsed mesh passes every triangle count and still draws as a speck.
- Assembly: a character may arrive as at most 8 meshes. A prop is exempt, since a prop can legitimately be a loose collection of parts.

A failed check comes with the fix, written next to the rule it explains, so the guidance cannot drift from the rule.

The texture rule is deliberately stricter than the interactive Forge. Someone who generates an untextured mesh chose to. A visitor browsing the catalog chose nothing, and an entry there is the platform vouching for itself.

![The Fox sample on the Model Inspector: it clears the catalog bar with 1,728 vertices against a floor of 1,500, one texture and one mesh, and is reported rigged with 24 joints](/x-media/quality-gate-article/inspect-fox.png)

Fox is the sample labelled "Passes, barely" for a reason. It clears the density floor of 1,500 with 1,728 vertices, and a passing check still prints its numbers, which tells a creator how much headroom they have instead of a bare yes.

The gate is the first of two stages. On the catalog path a vision model then renders the mesh and scores whether it looks like what was asked for. That stage needs a renderer and a model call, so the page runs only the structural half and says so.

## Diffing two models by what they mean

Byte comparison cannot tell a lossless recompression from a rig that quietly lost joints. Model Diff reads both files and builds a structural description of each: scenes, nodes, meshes, materials, textures, skeletons and animation clips. Then it pairs objects across the two the way git pairs renamed files: by name first, then by a hash of the content, then by similarity. Anything still unpaired is a real addition or removal.

Vertex data is compared at a quantum of 1e-4 units, so the float drift of a re-export does not register while a genuine edit does.

Every change set carries one severity: none, cosmetic, minor, major or breaking. The ladder is ordered by what a consumer of the model notices, not by how many bytes moved. A texture swap is minor because everything still loads and plays. Breaking means something a consumer references by name is gone: a clip, a joint, a mesh. That is the failure that renders fine and never moves, because a clip addresses joints by name and a missing joint is a silent no-op rather than an error anyone sees.

![Model Diff comparing the X Bot sample with Michelle: one skeleton lost the joints mixamorig:LeftEye and mixamorig:RightEye, and five clips are gone (agree, idle, run, sneak_pose and walk), each with its duration](/x-media/quality-gate-article/diff-detail.png)

The example pair on the page puts the X Bot sample before Michelle. The skeleton section names the two eye joints that are gone and says clips addressing them will not play. The animation section lists the five clips that no longer exist, with their lengths. That is a change set a person can act on.

## The same engine in a build

The page, a command line tool and a free HTTP endpoint all run the same published package, so a verdict in CI cannot disagree with what the page shows.

```bash
npm install --save-dev @three-ws/glb-diff meshoptimizer
npx glb-diff base.glb candidate.glb --fail-on breaking

# or, with no install, a report sized for a pull request comment
curl "https://three.ws/api/3d/diff?a=<url-a>&b=<url-b>&format=markdown"
```

The exit codes are the contract a pipeline depends on. Zero means the diff ran and stayed below the threshold you set with `--fail-on`, one means the severity reached it, and two means the tool could not run at all: a bad argument, an unreadable file. A tool that returned one for both "your model regressed" and "I could not open the file" would be useless in a pipeline.

The endpoint takes two public URLs and caps each side at 32 MB.

## What it does not do yet

The inspector judges structure, not taste. A model can clear every check and still look wrong; that judgment belongs to the vision stage, which does not run in the browser.

Rename detection is a similarity score, and on animation clips it can be fooled. Two clips that drive the same joints on the same rig score as close even when one is a head shake and the other is a dance, so the X Bot pair above also reports headShake as renamed to SambaDance. Treat a rename on a clip as a prompt to look, not a verdict.

The summary can also overstate a removal. When one of several skeletons disappears, the summary line says the model is no longer rigged even if another skeleton remains, as it does in this pair: Michelle still carries a full rig. The skeleton section underneath is the accurate record.

The similarity pass is skipped when two models would need more than 40,000 comparisons, and the result says so rather than quietly turning renames into additions and removals.

Most avatars on the platform ship with compressed geometry. The browser page decodes it, but the command line tool needs the optional `meshoptimizer` package installed next to it, which is why the install line above names both.

Both tools are free and run in your browser: the [Model Inspector](https://three.ws/inspect) and [Model Diff](https://three.ws/diff). The command line tool is [on npm](https://www.npmjs.com/package/@three-ws/glb-diff).
