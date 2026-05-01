# Data-Reactive Avatars

Goal: make `<agent-3d>` avatars move/emote in response to live data from APIs, MCPs, and WebSockets — using only **real** data sources and **real** implementations. No mocks, no fakes, no stubs.

Each `NN-*.md` prompt is fully self-contained. None depends on another. Pick any one and complete it end-to-end (code + tests + docs in scope) before moving on. After a prompt is finished and merged/verified, delete or move it into [archive/](archive/).

Read [/CLAUDE.md](../../CLAUDE.md) and [/src/CLAUDE.md](../../src/CLAUDE.md) before starting any prompt.

## Hard rules for every prompt

- **No mocks, fakes, simulated data, or placeholder values.** Use the real upstream (PumpPortal WebSocket at `wss://pumpportal.fun/api/data`, real protocol bus, real viewer). If a real source is unavailable in the test environment, the test is skipped — never substituted.
- **Complete the task fully.** That means: code lands, types/lints/tests pass, the feature is exercised end-to-end (browser if UI, real upstream if network), and a one-line note is added to the relevant `CLAUDE.md` if it changes architecture.
- **Surgical changes.** Touch only what the task requires.
- **When done, archive the prompt** by `git mv prompts/data-reactive-avatars/NN-foo.md prompts/data-reactive-avatars/archive/NN-foo.md` (create the archive dir if missing).
