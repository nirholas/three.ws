# X post drafts for the Tech Community articles

**Status:** drafts only, not posted. Posting is an owner step, after each article is live on the Microsoft Tech Community. Every number is a row in [sources.md](../sources.md); re-measure before posting.

How to post: append the article's Tech Community URL on its own line. X counts any link as 23 characters, and each draft below is short enough to stay under 280 with it. Tag Microsoft accounts only if the article itself is shared by them first; do not tag to ask for amplification.

## 1. Running TRELLIS on Cloud Run GPUs ([article](../tech-community-trellis-gpus.md))

> We run TRELLIS from Microsoft Research as our image-to-3D engine: 35,531 jobs on our own L4 GPUs since July, one job per GPU.
>
> 30-day medians: draft 132 s, standard 234 s, high 602 s.
>
> What broke, how we fixed it, and the code, on Tech Community:

Thread follow-up (optional):

> The fixes that mattered most: a retry budget of four attempts on model load after a latch took the lane down for 12 hours, and a 90 s cooldown that takes a failing GPU lane out of rotation instead of letting it eat the queue.

## 2. An app for Teams on Adaptive Cards ([article](../tech-community-teams-adaptive-cards.md))

> Type "a brass desk lamp" in Teams and get an interactive 3D model back on a card that updates while the GPU works.
>
> How we built the bot, message extension, tab and meeting stage on Adaptive Cards, with the payload sizes and 97 tests behind it:

## 3. On-device speech with ONNX Runtime Web ([article](../tech-community-onnx-speech.md))

> Our 3D agents listen in the browser with ONNX Runtime Web. Audio never leaves the machine.
>
> Wake word: about 7.5 ms per 80 ms chunk. Moonshine transcribes an 11 s clip in about 2 s, Whisper in about 6 s.
>
> How we wired it, with the code:

## Checks before posting

- Run `node scripts/microsoft-pack/check-wording.mjs docs/partners/microsoft/programs/x-drafts.md`.
- Confirm each number against sources.md on the day; the ONNX timings must come from a run on an idle machine (see the note in sources.md).
- Count characters with the link included.
