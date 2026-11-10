---
name: avatar-pose-seeds
description: Turn a natural-language prompt or preset id into a deterministic pose seed and joint-rotation map for a rigged humanoid avatar with @three-ws/pose. Use when an agent needs to pose an avatar reproducibly.
---

# Avatar poses with @three-ws/pose

Maps a phrase to a stable seed plus a full Euler joint-rotation map from the three.ws pose-studio preset library. The default path runs locally: no network, no key, no payment.

## Install

```
npm install @three-ws/pose
```

Node 18 or newer.

## Functions

- `poseSeed(prompt, opts?)`: token-score the prompt (max 500 chars) against the presets and hash to a seed. The same prompt always returns the same result.
- `presetPose(presetId, opts?)`: look up one preset by id.
- `listPresetGroups()`: group names.
- `PRESETS` (`{ id, label, group, pose }[]`) and `PRESET_GROUPS`: the bundled library.
- `createPose(options?)`: reusable client.

The result is `{ seed, presetId, presetLabel, group, parameters, previewUrl, match: { score, reason }, groups }`. `parameters` maps joint names to `{ x, y, z }` Euler rotations. `match.reason` is `token-match`, `no-match-deterministic-pick` or `preset-id`.

## Hosted lane (opt-in)

Passing `baseUrl`, `apiKey` or `fetch` to `createPose()` sends calls to the `pose_model` tool on `https://three.ws/api/mcp-3d` as JSON-RPC `tools/call`. Keyless hosted calls are x402-priced per call and a 402 raises `PaymentRequiredError`. An OAuth `apiKey` runs operator-funded. Do not approve a payment on the user's behalf.

## Example

```js
import { poseSeed, presetPose, PRESET_GROUPS } from '@three-ws/pose';

const pose = await poseSeed('wave hello');
console.log(pose.seed, pose.presetLabel, pose.parameters);
const again = await presetPose(pose.presetId);
console.log(PRESET_GROUPS);
```

Apply `parameters` to the matching bones of a rigged GLB (set each bone's `rotation.set(x, y, z)`). Bone names that do not exist on a rig should be skipped, see the three-ws-retarget plugin for canonical bone naming.

Errors are `PoseError` (extends `ThreeWsError`) with `code`, `status`, `detail`.
