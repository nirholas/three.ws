# /club audio — provenance and licensing

All the loops in this directory were synthesised from scratch with
ffmpeg's `lavfi` filtergraph (sine + noise primitives, no third-party
samples). The source recipe lives at
[`/scripts/build-club-audio.mjs`](../../../scripts/build-club-audio.mjs)
and re-running `node scripts/build-club-audio.mjs` regenerates these
files byte-for-byte.

Because no external sample material was used, three.ws holds full
copyright on these loops and dedicates them to the public domain
under **Creative Commons CC0 1.0 Universal**
(https://creativecommons.org/publicdomain/zero/1.0/). You can use them
for any purpose, with or without attribution.

| File                 | Source                                                        | License | Length                | Notes                                                                 |
| -------------------- | ------------------------------------------------------------- | ------- | --------------------- | --------------------------------------------------------------------- |
| `ambience.{ogg,mp3}` | Authored — pink noise bed + slow LFO + low rumble             | CC0 1.0 | ~60 s loop            | Crowd / room ambience. Constant level, no rhythmic content.           |
| `rumba.{ogg,mp3}`    | Authored — 100 BPM 3-2 clave, triangle melody, sine bass      | CC0 1.0 | ~9.6 s loop (4 bars)  | Light Latin groove for the Rumba clip.                                |
| `thriller.{ogg,mp3}` | Authored — 120 BPM minor groove, detuned drone, sawtooth lead | CC0 1.0 | ~8.0 s loop (4 bars)  | Dark cinematic bed for the Thriller clip.                             |
| `hiphop.{ogg,mp3}`   | Authored — 95 BPM boom-bap kit + bassline + stab lead         | CC0 1.0 | ~10.1 s loop (4 bars) | Classic hip-hop pocket for the Hip Hop clip.                          |
| `capoeira.{ogg,mp3}` | Authored — 110 BPM berimbau ostinato + atabaque approximation | CC0 1.0 | ~8.7 s loop (4 bars)  | Brazilian roda rhythm for the Capoeira clip.                          |
| `silly.{ogg,mp3}`    | Authored — 130 BPM major-key bounce + woodblock + cartoon arp | CC0 1.0 | ~7.4 s loop (4 bars)  | Playful bed for the Silly clip.                                       |
| `pole.{ogg,mp3}`     | Authored — 105 BPM neutral groove + sine pad                  | CC0 1.0 | ~9.1 s loop (4 bars)  | Generic backing track for pole choreography clips (spin/climb/combo). |

## Removed tracks

Three supplied third-party tracks (a walk-in anthem, a long music bed, and a
sped-up commercial song) were removed on 2026-11-26 because their rights could
not be established. The music bed now streams the CC0 `hiphop` and `pole`
loops, and the walk-in sting is the CC0 `rumba` loop played once. Do not add
tracks here without a row above that names the source and a licence that permits
commercial redistribution.

## Mastering notes

Every track is rendered to an integer number of beats so it loops
sample-clean at the seam. `dynaudnorm` (`g=11:p=0.78`) brings peaks
down to roughly −6 dBFS — enough headroom for the post-FX bloom-era
sidechain and for the master gain at 0.75 in
[`src/club-audio.js`](../../../src/club-audio.js) without clipping the
output bus.

Encoder targets:

- **MP3:** mono, 44.1 kHz, 192 kbit/s, libmp3lame.
- **OGG Vorbis:** stereo, 44.1 kHz, qscale 4, libvorbis.

`<audio>` and `decodeAudioData()` consumers fall through to MP3 when
their browser lacks Vorbis (older Safari builds). The mixer in
`src/club-audio.js` requests `.ogg` first and falls back to `.mp3` on
fetch/decode failure — see `loadBuffer()`.

## Regenerating

```sh
node scripts/build-club-audio.mjs
```

Requires `ffmpeg` ≥ 4.4 built with libmp3lame + libvorbis (Ubuntu's
default `apt install ffmpeg` is sufficient). Output is deterministic
within ffmpeg's encoder limits, so committed files only change when
the recipe changes.
