---
slug: stage-agent-speaking-queue
title: Multi-agent stage serialises speech so agents never talk over each other
tier: P3
score: 22
area: stage
sources: specs/STAGE_SPEC.md#Constraints
---

## Why this matters

When two agents on one `<agent-stage>` speak at the same moment (for instance after a `stage.broadcast()` or a `say_to_agent` exchange), browser TTS overlaps and both lip-syncs run at once, which sounds broken. The spec lists a per-stage speaking queue as a known follow-up and nothing has built it.

## Current state (measured by the reviewer on 2026-11-03)

- `src/stage-element.js` hosts the multi-agent stage; `grep -n -iE "queue|speak" src/stage-element.js` shows no speech serialisation. `src/stage.js` has its own single-host `speak()` (for the club/spotlight show), unrelated to multi-agent.
- The spec line: "Voice conflicts: TTS is per-agent and not serialised across the stage ... A per-stage speaking queue is a follow-up."
- Related existing tests: `tests/embodiment-stage.test.js`, `tests/stage-show.test.js`, `tests/stage-host-line.test.js`, `tests/stage-split.test.js`.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
grep -n -iE "queue|speak|tts|broadcast|say_to_agent" src/stage-element.js | head -20
grep -rn "say_to_agent" src --include=*.js -l
sed -n 60,95p specs/STAGE_SPEC.md
```

## Tasks

1. Design a pure `src/stage-speech-queue.js`: FIFO with priority levels (user-directed beats broadcast beats ambient), per-agent de-duplication, a maximum queue depth with drop-oldest-ambient policy, and a `speaking` state exposing the current speaker. Dependency-free.
2. Test-first: `tests/stage-speech-queue.test.js` covering ordering, priority preemption of queued (never mid-utterance) items, depth limit, an utterance that errors (queue advances), and cancellation when an agent is removed from the stage. Use an injected `speak(agentId, text) => Promise` so no browser is needed.
3. Wire into `src/stage-element.js`: every agent speech request on the stage goes through the queue; the agent's own `speak` event still drives lip-sync and captions; add `stage.speaking` and `speaking-change` events to the public API in the spec.
4. Interaction with `say_to_agent`: the reply of the target agent is enqueued behind the caller; test the round trip with two agents.
5. Browser verification on a page with two agents (find the existing demo under `examples/` or `pages/`): trigger a broadcast and confirm sequential playback, correct captions, no overlap and no console errors.
6. Update `specs/STAGE_SPEC.md` (move the follow-up into the spec body), the element docs, changelog entry, `npm run build:pages` if a page text changes.

## Definition of done

- [ ] `npx vitest run tests/stage-speech-queue.test.js tests/embodiment-stage.test.js` passes; the queue test failed before the implementation existed.
- [ ] `grep -n "per-stage speaking queue is a follow-up" specs/STAGE_SPEC.md` returns nothing.
- [ ] In a browser with two agents, a broadcast produces two non-overlapping utterances (record timestamps from the `speaking-change` events in the report).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Browser TTS unavailable headless | Test the queue through the injected speak function and verify the wiring through the events; verify audio in a real browser where available |
| No two-agent demo page | Create the smallest demo page under `examples/` and register it in the examples index |
