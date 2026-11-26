# Design: an avatar that says one line in every supported language

**Status:** planned, not built. Work order: [878](../../../prompts/finish/878-nvidia-28-multilingual-talking-avatar.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

A visitor picks a language and the avatar repeats its last line in it: same
character, same sentence, new language, with the mouth matching the new audio.
It works on our avatar pages and as an attribute on the `<agent-3d>` embed, so a
site owner with a multilingual audience gets it too.

## Why build it

- NVIDIA has a Content Localization blueprint whose whole job is fixing lip sync
  on translated video after the fact
  ([research, blueprint catalog](../../nvidia-showcase-research.md#agents-are-the-center-of-gravity)).
  A 3D avatar never has that problem: the face is animated from the audio, so
  Spanish audio produces Spanish mouth shapes with no extra step.
- Every part already exists on NVIDIA technology we run today: translation,
  speech and facial animation. Nothing joins them.
- It makes a demo that explains itself in ten seconds: one avatar, one sentence,
  a row of language buttons.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| NVIDIA speech | [api/_lib/tts-nvidia.js](../../../api/_lib/tts-nvidia.js) | `magpie-tts-multilingual`. The code maps nine languages: English, Spanish, French, German, Chinese, Vietnamese, Italian, Hindi and Japanese. `resolveMagpieLanguage` and `resolveMagpieVoice` pick the language and a matching voice. |
| Speech endpoints | [api/tts/speak.js](../../../api/tts/speak.js), [api/tts/synthesize.js](../../../api/tts/synthesize.js) | How the site asks for speech |
| Translation routes | [scripts/lib/i18n-nvidia.mjs](../../../scripts/lib/i18n-nvidia.mjs), [evaluation](../evals/translation-2026-11-16.md) | Which NVIDIA-hosted model translates each locale best, measured |
| Facial animation | [api/a2f.js](../../../api/a2f.js), [src/voice/a2f-player.js](../../../src/voice/a2f-player.js) | Face track from audio, with the fallback mouth when no track is available |
| Conversation languages | [src/voice/talk-languages.js](../../../src/voice/talk-languages.js) | The languages the voice loop can already hold a conversation in. A different feature (live conversation, different speech vendors), and the list to stay consistent with. |
| The avatar element | [src/element.js](../../../src/element.js) | `<agent-3d>`, including `speakAudio()` |

## Design

```
last line + target language
    |
speak-in-language handler
    |-- translate   (existing NVIDIA translation path)
    |-- check       (translate back with a second model; below the threshold: retry once, then refuse)
    |-- speak       (existing Magpie lane, voice matched to the language)
    |-- cache       (keyed by text, language and voice: a repeated line costs nothing)
    |
translated text + audio
    |
<agent-3d>: plays the audio; the face follows it through the existing path
```

- **The supported list comes from live probes.** The switcher shows only
  languages the speech lane actually answered for, each named in its own script.
  The nine in the code are the starting list, not a promise.
- **Never speak a wrong sentence.** A translation that fails the back-translation
  check is retried once and then refused with a plain message. Names and numbers
  must survive untranslated, and that is tested with real examples.
- **Never fall back to English silently.** An unsupported language gets a clear
  error naming the supported set.
- **The face lanes are not reordered.** This feature calls the face path exactly
  as it is served, fallback included. It gets better by itself when build
  [871](871-self-hosted-audio2face.md) lands.
- **The speech lane's request is not changed.** Measured at 100% of probes on
  2026-11-26, it is a working lane.
- **A demo page** at `/demos/multilingual-avatar`. If the clip export from order
  867 has landed, "export all languages" produces one clip per language through
  it.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Probe | The supported language list recorded from live probes, with dates |
| 2. API | Translate, check, speak, cache. Tests for the voice mapping, the unsupported-language error and the cache key. |
| 3. Face | Verified in a browser that the mouth follows the translated audio |
| 4. Switcher | On the avatar speaking surface and as an embed attribute and method; keyboard accessible; designed loading, error and unsupported states |
| 5. Demo page | One avatar, one editable line, language buttons, a caption |
| 6. Measure | Per language: time to first audio, time to first face frame, check score on 20 fixed sentences |
| 7. Docs | `docs/multilingual-avatar.md`, embed docs, API reference, changelog |

## The numbers it leaves behind

A table with one row per supported language: time from click to first audio,
time to first face frame, and the translation check score.

## Cost

No new service. One translation call and one speech call per new line and
language, then cached.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| The speech lane supports fewer languages than the code lists | Ship the ones it answers for and list the rest as unsupported with the probe result. No second speech vendor is added. |
| The hosted face lane is down | The feature still works on the fallback mouth. The report says which path the browser test used. |
| A language has no matching voice | Use the multilingual voice only if a transcription of its audio shows it is intelligible, otherwise mark it unsupported |

## Owner steps

Push and deploy. A short screen recording of the demo page is a natural social
post once it is live, and posting is the owner's step.

## What we can say, and when

Everything this uses is already serving. Once the feature is live: "one avatar,
one sentence, in every language our NVIDIA voice supports, with the lips correct
in each".
