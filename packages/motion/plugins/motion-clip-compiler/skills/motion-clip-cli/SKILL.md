---
name: motion-clip-cli
description: Generate a humanoid three.js AnimationClip JSON from a text prompt or a Motion Score with the @three-ws/motion CLI. Use when an avatar needs a new procedural animation (wave, nod, sit, crouch) and no mocap clip exists.
---

# Compile motion with @three-ws/motion

`@three-ws/motion` turns a short prompt, or a structured Motion Score, into a
`AnimationClip.toJSON()` document for any humanoid rig. It has zero
dependencies, needs no network and no API key, and is deterministic: the same
input gives the same clip.

## Run it

Node 18 or newer. The package is on npm and its bin is `three-ws-motion`:

```bash
npx -y -p @three-ws/motion three-ws-motion "wave hello twice, excitedly" -o wave.json
```

Without `-o` the clip JSON goes to stdout and a one-line summary to stderr.

## Options

| Flag | Effect |
| --- | --- |
| `-o, --out <file>` | write the clip to a file |
| `--score <file.json>` | compile a Motion Score instead of a prompt |
| `--name <name>` | clip name |
| `--loop` | close the last beat back into the first |
| `--effort <name>` | override the performance quality for every beat |
| `--no-idle` | drop the breathing and micro-sway layer |
| `--no-root` | drop the hip translation track (clip plays in place) |
| `--no-fingers` | drop finger bones |
| `--score-out <file>` | also write the score that produced the clip |
| `--quiet` | no stderr summary |
| `--schema` | print the Motion Score JSON Schema and exit |
| `--actions` | list actions the model-free prompt lane recognizes |

## Workflow

1. Run `--actions` to see the vocabulary. A prompt outside it fails with
   `unrecognized_motion` (exit code 2).
2. For a recognized action, pass the prompt directly. Add `--score-out
   score.json` to keep the score for editing.
3. For anything else, write a Motion Score yourself. Run `--schema` first and
   follow it exactly: every enum in the schema comes from the live vocabulary,
   so an invented word is rejected.
4. Compile it: `three-ws-motion --score score.json --no-idle -o clip.json`.
5. Warnings print on stderr as `  warning: ...`. Fix them and recompile.

## Motion Score shape

A score is `{ "name", "loop", "effort", "beats": [...] }`. A beat describes the
body at one instant: `posture`, `root`, `torso`, `arms` (per `left`/`right`: an
anchor `at`, offsets, `palm`, `hand`, `elbow`), `legs`, `gaze`, `face`, plus
`in` (seconds to arrive) and `hold` (seconds to stay).

```json
{
  "name": "greeting",
  "beats": [
    { "posture": "easy", "hold": 0.2 },
    { "label": "hand up", "posture": "easy",
      "arms": { "right": { "at": "overhead", "palm": "forward", "hand": "open", "elbow": "out" } },
      "gaze": "forward", "face": "smile", "in": 0.36, "hold": 0.1 },
    { "label": "lower", "arms": { "right": { "at": "side", "hand": "relaxed" } }, "in": 0.5, "hold": 0.2 }
  ]
}
```

## Use as a library

```js
import { motionFromText, compileScore, scoreSchema } from '@three-ws/motion';
const { clip, score, warnings } = compileScore(myScore);   // or motionFromText(prompt)
```

Also exported: `validateScore`, `normalizeScore`, `describeScore`,
`composeScore`, `motionCapabilities`, `ACTION_NAMES`, and the kinematics layer.

## Play the result

Load with `AnimationClip.parse(clip)` in three.js and play through an
`AnimationMixer`. Bone names are canonical (`Hips`, `Spine2`, `LeftForeArm`);
a rig with other names needs a retargeter.
