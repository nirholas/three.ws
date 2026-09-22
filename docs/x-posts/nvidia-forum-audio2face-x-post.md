# X post: the Audio2Face forum write-up

Announcement copy for the NVIDIA Developer Forums post that went live on 2026-09-22:
https://forums.developer.nvidia.com/t/a-digital-human-in-a-browser-tab-streaming-audio2face-3d-onto-whatever-rig-the-visitor-brought/383953

Owner posts by hand. Every number below is the one measured against production in the forum
post itself. Attach a short screen recording of https://three.ws/demos/audio2face if posting with
media; X rewards a clip of a face moving far more than a link card.

## Option A, the demo first (recommended)

> Type a sentence, get a 3D character. Then it talks to you, with lips driven by NVIDIA
> Audio2Face-3D. In a browser tab, no engine, no install.
>
> The hard part was never the model. It was the rig: the visitor's avatar might speak ARKit,
> VRM vowels, or Oculus visemes. We drive all three from one track.
>
> Wrote up how, with latencies measured on prod:
> [link]

## Option B, the number

> Audio2Face-3D animates a 5.5 s line of speech in 1.3 to 2.2 s, in a browser, on a rig it
> has never seen.
>
> How we map an ARKit-52 track onto VRM and Oculus rigs, why you must play the 44.1 kHz audio
> and not the 16 kHz copy you fed the model, and the function id that died silently:
> [link]

## Option C, the pair

> Two posts on the NVIDIA Developer Forums this week.
>
> One about a lane that broke: three NIM models retired, a 410 that a fallback chain hides for
> two weeks, and the fixes.
>
> One about a lane that shines: Audio2Face-3D driving a WebGL avatar the visitor generated
> ninety seconds ago.
>
> Both with the real code and the real numbers.
> [audio2face link]
> [retirement link]

## Reply to pin under any of them

> Try it, no signup: https://three.ws/demos/audio2face
> Source: github.com/nirholas/three.ws (api/_lib/a2f-nvidia.js, src/voice/a2f-player.js)
