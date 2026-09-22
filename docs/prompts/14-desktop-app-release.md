# 14. Desktop app: a published agent console for macOS, Windows and Linux

Read `docs/prompts/README.md` first.

## The problem

`apps/desktop/` is an Electron "three.ws Companion" at version 0.1.0, private, built with `--publish never`, and nobody can download it. It is a 3D companion that walks the desktop, not a console for operating agents. Competing platforms ship a signed installer with a downloads page, and users expect to open an app, sign in, see their agents, chat, approve actions and watch runs.

## Build

### Product

Grow the companion into "three.ws Desktop": the companion stays as a mode, and the app gains an agent console: sign in with the OAuth flow from prompt 01 (loopback redirect), agents list, chat with tool status, runs with step timeline (prompt 05), wallet with balances and the approve-or-cancel flow for financial previews (same preview id rule as prompt 13), notifications through native OS notifications, a menu-bar or tray presence, and a "connect your editor" panel that runs the CLI setup for Claude Code, Cursor and the others in one click. Every state designed; skeletons, not spinners.

### Release engineering

- `electron-builder` targets: macOS universal `.dmg` and `.zip`, Windows `.exe` (NSIS) and portable, Linux `.AppImage` and `.deb`. Code signing and notarization for macOS with the Developer ID certificate, and Windows signing, read from Secret Manager on the build service; if a certificate does not exist on the account, build unsigned, document the "Open Anyway" path, and list the certificate as the single missing item.
- Builds run on Cloud Build from `apps/desktop/cloudbuild.yaml` (no GitHub Actions), publish artifacts to a GCS bucket behind the CDN, and create a GitHub Release on `nirholas/three.ws` with `gh release create` (push-gated: prepare the command, run it only on approval).
- Auto-update with `electron-updater` against the GCS feed.
- Version bump script and a changelog entry generated from `data/changelog.json` entries tagged `desktop` since the last release.

### Downloads page

`/desktop` (in `data/pages.json`): OS detection, primary download for the detected OS, all builds listed with size and SHA-256, release notes, minimum OS versions, and the unsigned-build instructions if they apply. The app's `homepage` in `apps/desktop/package.json` currently points at `/companion`; align both.

## Docs and wiring

`apps/desktop/README.md` rewritten for the console; `docs/desktop.md` (new) linked from `docs/start-here.md`; `docs/ops/desktop-release.md` for the release runbook; `STRUCTURE.md` row; `data/changelog.json` entry tagged `feature`.

## Acceptance

- A clean macOS machine downloads from `/desktop`, installs, signs in, and chats with a QA agent.
- Approving a preview from the app stops at the owner confirmation table (gate 1).
- Auto-update picks up a second build.
- `npm test` green, including renderer unit tests for the console views.
