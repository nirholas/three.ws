# LiveKit Agents avatar plugin submission

Target: [livekit/agents](https://github.com/livekit/agents), following the layout and
contribution bar set by their own merged client-rendered avatar plugin (PR #5821,
merged 2026-07-20) and `CONTRIBUTING.md`.

Ready for owner order 938. Built, tested, and verified end to end in work order 087;
the pull request and the LiveKit Startups application (939) are owner actions (see
CLAUDE.md gate 2: `git push` / publishing to a third party needs explicit owner
approval).

## What ships

`integrations/livekit/livekit-plugins-threews/` (package `livekit-plugins-threews`,
module `livekit.plugins.threews`), laid out the way livekit/agents expects
(`livekit-plugins/livekit-plugins-<name>`):

- `livekit/plugins/threews/avatar.py`: `AvatarSession`, joins the room beside the
  agent and republishes its TTS text and user-turn VAD events as
  `transcript` / `gesture` / `speech_started` / `speech_ended` JSON messages over the
  room's data channel. No audio or video synthesis; the three.ws `<agent-3d>` element
  already renders the avatar client-side.
- `examples/avatar_agent.py`: a complete, runnable example against a real local
  open-source `livekit-server`, no cloud account or API key required.
- `tests/test_avatar.py`: unit tests against a real `AgentSession`/`rtc.Room`
  instance (no mocks for the plugin's own logic).

## Pull request title

```text
Add three.ws avatar plugin (livekit-plugins-threews)
```

## Pull request description

```markdown
## What

Adds `livekit-plugins-threews`, an `AvatarSession` plugin that drives a
[three.ws](https://three.ws) `<agent-3d>` 3D avatar's lipsync and gestures from any
LiveKit `AgentSession`.

## Why

Every avatar provider on the current [avatar docs
page](https://docs.livekit.io/agents/integrations/avatar/) renders 2D video
server-side. three.ws avatars render entirely on the visitor's own device (the 3D
model, rig, and animation clip library already live in the browser), so this plugin
never synthesizes audio or video: it republishes the agent's TTS text and VAD
turn-taking events as small JSON messages over the room's existing data channel, and
the browser-side `<agent-3d voice="livekit">` element (already shipping in
production) renders the lipsync and gesture locally. Same pattern as PR #5821, applied
to a client-rendered 3D avatar instead of a 2D video one.

## How it was tested

- `ruff check` / `ruff format --check` pass.
- Unit tests in `tests/` run the plugin against a real `AgentSession`.
- End-to-end: a real agent joined a local open-source `livekit-server`, spoke through
  a real TTS service, and a real headless Chromium browser running
  `<agent-3d voice="livekit">` received and rendered the lipsync and gesture data
  (Playwright spec, video/screenshot attached).

## Checklist

- [x] Follows the `livekit-plugins/livekit-plugins-<name>` package layout
- [x] Passes `ruff check` / `ruff format`
- [x] Ships a runnable example
- [x] Ships unit tests
```

## Verification packet

- Public source: `https://github.com/nirholas/three.ws/tree/main/integrations/livekit/livekit-plugins-threews`
- License: Apache-2.0 (verified against the repository's own `LICENSE`)
- Example: `integrations/livekit/livekit-plugins-threews/examples/avatar_agent.py`
- Tests: `integrations/livekit/livekit-plugins-threews/tests/test_avatar.py`
  (`python -m pytest tests/ -v`, 2 passed)
- Lint/format: `ruff check .` and `ruff format --check .` both pass, config mirrors
  livekit/agents's own `[tool.ruff]` block
- Browser proof: `tests/e2e/agent-3d-livekit-avatar.spec.js` (real local
  `livekit-server`, real headless browser, 1 passed), screenshot captured at
  `test-results/agent-3d-livekit-avatar-*/agent-3d-livekit-avatar-final.png`
  (gitignored, local to the verifying machine; attach to the PR when opened)

## Owner steps (not automatable here)

1. Publish `livekit-plugins-threews` to PyPI (package metadata is already correct;
   this is a `pip install` publish action, not covered by the GCP credits this session
   may spend freely).
2. Open the pull request above against `livekit/agents`.
3. Apply to the [LiveKit Startups program](https://livekit.io) (up to USD 23,000)
   once the plugin PR is open, referencing it.
