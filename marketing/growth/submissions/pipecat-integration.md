# Pipecat community avatar integration submission

Target: the docs repository [pipecat-ai/docs](https://github.com/pipecat-ai/docs) (default branch
`main`), NOT `pipecat-ai/pipecat`, following `COMMUNITY_INTEGRATIONS.md` (in the pipecat repo) step
by step.

Re-verified 2026-11-14: both repos are live and not archived. `pipecat-ai/pipecat` has no
`docs.json` or `api-reference/` directory; those live only in `pipecat-ai/docs`, so the PR
goes there (the old text said pipecat-ai/pipecat). `COMMUNITY_INTEGRATIONS.md` Step 4 still
requires: a fork of `pipecat-ai/docs`, a row on
`api-reference/server/services/supported-services.mdx`, a service page with the shared
`CommunityMaintained` badge (ours has it), a `docs.json` navigation entry, a redirect entry
"following the existing pattern", a 30-60 second demo video link in the PR description, and a post in
the `#community-integrations` Discord channel after the PR is open (join first:
https://discord.gg/pipecat). The `docs-submission/` files need these updates, applied below in
"Corrections to docs-submission": the Extensions table gained a "Turn Blend" row and the
`docs.json` Extensions group moved to `navigation.tabs[4].groups[2].pages[5]`. The 4 unit tests
pass today against `pipecat-ai` 1.16.0 (latest release; the README says "Tested with Pipecat
v1.12.0", bump it to v1.16.0 before publishing). `pipecat-threews` is not on PyPI yet (404). The
repo link returns 200. The guide expects a dedicated repository with its own LICENSE and
changelog; ours is a monorepo subdirectory (CHANGELOG.md is there, LICENSE is the Apache-2.0
file at the repo root), which existing community entries do not do, so be ready for a reviewer to
ask for a standalone `nirholas/pipecat-threews` repository.

Ready for owner order 938. Built, tested, and verified end to end in work order 087;
the pull request is an owner action (CLAUDE.md gate 2: publishing to a third party
needs explicit owner approval).

## What ships

`integrations/pipecat/pipecat-threews/` (package `pipecat-threews`, module
`pipecat_threews`):

- `src/pipecat_threews/avatar.py`: `ThreeWsAvatarProcessor`, a `FrameProcessor`
  placed after the TTS service and before `transport.output()`. Republishes
  finished TTS turns and user VAD/transcription boundaries as `transcript` /
  `gesture` / `speech_started` / `speech_ended` JSON messages over the transport's
  data channel. No audio or video synthesis of its own.
- `examples/avatar_bot.py`: a complete, runnable example against a real local
  open-source `livekit-server`, speaking through a real local `espeak-ng` TTS
  service, no cloud account or API key required.
- `tests/test_avatar.py`: unit tests driven through Pipecat's own `run_test`
  pipeline harness (4 tests, no mocks of the processor's own logic).
- `docs-submission/pipecat-threews.mdx`: the full docs page, ready to drop in at
  `api-reference/server/extensions/pipecat-threews.mdx`.
- `docs-submission/supported-services-row.md`: the exact row and full-table diff for
  `api-reference/server/services/supported-services.mdx`.
- `docs-submission/docs-json-navigation.md`: the exact `docs.json` navigation diff (superseded
  by "Corrections to docs-submission" below for the current array position).

## Pull request title

```text
docs: add three.ws Avatar community integration
```

## Pull request description

```markdown
## What

Adds the `pipecat-threews` community integration: a `FrameProcessor` that drives a
[three.ws](https://three.ws) `<agent-3d>` 3D avatar's lipsync and gestures from any
Pipecat pipeline, plus its docs page.

## Why

three.ws avatars render entirely on the visitor's own device (3D model, rig, and
animation clips already live in the browser). This processor never synthesizes audio
or video: it taps the TTS and user-turn frames already flowing through a Pipecat
pipeline and republishes them as small JSON messages over the active transport's
data channel. Any transport whose implementation routes output messages to a real
data channel (LiveKit, Daily) works unchanged.

## Files changed

- `api-reference/server/extensions/pipecat-threews.mdx` (new)
- `api-reference/server/services/supported-services.mdx` (new row)
- `docs.json` (new navigation entry and a redirect entry)

## How it was tested

- `ruff check` / `ruff format --check` pass (Pipecat's own `[tool.ruff]` config).
- 4 unit tests in `tests/` run the processor through Pipecat's own `run_test`
  pipeline harness, including a regression test for a cross-turn transcript
  leakage bug found and fixed during this work (`_last_user_transcript` is now reset
  on every new user turn).
- End to end: a real bot joined a local open-source `livekit-server`, spoke three
  lines through a real `espeak-ng` TTS service, and a real headless Chromium browser
  running `<agent-3d voice="livekit">` received and rendered the matching lipsync
  and gesture data (Playwright spec, 30-60s demo video attached per
  `COMMUNITY_INTEGRATIONS.md`).

## Checklist

- [ ] Package published to PyPI as `pipecat-threews` (tick only after owner step 1)
- [x] Passes `ruff check` / `ruff format`
- [x] Ships a runnable example
- [x] Ships unit tests
- [x] Docs page, services table row, and `docs.json` entry included
- [x] Demo video attached
```

## Verification packet

- Public source: `https://github.com/nirholas/three.ws/tree/main/integrations/pipecat/pipecat-threews`
- License: Apache-2.0 (verified against the repository's own `LICENSE`)
- Example: `integrations/pipecat/pipecat-threews/examples/avatar_bot.py`
- Tests: `integrations/pipecat/pipecat-threews/tests/test_avatar.py`
  (`python -m pytest tests/ -v`, 4 passed)
- Lint/format: `ruff check .` and `ruff format --check .` both pass, config mirrors
  pipecat-ai/pipecat's own `[tool.ruff]` block
- Browser proof: `tests/e2e/agent-3d-pipecat-avatar.spec.js` (real local
  `livekit-server`, real bot process, real headless browser, 1 passed)
- Demo video: captured locally at
  `test-results/agent-3d-pipecat-avatar-ag-64cca-wser-avatar-lipsync-gesture/video.webm`
  (gitignored, not committed; attach to the PR when opened)

## Corrections to docs-submission (2026-11-14)

Apply these when copying the files into a fork of `pipecat-ai/docs`:

1. `supported-services.mdx`, `## Extensions` table: insert the row between "Pipecat Backchannel"
   and "Turn Blend" (alphabetical; "Turn Blend" is new since the files were written):

   ```text
   | [three.ws Avatar](/api-reference/server/extensions/pipecat-threews)           | `uv add pipecat-threews`                                                    | Community  |
   ```

2. `docs.json`: the Extensions group is now at `navigation.tabs[4].groups[2].pages[5]`. Insert
   `"api-reference/server/extensions/pipecat-threews"` after `pipecat-duplexjev` and before
   `pipecat-turn-blend`.
3. Redirect: the guide asks for one "following the existing pattern". The three existing community
   extension pages have none, so a redirect is optional. If a reviewer asks, add to `redirects`:
   `{"source": "/server/extensions/pipecat-threews", "destination": "/api-reference/server/extensions/pipecat-threews"}`.
4. The docs page's section order (Overview, Installation, Prerequisites, Configuration, Usage,
   Compatibility) matches the guide and the `pipecat-duplexjev` page. Set its Compatibility note
   to Pipecat v1.16.0 after bumping the README.

## Owner steps (not automatable here)

1. Publish `pipecat-threews` to PyPI (package metadata is already correct).
2. Join https://discord.gg/pipecat.
3. Fork https://github.com/pipecat-ai/docs, apply the three files in `docs-submission/` plus the
   corrections above, and open the pull request against `pipecat-ai/docs` `main`.
4. Attach the local demo video (path above) to the pull request description (30-60 seconds).
5. Post the PR link in `#community-integrations` on Discord.
