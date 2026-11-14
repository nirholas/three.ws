# LiveKit Agents avatar plugin submission

Target: [livekit/agents](https://github.com/livekit/agents), following the layout and
contribution bar set by their own merged client-rendered avatar plugin (Spatius, PR #5821,
merged 2026-07-20) and `CONTRIBUTING.md`.

Re-verified 2026-11-14: `livekit/agents` is live, not archived (Apache-2.0, default branch
`main`); `livekit-plugins/livekit-plugins-spatius` and the other avatar plugin directories
exist; `CONTRIBUTING.md` still asks for `ruff check --fix` / `ruff format`, pdoc3-style docs on
every new class and method, the CLA Assistant bot on a first PR, and no hand edits to
`CHANGELOG.md` or package manifests (a bot does it). There is no PR template. Latest release is
`livekit-agents` 1.8.12 (our pin is `>=1.6.4`); the 2 unit tests pass against 1.8.12 today.
`livekit-plugins-threews` is not on PyPI yet (404), so owner step 1 is still open. Both repo
links and the avatar docs page return 200. Many other avatar plugin PRs are open right now
(for example #8491, #8170, #7640), and recent ones use a `feat:` title prefix, so the title
below was changed to match. Two description fixes were applied: the avatar docs page now lists
Spatius, which is itself client-rendered, so the old "every provider renders 2D video"
sentence was wrong.

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
feat: add three.ws avatar plugin
```

## Pull request description

```markdown
## What

Adds `livekit-plugins-threews`, an `AvatarSession` plugin that drives a
[three.ws](https://three.ws) `<agent-3d>` 3D avatar's lipsync and gestures from any
LiveKit `AgentSession`.

## Why

The avatar providers on the current [avatar docs
page](https://docs.livekit.io/agents/models/avatar/) either render video
server-side or, in Spatius's case, ship motion data inside a video track that a
vendor SDK decodes. None of them is an open, vendor-neutral 3D avatar. three.ws avatars
render entirely on the visitor's own device (the 3D model, rig, and animation clip library
already live in the browser), so this plugin never synthesizes audio or video: it republishes the agent's TTS text and VAD
turn-taking events as small JSON messages over the room's existing data channel, and
the browser-side `<agent-3d voice="livekit">` element (already shipping in
production) renders the lipsync and gesture locally. Same client-rendered idea as the
Spatius plugin (PR #5821), but over the room's plain data channel, with no video track and
no vendor SDK or account.

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
- [x] New classes and methods are documented (pdoc3 style, per `CONTRIBUTING.md`)
- [ ] CLA signed (the CLA Assistant bot links it on the first PR)
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
2. Open the pull request above against `livekit/agents` (https://github.com/livekit/agents/compare),
   then sign the CLA via the bot's link. Merged plugins (for example Spatius) ship no `tests/`
   directory; drop ours from the PR if a reviewer asks, the package works without it.
3. Apply to the [LiveKit Startups program](https://livekit.io/startups) (page still says up to
   $23K in infrastructure and inference credits, confirmed 2026-11-14) once the plugin PR is open, referencing it.
