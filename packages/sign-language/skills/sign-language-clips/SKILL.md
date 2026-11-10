---
name: sign-language-clips
description: Compile English text into an American Sign Language animation clip (three.js AnimationClip JSON) using @three-ws/sign-language. Use when a task needs a 3D avatar to sign a phrase, to list which words are signed versus fingerspelled, or to get a plain-English description of a sign.
---

# Sign language clips

`@three-ws/sign-language` is a zero-dependency ESM library (Node >= 18, also browsers). It turns text into one continuous clip: words in the lexicon are signed, all other words are fingerspelled.

## Install

```bash
npm install @three-ws/sign-language
```

## Compile a phrase (no avatar, no renderer, no network)

```js
import { compileUtterance, signLookup, signGloss } from '@three-ws/sign-language';

const signs = signLookup({ dominant: 'Right' });
const { clip, signed, spelled, truncated } = compileUtterance('happy to meet you', { signs });

console.log(signed);             // words signed from the lexicon
console.log(spelled);            // words that were fingerspelled
console.log(signGloss('happy')); // plain-English description of the sign
console.log(clip.duration, clip.tracks.length);
```

`clip` is a three.js `AnimationClip` JSON document. In a three.js app:

```js
import { AnimationClip, AnimationMixer } from 'three';
const mixer = new AnimationMixer(avatarRoot);
mixer.clipAction(AnimationClip.parse(clip)).play();
```

Track names target the canonical Avaturn-style bone set (`Hips`, `RightHand`, `RightHandIndex1`, ...). The rig needs finger bones.

## Other entry points

- `estimateDuration(text)` returns seconds before compiling, `utteranceWords(text)` splits text into words.
- `SignSpeaker({ manager, dominant })` sequences live utterances. `manager` must provide `injectClip(name, clip, opts)` and `playOnce(name, opts)`. Methods: `speak(text)` (resolves when signing ends) and `cancel()`.
- `SIGNABLE_WORDS`, `SIGNS`, `lookupSign`, `signLookup` expose the vocabulary.
- `buildFingerspellingClip`, `letterPose`, `LETTER_SHAPES`, `normalizeWord` expose the manual alphabet.
- Authoring layer: `HANDSHAPES`, `SignTimeline`, `place`, `posePhase`, `faceWeights`. Extend the vocabulary by passing your own lookup to `compileUtterance`.

## Run the bundled example from a clone

```bash
npm run example -- "happy to meet you"   # builds, then writes example/utterance.clip.json
```

## Honest limits (say these to the user)

- Output is English word order with ASL vocabulary, not ASL grammar.
- It is assistive: show it alongside text, never as the only channel for safety, legal or medical content.
- Unknown words are spelled on purpose, never replaced by a guessed sign.
- Recommend review by Deaf signers for user-facing use; `signGloss()` makes the lexicon auditable.
